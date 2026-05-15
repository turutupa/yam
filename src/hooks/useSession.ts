import { useState, useEffect, useRef, useCallback } from "react";
import { getSessionReport, getSessionHistory, saveSession, clearSession, coachGenerate, loadCoachModel, isCoachLoaded, ttsSpeak, onBeatFeedback, onAdaptiveEval, setAdaptiveDecision } from "../ipc";
import type { AdaptiveEvalRequest } from "../ipc";
import type { BeatFeedback, FeedMessage, SessionReport, SessionSegment } from "../types";
import type { useEvaluation } from "./useEvaluation";

type Evaluation = ReturnType<typeof useEvaluation>;

interface UseSessionOptions {
  evaluation: Evaluation;
  isPlaying: boolean;
  bpm: number;
  timeSignature: number;
  presetId?: string;
  presetName?: string;
  voiceMode?: "silent" | "chime" | "voice";
  notifLevel?: "all" | "important" | "silent";
}

export function useSession({ evaluation, isPlaying, bpm, timeSignature, presetId, presetName, voiceMode = "silent", notifLevel = "all" }: UseSessionOptions) {
  const [active, setActive] = useState(false);
  const [messages, setMessages] = useState<FeedMessage[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const wasPlayingRef = useRef(false);
  const playBpmRef = useRef(bpm);
  const segmentReportsRef = useRef<SessionSegment[]>([]);
  const segmentStartRef = useRef<number>(Date.now());
  const coachLoadedRef = useRef(false);
  const sessionIdRef = useRef(0);
  const messagesRef = useRef<FeedMessage[]>([]);

  // Speak a comment if voice mode is active and urgency passes the notification filter
  const maybeSpeak = useCallback((text: string, urgency: "urgent" | "normal" = "urgent") => {
    if (voiceMode === "silent") return;
    if (notifLevel === "silent") return;
    if (notifLevel === "important" && urgency !== "urgent") return;
    if (voiceMode === "voice") {
      ttsSpeak(text).catch(() => {});
    } else if (voiceMode === "chime") {
      playChime(urgency === "urgent" ? 880 : 660);
    }
  }, [voiceMode, notifLevel]);

  // Keep messagesRef in sync for use in callbacks
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Try to load the coach model once on mount
  useEffect(() => {
    isCoachLoaded().then((loaded) => {
      if (loaded) {
        coachLoadedRef.current = true;
      } else {
        loadCoachModel().then((ok) => { coachLoadedRef.current = ok; });
      }
    });
  }, []);

  // Track when play starts to capture bpm and segment start time
  useEffect(() => {
    if (isPlaying && !wasPlayingRef.current) {
      playBpmRef.current = bpm;
      segmentStartRef.current = Date.now();
    }
  }, [isPlaying, bpm]);

  // Auto mini-reports: when playback stops during an active session
  useEffect(() => {
    if (wasPlayingRef.current && !isPlaying && active) {
      const segmentBpm = playBpmRef.current;
      const sid = sessionIdRef.current;
      getSessionReport().then(async (report) => {
        // Discard if a new session started while this was in-flight
        if (sid !== sessionIdRef.current) return;
        if (report && (report.hitsCount + report.missCount) >= 8) {
          const now = Date.now();
          segmentReportsRef.current.push({ report, bpm: segmentBpm, timeSignature, startTime: segmentStartRef.current, endTime: now });

          // Generate coach comment (LLM or template-based)
          const accuracy = report.totalBeats > 0
            ? Math.round((report.hitsCount / report.totalBeats) * 100) : 0;
          let comment = formatMiniReport(report);
          if (coachLoadedRef.current) {
            try {
              const context = formatMiniReportContext(segmentBpm, timeSignature, accuracy, report);
              comment = await coachGenerate(context);
            } catch { /* fall back to template */ }
          }

          const msg: FeedMessage = {
            id: crypto.randomUUID(),
            type: "mini-report",
            timestamp: Date.now(),
            content: comment,
            report,
            meta: { bpm: segmentBpm, timeSignature },
          };
          setMessages((prev) => [...prev, msg]);
          clearSession();
        }
      });
    }
    wasPlayingRef.current = isPlaying;
  }, [isPlaying, active, timeSignature]);

  // Real-time coaching: monitor beat feedback during active play
  const realtimeWindowRef = useRef<BeatFeedback[]>([]);
  const lastCoachCommentRef = useRef<number>(0);
  const beatsSinceLastCheckRef = useRef<number>(0);
  const bestStreakRef = useRef<number>(0);

  useEffect(() => {
    if (!active || !isPlaying) {
      realtimeWindowRef.current = [];
      beatsSinceLastCheckRef.current = 0;
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    onBeatFeedback((fb) => {
      if (cancelled) return;
      const window = realtimeWindowRef.current;
      window.push(fb);
      if (window.length > 32) window.shift();
      beatsSinceLastCheckRef.current++;

      // Check every 8 beats (roughly 2 bars in 4/4)
      const barsWorth = timeSignature * 2;
      if (beatsSinceLastCheckRef.current < Math.max(8, barsWorth)) return;

      // Throttle: minimum 15 seconds between comments
      const now = Date.now();
      if (now - lastCoachCommentRef.current < 15_000) return;

      const tip = analyzeRealtimeTrend(window, bestStreakRef.current);
      if (!tip) return;

      beatsSinceLastCheckRef.current = 0;
      lastCoachCommentRef.current = now;
      if (tip.streak > bestStreakRef.current) bestStreakRef.current = tip.streak;

      // Generate coach comment (LLM or use the template)
      const generateTip = async () => {
        let comment = tip.template;
        if (coachLoadedRef.current) {
          try {
            comment = await coachGenerate(tip.context);
          } catch { /* fall back to template */ }
        }
        const msg: FeedMessage = {
          id: crypto.randomUUID(),
          type: "coach-tip",
          timestamp: Date.now(),
          content: comment,
        };
        setMessages((prev) => [...prev, msg]);
        maybeSpeak(comment, tip.urgency);
      };
      generateTip();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [active, isPlaying, timeSignature, maybeSpeak]);

  // Adaptive drill: model-based tempo decisions
  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    onAdaptiveEval((req: AdaptiveEvalRequest) => {
      if (cancelled || !coachLoadedRef.current) return;

      const context = formatAdaptiveEvalContext(req);
      coachGenerate(context).then((response) => {
        if (cancelled) return;
        const decision = parseAdaptiveDecision(response);
        setAdaptiveDecision(decision).catch(() => {});

        // Optionally add a coach comment about the decision
        if (decision !== "hold") {
          const action = decision === "up" ? "Pushing tempo up" : "Easing tempo down";
          const comment = response.length > 5 && response.length < 200 ? response : `${action} — accuracy at ${req.accuracyPct}%.`;
          const msg: FeedMessage = {
            id: crypto.randomUUID(),
            type: "coach-tip",
            timestamp: Date.now(),
            content: comment,
          };
          setMessages((prev) => [...prev, msg]);
          maybeSpeak(comment, "normal");
        }
      }).catch(() => {});
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [active, maybeSpeak]);

  const startSession = useCallback(async () => {
    if (active) return;

    // Bump session ID FIRST to invalidate any in-flight stale reports
    sessionIdRef.current++;
    segmentReportsRef.current = [];
    bestStreakRef.current = 0;
    lastCoachCommentRef.current = 0;
    wasPlayingRef.current = false; // prevent stale mini-report from previous session
    const now = Date.now();
    setActive(true);
    setStartedAt(now);
    setCardOpen(true);

    // Clear backend session data in background — don't block UI
    clearSession().catch(() => {});

    // Try to load coach model if not already loaded
    if (!coachLoadedRef.current) {
      loadCoachModel().then((ok) => { coachLoadedRef.current = ok; });
    }

    // Show template greeting immediately — no freeze
    const greetingId = crypto.randomUUID();
    const templateGreeting = presetName
      ? `Session started — ${presetName}. Play when you're ready.`
      : "Session started. Play when you're ready.";

    setMessages([{
      id: greetingId,
      type: "session-start",
      timestamp: now,
      content: templateGreeting,
    }]);

    if (!evaluation.enabled) {
      evaluation.toggle();
    }

    // Generate model greeting in the background, then patch the message
    if (coachLoadedRef.current) {
      const sid = sessionIdRef.current;
      (async () => {
        try {
          let context: string | null = null;
          if (presetId) {
            const history = await getSessionHistory();
            const presetSessions = history.filter((s) => s.presetId === presetId);
            if (presetSessions.length > 0) {
              const summary = compactPresetSummary(presetName ?? "", presetSessions);
              context = `The player is starting a new session. Generate a brief, motivating greeting (1-2 sentences).\n\n${summary}\n\nReference their history to make it personal.`;
            } else {
              context = `The player is starting a new session with preset "${presetName ?? "default"}" at ${playBpmRef.current} BPM. This is their first session${presetName ? ` with "${presetName}"` : ""}. Generate a brief, motivating greeting (1-2 sentences). Be warm and encouraging.`;
            }
          } else {
            context = `The player is starting a free practice session at ${playBpmRef.current} BPM. Generate a brief, motivating greeting (1-2 sentences). Be warm and encouraging.`;
          }
          if (context) {
            const greeting = await coachGenerate(context);
            if (sid !== sessionIdRef.current) return;
            setMessages((prev) => prev.map((m) =>
              m.id === greetingId ? { ...m, content: greeting } : m
            ));
            maybeSpeak(greeting);
          }
        } catch { /* keep template greeting */ }
      })();
    }
  }, [active, evaluation, presetId, presetName, maybeSpeak]);

  const endSession = useCallback(async () => {
    if (!active) return;

    const lastReport = await getSessionReport();
    if (lastReport && (lastReport.hitsCount + lastReport.missCount) >= 8) {
      segmentReportsRef.current.push({ report: lastReport, bpm, timeSignature, startTime: segmentStartRef.current, endTime: Date.now() });
    }

    const now = Date.now();
    const segments = [...segmentReportsRef.current];
    const aggregated = segments.length > 0 ? aggregateReports(segments.map(s => s.report)) : null;

    // End session immediately — no freeze
    const endMsgId = crypto.randomUUID();
    const placeholderComment = aggregated ? "Session complete." : "Session ended — no data recorded.";
    const endMsg: FeedMessage = {
      id: endMsgId,
      type: "session-end",
      timestamp: now,
      content: placeholderComment,
      report: aggregated ?? undefined,
      meta: { bpm, timeSignature },
      segments: segments.length > 1 ? segments : undefined,
    };
    setMessages((prev) => [...prev, endMsg]);

    if (evaluation.enabled) {
      evaluation.toggle();
    }
    segmentReportsRef.current = [];
    setActive(false);
    setStartedAt(null);

    // Save session
    if (aggregated && (aggregated.hitsCount + aggregated.missCount) >= 8) {
      saveSession({
        id: crypto.randomUUID(),
        timestamp: startedAt ?? now,
        bpm,
        timeSignature,
        report: aggregated,
        presetId: presetId,
        presetName: presetName,
      }).catch(() => {});
    }

    // Generate coach summary in the background, then patch the message
    if (aggregated && coachLoadedRef.current) {
      const durationSecs = Math.round((now - (startedAt ?? now)) / 1000);
      const accuracy = aggregated.totalBeats > 0
        ? Math.round((aggregated.hitsCount / aggregated.totalBeats) * 100) : 0;
      const context = formatSessionContext(durationSecs, segments.length, aggregated.score, aggregated.grade, aggregated.totalBeats, accuracy, aggregated.meanDeviationMs, aggregated.longestStreak);
      coachGenerate(context).then((summaryComment) => {
        setMessages((prev) => prev.map((m) =>
          m.id === endMsgId ? { ...m, content: summaryComment } : m
        ));
        maybeSpeak(summaryComment);
      }).catch(() => {});
    }
  }, [active, evaluation, bpm, timeSignature, startedAt, presetId, presetName, maybeSpeak]);

  // Chat: send a user question to the coach
  const sendChat = useCallback((question: string) => {
    if (!question.trim()) return;

    // Add user message to feed immediately
    const userMsg: FeedMessage = {
      id: crypto.randomUUID(),
      type: "user-chat",
      timestamp: Date.now(),
      content: question,
    };
    setMessages((prev) => [...prev, userMsg]);

    // Generate reply in background
    (async () => {
      const segments = segmentReportsRef.current;
      const aggregated = segments.length > 0 ? aggregateReports(segments.map(s => s.report)) : null;
      const accuracy = aggregated && aggregated.totalBeats > 0
        ? Math.round((aggregated.hitsCount / aggregated.totalBeats) * 100) : 0;
      const sessionData = aggregated
        ? `BPM: ${bpm}, Accuracy: ${accuracy}%, Score: ${aggregated.score}, Grade: ${aggregated.grade}, Avg deviation: ${aggregated.meanDeviationMs.toFixed(1)}ms, Streak: ${aggregated.longestStreak}`
        : "No session data yet.";

      let reply = "I don't have enough session data to answer that yet. Start playing and I'll have more to work with!";
      try {
        let historyContext = "";
        if (presetId) {
          try {
            const history = await getSessionHistory();
            const presetSessions = history.filter((s) => s.presetId === presetId);
            if (presetSessions.length > 0) {
              historyContext = "\n" + compactPresetSummary(presetName ?? "", presetSessions) + "\n";
            }
          } catch { /* skip history */ }
        }

        const recentMsgs = messagesRef.current.slice(-6);
        const conversationContext = recentMsgs.length > 0
          ? "\nConversation so far:\n" + recentMsgs.map((m) =>
              m.type === "user-chat" ? `User: ${m.content}` : `Coach: ${m.content}`
            ).join("\n") + "\n"
          : "";

        const context = `Current session data:\n${sessionData}${historyContext}${conversationContext}\nUser asks: ${question}\nAnswer concisely based only on the data above.`;
        reply = await coachGenerate(context);
      } catch { /* use fallback */ }

      const replyMsg: FeedMessage = {
        id: crypto.randomUUID(),
        type: "coach-chat",
        timestamp: Date.now(),
        content: reply,
      };
      setMessages((prev) => [...prev, replyMsg]);
      maybeSpeak(reply);
    })();
  }, [bpm, presetId, presetName, maybeSpeak]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const toggleCard = useCallback(() => {
    setCardOpen((v) => !v);
  }, []);

  return {
    active,
    messages,
    startedAt,
    cardOpen,
    startSession,
    endSession,
    sendChat,
    clearMessages,
    toggleCard,
    setCardOpen,
  };
}

function formatMiniReport(report: SessionReport): string {
  const accuracy = report.totalBeats > 0
    ? Math.round((report.hitsCount / report.totalBeats) * 100)
    : 0;
  return `Score ${report.score} · ${accuracy}% hits · avg ${Math.abs(report.meanDeviationMs).toFixed(1)}ms ${report.meanDeviationMs < 0 ? "early" : "late"}`;
}

/** Format context for the coach to generate a mini-report comment. */
function formatMiniReportContext(bpm: number, timeSignature: number, accuracy: number, report: SessionReport): string {
  const pocket = report.meanDeviationMs < -5 ? "ahead of the beat (rushing)"
    : report.meanDeviationMs > 5 ? "behind the beat (dragging)"
    : "right on the beat";
  const style = report.gridCorrelation > 0.8 ? "structured exercise (high grid correlation)"
    : report.gridCorrelation > 0.3 ? "semi-structured playing (medium grid correlation)"
    : "free/improvisational playing (low grid correlation)";
  return `The player just finished a passage. Generate a brief coaching comment.\nBPM: ${bpm}, Time signature: ${timeSignature}/4\nPlaying style: ${style}\nAccuracy: ${accuracy}% (${report.perfectCount} perfect, ${report.goodCount} good, ${report.okCount} ok, ${report.missCount} miss)\nTiming tendency: ${pocket} (avg ${report.meanDeviationMs.toFixed(1)}ms)\nLongest clean streak: ${report.longestStreak} beats`;
}

/** Format context for end-of-session summary. */
function formatSessionContext(durationSecs: number, segmentCount: number, score: number, grade: string, totalBeats: number, accuracy: number, meanDeviation: number, longestStreak: number): string {
  return `The player has ended their practice session. Generate a brief session summary.\nDuration: ${durationSecs} seconds, ${segmentCount} segment(s)\nOverall score: ${score}/100 (grade ${grade})\nTotal beats: ${totalBeats}, accuracy: ${accuracy}%\nTiming tendency: avg ${meanDeviation.toFixed(1)}ms deviation\nLongest clean streak: ${longestStreak} beats\nKeep it encouraging and suggest one specific thing to focus on next time.`;
}


/** Aggregate multiple segment reports into a single session report. */
function aggregateReports(reports: SessionReport[]): SessionReport {
  if (reports.length === 1) return reports[0];

  let totalBeats = 0, hitsCount = 0, missCount = 0, skippedBeats = 0;
  let perfectCount = 0, goodCount = 0, okCount = 0;
  let longestStreak = 0;
  const allDeviations: number[] = [];
  const allAmplitudes: number[] = [];
  const allIntervalErrors: number[] = [];
  const allGridCorrelations: number[] = [];

  for (const r of reports) {
    totalBeats += r.totalBeats;
    hitsCount += r.hitsCount;
    missCount += r.missCount;
    skippedBeats += r.skippedBeats;
    perfectCount += r.perfectCount;
    goodCount += r.goodCount;
    okCount += r.okCount;
    longestStreak = Math.max(longestStreak, r.longestStreak);
    allDeviations.push(...r.deviations);
    if (r.meanAmplitude > 0) allAmplitudes.push(r.meanAmplitude);
    if (r.meanIntervalErrorMs !== 0) allIntervalErrors.push(r.meanIntervalErrorMs);
    if (r.gridCorrelation > 0) allGridCorrelations.push(r.gridCorrelation);
  }

  const scored = hitsCount + missCount;
  const hitRate = scored > 0 ? hitsCount / scored : 0;

  const meanDev = allDeviations.length > 0
    ? allDeviations.reduce((a, b) => a + b, 0) / allDeviations.length
    : 0;
  const meanAbsDev = allDeviations.length > 0
    ? allDeviations.reduce((a, b) => a + Math.abs(b), 0) / allDeviations.length
    : 0;
  const stdDev = allDeviations.length > 1
    ? Math.sqrt(allDeviations.reduce((s, d) => s + (d - meanDev) ** 2, 0) / (allDeviations.length - 1))
    : 0;
  const meanIntervalError = allIntervalErrors.length > 0
    ? allIntervalErrors.reduce((a, b) => a + b, 0) / allIntervalErrors.length
    : 0;
  const meanAmp = allAmplitudes.length > 0
    ? allAmplitudes.reduce((a, b) => a + b, 0) / allAmplitudes.length
    : 0;
  const dynamicsStd = allAmplitudes.length > 1
    ? Math.sqrt(allAmplitudes.reduce((s, a) => s + (a - meanAmp) ** 2, 0) / (allAmplitudes.length - 1))
    : 0;
  const tempoStability = allIntervalErrors.length > 1
    ? Math.sqrt(allIntervalErrors.reduce((s, e) => s + (e - meanIntervalError) ** 2, 0) / (allIntervalErrors.length - 1))
    : 0;

  // Score: same formula as backend
  const accuracyScore = meanAbsDev > 0 ? Math.max(0, 100 - meanAbsDev * 2) : 100;
  const consistencyScore = stdDev > 0 ? Math.max(0, 100 - stdDev * 1.5) : 100;
  const score = Math.round(hitRate * 30 + accuracyScore * 0.5 + consistencyScore * 0.2);
  const clampedScore = Math.min(100, Math.max(0, score));

  const grade = clampedScore >= 95 ? "S" : clampedScore >= 85 ? "A" : clampedScore >= 70 ? "B"
    : clampedScore >= 55 ? "C" : clampedScore >= 40 ? "D" : "F";

  return {
    totalBeats, hitsCount, missCount, skippedBeats,
    perfectCount, goodCount, okCount,
    meanDeviationMs: meanDev,
    stdDeviationMs: stdDev,
    meanAbsDeviationMs: meanAbsDev,
    meanIntervalErrorMs: meanIntervalError,
    grade,
    score: clampedScore,
    deviations: allDeviations,
    dynamicsStd,
    meanAmplitude: meanAmp,
    tempoStabilityMs: tempoStability,
    longestStreak,
    comment: `${reports.length} segments played`,
    insights: [],
    gridCorrelation: allGridCorrelations.length > 0
      ? allGridCorrelations.reduce((a, b) => a + b, 0) / allGridCorrelations.length
      : 0,
  };
}

/** Build a compacted preset summary from session history — small enough for model context. */
function compactPresetSummary(presetName: string, sessions: { timestamp: number; bpm: number; report: { score: number; grade: string; meanDeviationMs: number; longestStreak: number; hitsCount: number; totalBeats: number } }[]): string {
  if (sessions.length === 0) return "";
  const count = sessions.length;
  const firstTs = sessions[sessions.length - 1].timestamp;
  const lastTs = sessions[0].timestamp;
  const spanDays = Math.max(1, Math.round((lastTs - firstTs) / (1000 * 60 * 60 * 24)));
  const bestScore = Math.max(...sessions.map((s) => s.report.score));
  const maxBpm = Math.max(...sessions.map((s) => s.bpm));
  const avgScore = Math.round(sessions.reduce((a, s) => a + s.report.score, 0) / count);
  const last = sessions[0];
  const lastAccuracy = last.report.totalBeats > 0 ? Math.round((last.report.hitsCount / last.report.totalBeats) * 100) : 0;

  // Find comfortable BPM (highest BPM with >85% accuracy)
  const comfortableBpm = sessions
    .filter((s) => s.report.totalBeats > 0 && (s.report.hitsCount / s.report.totalBeats) > 0.85)
    .reduce((max, s) => Math.max(max, s.bpm), 0);

  // Trend: compare last 3 vs first 3
  const recent = sessions.slice(0, Math.min(3, count));
  const early = sessions.slice(Math.max(0, count - 3));
  const recentAvg = recent.reduce((a, s) => a + s.report.score, 0) / recent.length;
  const earlyAvg = early.reduce((a, s) => a + s.report.score, 0) / early.length;
  const trend = recentAvg > earlyAvg + 5 ? "improving" : recentAvg < earlyAvg - 5 ? "declining" : "steady";

  const daysSince = Math.round((Date.now() - lastTs) / (1000 * 60 * 60 * 24));
  const lastAgo = daysSince === 0 ? "today" : daysSince === 1 ? "yesterday" : `${daysSince} days ago`;

  return `Preset: ${presetName}\nSessions: ${count} over ${spanDays} day(s)\nBest score: ${bestScore}/100\nAvg score: ${avgScore}/100\nComfortable BPM: ${comfortableBpm || "N/A"} (>85% accuracy)\nMax BPM attempted: ${maxBpm}\nTrend: ${trend}\nLast session: ${lastAgo}, score ${last.report.score}/100 at ${last.bpm} BPM, ${lastAccuracy}% accuracy`;
}

/** Analyze a sliding window of beat feedback for real-time coaching trends. */
function analyzeRealtimeTrend(
  window: BeatFeedback[],
  prevBestStreak: number,
): { template: string; context: string; urgency: "urgent" | "normal"; streak: number } | null {
  if (window.length < 8) return null;

  const hits = window.filter((fb) => fb.classification !== "miss" && fb.classification !== "skipped");
  const misses = window.filter((fb) => fb.classification === "miss");
  const hitRate = hits.length / window.length;

  // Compute deviation stats from hits only
  const deviations = hits.map((fb) => fb.deviationMs);
  const meanDev = deviations.length > 0
    ? deviations.reduce((a, b) => a + b, 0) / deviations.length : 0;

  // Trend detection: compare first half vs second half of the window
  const mid = Math.floor(deviations.length / 2);
  const firstHalf = deviations.slice(0, mid);
  const secondHalf = deviations.slice(mid);
  const firstMean = firstHalf.length > 0 ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length : 0;
  const secondMean = secondHalf.length > 0 ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length : 0;
  const drift = secondMean - firstMean;

  // Compute current streak of non-miss beats from the end
  let streak = 0;
  for (let i = window.length - 1; i >= 0; i--) {
    if (window[i].classification === "miss") break;
    if (window[i].classification !== "skipped") streak++;
  }

  // Priority 1: Significant rushing (urgent)
  if (meanDev < -12 && drift < -3) {
    return {
      template: `You're rushing — average ${Math.abs(meanDev).toFixed(0)}ms early and still speeding up.`,
      context: `The player is rushing during active play. Generate a brief coaching tip (1 sentence).\nAvg deviation: ${meanDev.toFixed(1)}ms (negative = early)\nDrift trend: getting ${Math.abs(drift).toFixed(1)}ms more early over the last ${window.length} beats\nHit rate: ${Math.round(hitRate * 100)}%\nBe direct but encouraging.`,
      urgency: "urgent",
      streak,
    };
  }

  // Priority 2: Significant dragging (urgent)
  if (meanDev > 12 && drift > 3) {
    return {
      template: `You're dragging — average ${meanDev.toFixed(0)}ms late and falling further behind.`,
      context: `The player is dragging during active play. Generate a brief coaching tip (1 sentence).\nAvg deviation: ${meanDev.toFixed(1)}ms (positive = late)\nDrift trend: getting ${drift.toFixed(1)}ms more late over the last ${window.length} beats\nHit rate: ${Math.round(hitRate * 100)}%\nBe direct but encouraging.`,
      urgency: "urgent",
      streak,
    };
  }

  // Priority 3: Accuracy drop (urgent)
  if (hitRate < 0.5 && misses.length >= 3) {
    return {
      template: `Accuracy is dropping — ${misses.length} misses in the last ${window.length} beats. Consider slowing down.`,
      context: `The player's accuracy has dropped significantly. Generate a brief coaching tip (1 sentence).\nHit rate: ${Math.round(hitRate * 100)}% over the last ${window.length} beats\nMisses: ${misses.length}\nAvg deviation: ${meanDev.toFixed(1)}ms\nSuggest slowing down or focusing. Be supportive.`,
      urgency: "urgent",
      streak,
    };
  }

  // Priority 4: New personal best streak (urgent — positive)
  if (streak >= 16 && streak > prevBestStreak && prevBestStreak >= 8) {
    return {
      template: `${streak} beats clean — new personal best streak! Keep it locked in.`,
      context: `The player just hit a new personal best clean streak during this session. Generate a brief, celebratory coaching comment (1 sentence).\nCurrent streak: ${streak} beats without a miss\nPrevious best this session: ${prevBestStreak}\nKeep it short and motivating.`,
      urgency: "urgent",
      streak,
    };
  }

  // Priority 5: Consistent good playing (normal — appears in feed silently)
  if (hitRate > 0.85 && Math.abs(meanDev) < 8 && streak >= 12) {
    return {
      template: `Solid run — ${Math.round(hitRate * 100)}% accuracy, staying in the pocket.`,
      context: `The player is playing consistently well. Generate a brief positive coaching note (1 sentence).\nHit rate: ${Math.round(hitRate * 100)}%\nAvg deviation: ${meanDev.toFixed(1)}ms\nCurrent streak: ${streak} beats\nKeep it brief, acknowledge the consistency.`,
      urgency: "normal",
      streak,
    };
  }

  // Priority 6: Slight rushing or dragging tendency (normal)
  if (Math.abs(meanDev) > 8 && hits.length >= 8) {
    const tendency = meanDev < 0 ? "early" : "late";
    return {
      template: `You're sitting about ${Math.abs(meanDev).toFixed(0)}ms ${tendency} — not bad, just a gentle ${meanDev < 0 ? "rush" : "drag"}.`,
      context: `The player has a slight timing tendency. Generate a brief observation (1 sentence).\nAvg deviation: ${meanDev.toFixed(1)}ms (${tendency})\nHit rate: ${Math.round(hitRate * 100)}%\nThis is a gentle note, not urgent. Be encouraging.`,
      urgency: "normal",
      streak,
    };
  }

  return null;
}

/** Play a subtle notification chime using Web Audio API. */
function playChime(freq: number = 880) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    osc.onended = () => ctx.close();
  } catch { /* audio context not available */ }
}

/** Format context for the coach model to make an adaptive drill decision. */
function formatAdaptiveEvalContext(req: AdaptiveEvalRequest): string {
  const noCeiling = req.targetBpm >= 300;
  const progress = noCeiling
    ? `Open-ended (no ceiling), currently at ${req.currentBpm} BPM`
    : `${req.currentBpm} of ${req.targetBpm} BPM target (${Math.round(((req.currentBpm - req.startBpm) / Math.max(1, req.targetBpm - req.startBpm)) * 100)}% progress)`;

  return `You are coaching a drill session. The player just finished a round. Decide the next tempo change.\n\nCurrent BPM: ${req.currentBpm}\nStart BPM: ${req.startBpm}\nProgress: ${progress}\nAccuracy last round: ${req.accuracyPct}%\nAggressiveness: ${req.aggressiveness}\nStep number: ${req.currentStep}\n\nBased on the accuracy and aggressiveness setting, should the tempo go UP, HOLD, or DOWN?\nReply with exactly one word on the first line: UP, HOLD, or DOWN.\nOptionally add a brief coaching comment on the second line (1 sentence max).`;
}

/** Parse the model's adaptive decision response. */
function parseAdaptiveDecision(response: string): "up" | "hold" | "down" {
  const firstLine = response.trim().split("\n")[0].trim().toUpperCase();
  if (firstLine.startsWith("UP")) return "up";
  if (firstLine.startsWith("DOWN")) return "down";
  return "hold";
}
