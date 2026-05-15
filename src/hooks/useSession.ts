import { useState, useEffect, useRef, useCallback } from "react";
import { useEvaluation } from "./useEvaluation";
import { getSessionReport, saveSession, clearSession } from "../ipc";
import type { FeedMessage, SessionReport } from "../types";

interface UseSessionOptions {
  isPlaying: boolean;
  bpm: number;
  timeSignature: number;
  presetName?: string;
}

export function useSession({ isPlaying, bpm, timeSignature, presetName }: UseSessionOptions) {
  const evaluation = useEvaluation();
  const [active, setActive] = useState(false);
  const [messages, setMessages] = useState<FeedMessage[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const wasPlayingRef = useRef(false);
  // Track bpm at time play started for accurate mini-report meta
  const playBpmRef = useRef(bpm);
  // Collect segment reports for aggregated end-of-session summary
  const segmentReportsRef = useRef<{ report: SessionReport; bpm: number; timeSignature: number }[]>([]);

  // Track when play starts to capture bpm
  useEffect(() => {
    if (isPlaying && !wasPlayingRef.current) {
      playBpmRef.current = bpm;
    }
  }, [isPlaying, bpm]);

  // Auto mini-reports: when playback stops during an active session
  useEffect(() => {
    if (wasPlayingRef.current && !isPlaying && active) {
      const segmentBpm = playBpmRef.current;
      getSessionReport().then((report) => {
        if (report && (report.hitsCount + report.missCount) >= 8) {
          segmentReportsRef.current.push({ report, bpm: segmentBpm, timeSignature });
          const msg: FeedMessage = {
            id: crypto.randomUUID(),
            type: "mini-report",
            timestamp: Date.now(),
            content: formatMiniReport(report),
            report,
            meta: { bpm: segmentBpm, timeSignature },
          };
          setMessages((prev) => [...prev, msg]);
          // Clear accumulator so next play segment starts fresh
          clearSession();
        }
      });
    }
    wasPlayingRef.current = isPlaying;
  }, [isPlaying, active, timeSignature]);

  const startSession = useCallback(async () => {
    if (active) return;
    // Clear any previous session data on backend
    await clearSession();
    segmentReportsRef.current = [];
    const now = Date.now();
    setActive(true);
    setStartedAt(now);
    setCardOpen(true);

    const greeting = presetName
      ? `Session started — ${presetName}. Play when you're ready.`
      : "Session started. Play when you're ready.";

    setMessages([{
      id: crypto.randomUUID(),
      type: "session-start",
      timestamp: now,
      content: greeting,
    }]);
    // Start the audio pipeline
    if (!evaluation.enabled) {
      evaluation.toggle();
    }
  }, [active, evaluation, presetName]);

  const endSession = useCallback(async () => {
    if (!active) return;

    // If there's unsaved data from a segment still in progress, fetch it
    const lastReport = await getSessionReport();
    if (lastReport && (lastReport.hitsCount + lastReport.missCount) >= 8) {
      segmentReportsRef.current.push({ report: lastReport, bpm, timeSignature });
    }

    const now = Date.now();
    const segments = segmentReportsRef.current;

    // Build aggregated report from all segments
    const aggregated = segments.length > 0 ? aggregateReports(segments.map(s => s.report)) : null;

    const endMsg: FeedMessage = {
      id: crypto.randomUUID(),
      type: "session-end",
      timestamp: now,
      content: aggregated ? "Session complete." : "Session ended — no data recorded.",
      report: aggregated ?? undefined,
      meta: { bpm, timeSignature },
    };
    setMessages((prev) => [...prev, endMsg]);

    // Save to history if we have meaningful data
    if (aggregated && (aggregated.hitsCount + aggregated.missCount) >= 8) {
      await saveSession({
        id: crypto.randomUUID(),
        timestamp: startedAt ?? now,
        bpm,
        timeSignature,
        report: aggregated,
      });
    }

    // Stop audio pipeline
    if (evaluation.enabled) {
      evaluation.toggle();
    }

    segmentReportsRef.current = [];
    setActive(false);
    setStartedAt(null);
  }, [active, evaluation, bpm, timeSignature, startedAt]);

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
    clearMessages,
    toggleCard,
    setCardOpen,
    evaluation,
  };
}

function formatMiniReport(report: SessionReport): string {
  const accuracy = report.totalBeats > 0
    ? Math.round((report.hitsCount / report.totalBeats) * 100)
    : 0;
  return `Score ${report.score} · ${accuracy}% hits · avg ${Math.abs(report.meanDeviationMs).toFixed(1)}ms ${report.meanDeviationMs < 0 ? "early" : "late"}`;
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
  };
}
