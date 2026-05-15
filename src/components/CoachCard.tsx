import { useEffect, useRef, useState, useCallback } from "react";
import { ScoreRing, ScoreBadge, MiniSparkline, BreakdownBar, Histogram } from "./evaluation";
import { FEEDBACK_COLORS } from "../hooks/useEvaluation";
import { getSessionHistory, deleteSession, clearAllSessions } from "../ipc";
import type { FeedMessage, SessionReport, SavedSession, SessionSegment, AudioSpectrum } from "../types";
import "../styles/coach-card.css";
import "../styles/evaluation-panel.css";

interface CoachCardProps {
  open: boolean;
  active: boolean;
  messages: FeedMessage[];
  onToggle: () => void;
  onStartSession: () => void;
  onEndSession: () => void;
  onSendChat?: (message: string) => void;
  listening?: boolean;
  hasSignal?: boolean;
  spectrum?: AudioSpectrum | null;
}

type CardTab = "feed" | "history";
type HistoryView = "list" | "detail";

export default function CoachCard({ open, active, messages, onToggle, onStartSession, onEndSession, onSendChat, listening, hasSignal, spectrum }: CoachCardProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [chatInput, setChatInput] = useState("");
  const [tab, setTab] = useState<CardTab>("feed");
  const [closing, setClosing] = useState(false);
  const [showCard, setShowCard] = useState(open);

  // Handle open/close with exit animation
  useEffect(() => {
    if (open) {
      setClosing(false);
      setShowCard(true);
    } else if (showCard) {
      setClosing(true);
      const timer = setTimeout(() => {
        setClosing(false);
        setShowCard(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // History state
  const [history, setHistory] = useState<SavedSession[]>([]);
  const [historyView, setHistoryView] = useState<HistoryView>("list");
  const [selectedSession, setSelectedSession] = useState<SavedSession | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Auto-scroll feed to bottom on new messages
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Switch to feed tab when session starts
  useEffect(() => {
    if (active) setTab("feed");
  }, [active]);

  // Load history when switching to history tab
  useEffect(() => {
    if (tab === "history" && open) {
      getSessionHistory().then(setHistory);
    }
  }, [tab, open]);

  const handleSelectSession = useCallback((session: SavedSession) => {
    setSelectedSession(session);
    setHistoryView("detail");
  }, []);

  const handleBack = useCallback(() => {
    setHistoryView("list");
    setSelectedSession(null);
    getSessionHistory().then(setHistory);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    await deleteSession(id);
    setHistory((h) => h.filter((s) => s.id !== id));
    if (selectedSession?.id === id) {
      setHistoryView("list");
      setSelectedSession(null);
    }
  }, [selectedSession]);

  const handleClearAll = useCallback(async () => {
    await clearAllSessions();
    setHistory([]);
    setHistoryView("list");
    setSelectedSession(null);
    setShowClearConfirm(false);
  }, []);

  if (!showCard) {
    return (
      <button
        className={`coach-card-pill ${active ? "coach-active" : ""}`}
        onClick={onToggle}
        title="Practice Coach"
      >
        {listening && <span className={`coach-status-dot ${hasSignal ? "signal" : "listening"}`} />}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z" />
          <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2z" />
        </svg>
        <span className="coach-card-pill-label">Practice Coach</span>
      </button>
    );
  }

  return (
    <div className={`coach-card coach-card-open${closing ? " coach-card-closing" : ""}`}>
      <div className="coach-card-inner">
        <div className="coach-card-header">
          {tab === "history" && historyView === "detail" ? (
            <button className="coach-card-header-btn" onClick={handleBack}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              {" "}Back
            </button>
          ) : (
            <span className="coach-card-title">
              <span className={`coach-status-dot ${listening ? (hasSignal ? "signal" : "listening") : ""}`} />
              Practice Coach
              {active && listening && spectrum && (
                <span className={`coach-title-spectrum ${hasSignal ? "has-signal" : ""}`}>
                  {Array.from({ length: 5 }, (_, i) => {
                    const bands = spectrum.bands ?? [];
                    const step = Math.max(1, Math.floor(bands.length / 5));
                    const level = i * step < bands.length ? bands[i * step] : 0;
                    return <span key={i} className="coach-title-spectrum-bar" style={{ height: `${Math.max(2, level * 100)}%` }} />;
                  })}
                </span>
              )}
            </span>
          )}
          <div className="coach-card-header-actions">
            {active && tab === "feed" && (
              <button className="coach-card-header-btn coach-card-end-btn" onClick={onEndSession}>
                End
              </button>
            )}
            {!active && tab === "feed" && (
              <button className="coach-card-header-btn coach-card-start-btn" onClick={onStartSession}>
                Start
              </button>
            )}
            {tab === "history" && historyView === "list" && history.length > 0 && (
              <button className="coach-card-header-btn" onClick={() => setShowClearConfirm(true)} title="Clear all">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              </button>
            )}
            <button className="coach-card-header-btn" onClick={onToggle} title="Collapse">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="coach-card-tabs">
          <button
            className={`coach-card-tab ${tab === "feed" ? "active" : ""}`}
            onClick={() => { setTab("feed"); setHistoryView("list"); setSelectedSession(null); }}
          >
            Feed
          </button>
          <button
            className={`coach-card-tab ${tab === "history" ? "active" : ""}`}
            onClick={() => setTab("history")}
          >
            History
          </button>
        </div>

        {tab === "feed" ? (
          <>
            {messages.length === 0 ? (
              <div className="coach-card-empty">
                <div className="coach-card-empty-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                </div>
                <p className="coach-card-empty-text">
                  Start a session to begin.<br/>
                  The coach listens while you play.
                </p>
              </div>
            ) : (
              <div className="coach-card-feed" ref={feedRef}>
                {messages.map((msg) => (
                  <FeedMessageItem key={msg.id} message={msg} />
                ))}
              </div>
            )}

            {/* Chat input */}
            <div className="coach-card-chat">
              <input
                className="coach-card-chat-input"
                type="text"
                placeholder="Ask the coach..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" && chatInput.trim()) {
                    onSendChat?.(chatInput.trim());
                    setChatInput("");
                  }
                }}
              />
              <button
                className="coach-card-chat-send"
                disabled={!chatInput.trim()}
                onClick={() => { onSendChat?.(chatInput.trim()); setChatInput(""); }}
                title="Send"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </>
        ) : (
          <>
            {showClearConfirm && (
              <div className="coach-confirm-overlay" onClick={() => setShowClearConfirm(false)}>
                <div className="coach-confirm-dialog" onClick={(e) => e.stopPropagation()}>
                  <p>Delete all sessions? This can't be undone.</p>
                  <div className="coach-confirm-actions">
                    <button className="coach-confirm-cancel" onClick={() => setShowClearConfirm(false)}>Cancel</button>
                    <button className="coach-confirm-delete" onClick={handleClearAll}>Delete all</button>
                  </div>
                </div>
              </div>
            )}

            {historyView === "list" ? (
              <HistoryList
                sessions={history}
                onSelect={handleSelectSession}
                onDelete={handleDelete}
              />
            ) : selectedSession ? (
              <SessionDetail
                session={selectedSession}
                onDelete={() => handleDelete(selectedSession.id)}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Feed Messages ──────────────────────────────────────────────────────────

function FeedMessageItem({ message }: { message: FeedMessage }) {
  switch (message.type) {
    case "session-start":
    case "system":
    case "coach-tip":
    case "coach-chat":
      return (
        <div className={`coach-feed-msg ${
          message.type === "coach-tip" ? "coach-feed-msg-tip" :
          message.type === "coach-chat" ? "coach-feed-msg-coach" :
          "coach-feed-msg-system"
        }`}>
          <span>{message.content}</span>
          <div className="coach-feed-msg-time">{formatTime(message.timestamp)}</div>
        </div>
      );

    case "user-chat":
      return (
        <div className="coach-feed-msg coach-feed-msg-user">
          <span>{message.content}</span>
          <div className="coach-feed-msg-time">{formatTime(message.timestamp)}</div>
        </div>
      );

    case "mini-report":
      return (
        <div className="coach-feed-msg coach-feed-msg-mini-report">
          {message.report && (
            <div className="coach-mini-report-header">
              <ScoreRing score={message.report.score} size={40} strokeWidth={4} />
              <div className="coach-mini-report-stats">
                <span className="coach-mini-report-score-label">
                  {message.meta?.bpm ? `${message.meta.bpm} BPM` : "Segment"}
                </span>
                <span className="coach-mini-report-text">{message.content}</span>
              </div>
            </div>
          )}
          <div className="coach-feed-msg-time">{formatTime(message.timestamp)}</div>
        </div>
      );

    case "session-end":
      return (
        <div className="coach-feed-msg coach-feed-msg-session-end">
          <div className="coach-end-report-title">Session Complete</div>
          {message.content && <div className="coach-end-report-comment">{message.content}</div>}
          {message.report ? (
            <EndReportSummary report={message.report} />
          ) : (
            <span className="coach-mini-report-text">{message.content}</span>
          )}
          {message.segments && message.segments.length > 1 && (
            <SegmentTimeline segments={message.segments} sessionStart={message.segments[0].startTime ?? message.timestamp} />
          )}
          <div className="coach-feed-msg-time">{formatTime(message.timestamp)}</div>
        </div>
      );

    default:
      return null;
  }
}

function EndReportSummary({ report }: { report: SessionReport }) {
  const accuracy = report.totalBeats > 0
    ? Math.round((report.hitsCount / report.totalBeats) * 100)
    : 0;

  return (
    <>
      <div className="coach-mini-report-header">
        <ScoreRing score={report.score} size={52} strokeWidth={5} />
        <div className="coach-mini-report-stats">
          <span className="coach-mini-report-score-label">Final Score</span>
          <span className="coach-mini-report-text">{report.grade}</span>
        </div>
      </div>
      <div className="coach-end-report-grid">
        <div className="coach-end-report-stat">
          <span className="coach-end-report-stat-label">Accuracy</span>
          <span className="coach-end-report-stat-value">{accuracy}%</span>
        </div>
        <div className="coach-end-report-stat">
          <span className="coach-end-report-stat-label">Avg Deviation</span>
          <span className="coach-end-report-stat-value">{Math.abs(report.meanDeviationMs).toFixed(1)}ms</span>
        </div>
        <div className="coach-end-report-stat">
          <span className="coach-end-report-stat-label">Beats</span>
          <span className="coach-end-report-stat-value">{report.totalBeats}</span>
        </div>
        <div className="coach-end-report-stat">
          <span className="coach-end-report-stat-label">Best Streak</span>
          <span className="coach-end-report-stat-value">{report.longestStreak}</span>
        </div>
      </div>
    </>
  );
}

// ─── Segment Timeline ──────────────────────────────────────────────────────

function SegmentTimeline({ segments, sessionStart }: { segments: SessionSegment[]; sessionStart: number }) {
  return (
    <div className="coach-segment-timeline">
      <div className="coach-segment-timeline-title">Timeline</div>
      {segments.map((seg, i) => {
        const start = seg.startTime ?? sessionStart;
        const end = seg.endTime ?? start;
        const offsetSec = Math.round((start - sessionStart) / 1000);
        const durationSec = Math.round((end - start) / 1000);
        const accuracy = seg.report.totalBeats > 0
          ? Math.round((seg.report.hitsCount / seg.report.totalBeats) * 100) : 0;
        const style = seg.report.gridCorrelation > 0.8 ? "Grid exercise"
          : seg.report.gridCorrelation > 0.3 ? "Semi-structured"
          : "Free playing";
        const pocket = seg.report.meanDeviationMs < -5 ? "rushing"
          : seg.report.meanDeviationMs > 5 ? "dragging" : "on beat";

        return (
          <div key={i} className="coach-segment-row">
            <div className="coach-segment-time">
              {formatDuration(offsetSec)}–{formatDuration(offsetSec + durationSec)}
            </div>
            <div className="coach-segment-info">
              <span className="coach-segment-style">{style}</span>
              <span className="coach-segment-sep">&middot;</span>
              <span>{seg.bpm} BPM</span>
              <span className="coach-segment-sep">&middot;</span>
              <span>{accuracy}%</span>
              <span className="coach-segment-sep">&middot;</span>
              <span>{pocket}</span>
            </div>
            <ScoreBadge score={seg.report.score} />
          </div>
        );
      })}
    </div>
  );
}

function formatDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── History List ───────────────────────────────────────────────────────────

function HistoryList({
  sessions,
  onSelect,
  onDelete,
}: {
  sessions: SavedSession[];
  onSelect: (s: SavedSession) => void;
  onDelete: (id: string) => void;
}) {
  if (sessions.length === 0) {
    return (
      <div className="coach-card-empty">
        <p className="coach-card-empty-text">
          No sessions yet.<br/>
          Complete a practice session to build your history.
        </p>
      </div>
    );
  }

  const grouped = groupByDay(sessions);

  return (
    <div className="coach-history-list">
      {grouped.map((group) => (
        <div key={group.label}>
          <div className="coach-history-heading">{group.label}</div>
          {group.sessions.map((session) => (
            <div
              key={session.id}
              className="coach-history-card"
              onClick={() => onSelect(session)}
            >
              <button
                className="coach-history-delete"
                onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
              <div className="coach-history-card-top">
                <ScoreBadge score={session.report.score} />
                <span className="coach-history-time">
                  {new Date(session.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </span>
                <span className="coach-history-sep">&middot;</span>
                <span className="coach-history-bpm">{session.bpm} BPM</span>
              </div>
              {session.presetName && (
                <div className="coach-history-preset">{session.presetName}</div>
              )}
              {session.report.comment && (
                <div className="coach-history-comment">{session.report.comment}</div>
              )}
              {session.report.deviations.length > 2 && (
                <MiniSparkline deviations={session.report.deviations} />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Session Detail ─────────────────────────────────────────────────────────

function SessionDetail({
  session,
  onDelete,
}: {
  session: SavedSession;
  onDelete: () => void;
}) {
  const report = session.report;
  const hitRate = (report.hitsCount + report.missCount) > 0
    ? Math.round((report.hitsCount / (report.hitsCount + report.missCount)) * 100)
    : 0;

  return (
    <div className="coach-detail">
      <div className="coach-detail-ring">
        <ScoreRing score={report.score} size={80} strokeWidth={5} />
        <div className="coach-detail-meta">
          {session.presetName && <>{session.presetName} &middot; </>}
          {session.bpm} BPM &middot; {formatDate(session.timestamp)}
        </div>
        {report.comment && (
          <div className="coach-detail-comment">{report.comment}</div>
        )}
      </div>

      {report.insights.length > 0 && (
        <div className="coach-detail-insights">
          {report.insights.map((insight, i) => (
            <div key={i} className="coach-detail-insight">{insight}</div>
          ))}
        </div>
      )}

      <div className="coach-detail-section">
        <div className="coach-detail-section-title">Breakdown</div>
        <div className="coach-detail-bars">
          <BreakdownBar label="Perfect" count={report.perfectCount} total={report.hitsCount + report.missCount} color={FEEDBACK_COLORS.perfect} />
          <BreakdownBar label="Good" count={report.goodCount} total={report.hitsCount + report.missCount} color={FEEDBACK_COLORS.good} />
          <BreakdownBar label="OK" count={report.okCount} total={report.hitsCount + report.missCount} color={FEEDBACK_COLORS.ok} />
          <BreakdownBar label="Miss" count={report.missCount} total={report.hitsCount + report.missCount} color={FEEDBACK_COLORS.miss} />
        </div>
      </div>

      {report.deviations.length > 4 && (
        <div className="coach-detail-section">
          <div className="coach-detail-section-title">Timing Distribution</div>
          <Histogram deviations={report.deviations} />
        </div>
      )}

      <div className="coach-detail-section">
        <div className="coach-detail-section-title">Details</div>
        <div className="coach-detail-stats">
          <div className="coach-detail-stat">
            <span className="coach-detail-stat-label">Hit rate</span>
            <span className="coach-detail-stat-value">{hitRate}%</span>
          </div>
          <div className="coach-detail-stat">
            <span className="coach-detail-stat-label">Avg deviation</span>
            <span className="coach-detail-stat-value">
              {report.meanDeviationMs >= 0 ? "+" : ""}{report.meanDeviationMs.toFixed(1)}ms
            </span>
          </div>
          <div className="coach-detail-stat">
            <span className="coach-detail-stat-label">Consistency</span>
            <span className="coach-detail-stat-value">{"\u00B1"}{report.stdDeviationMs.toFixed(1)}ms</span>
          </div>
          <div className="coach-detail-stat">
            <span className="coach-detail-stat-label">Tempo stability</span>
            <span className="coach-detail-stat-value">{"\u00B1"}{report.tempoStabilityMs.toFixed(1)}ms</span>
          </div>
          <div className="coach-detail-stat">
            <span className="coach-detail-stat-label">Longest streak</span>
            <span className="coach-detail-stat-value">{report.longestStreak}</span>
          </div>
          <div className="coach-detail-stat">
            <span className="coach-detail-stat-label">Scored beats</span>
            <span className="coach-detail-stat-value">{report.hitsCount + report.missCount}</span>
          </div>
          {report.skippedBeats > 0 && (
            <div className="coach-detail-stat">
              <span className="coach-detail-stat-label">Skipped</span>
              <span className="coach-detail-stat-value">{report.skippedBeats}</span>
            </div>
          )}
        </div>
      </div>

      <button className="coach-detail-delete-btn" onClick={onDelete}>Delete Session</button>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - dateDay.getTime()) / (1000 * 60 * 60 * 24));
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  if (diffDays < 7) return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getDayGroup(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - dateDay.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: "long" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function groupByDay(sessions: SavedSession[]): { label: string; sessions: SavedSession[] }[] {
  const groups: { label: string; sessions: SavedSession[] }[] = [];
  let currentLabel = "";
  for (const session of sessions) {
    const label = getDayGroup(session.timestamp);
    if (label !== currentLabel) {
      groups.push({ label, sessions: [session] });
      currentLabel = label;
    } else {
      groups[groups.length - 1].sessions.push(session);
    }
  }
  return groups;
}
