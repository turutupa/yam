import { useState, useEffect, useCallback } from "react";
import { clearSession, getSessionHistory, deleteSession, clearAllSessions } from "../ipc";
import { FEEDBACK_COLORS } from "../hooks/useEvaluation";
import { ScoreRing, BreakdownBar, Histogram, ScoreBadge, MiniSparkline } from "./evaluation";
import type { SessionReport, SavedSession } from "../types";
import "../styles/evaluation-panel.css";

interface EvaluationPanelProps {
  open: boolean;
  onClose: () => void;
  onToggle: () => void;
  /** If set, panel opens directly to this report (e.g. after playback stops) */
  currentReport?: SessionReport | null;
  currentMeta?: { bpm: number; timestamp: number } | null;
  /** Lifted state for persistence across unmount/remount */
  panelView: "history" | "detail";
  setPanelView: (v: "history" | "detail") => void;
  selectedReport: SessionReport | null;
  setSelectedReport: (r: SessionReport | null) => void;
  selectedMeta: { bpm: number; timestamp: number; id?: string } | null;
  setSelectedMeta: (m: { bpm: number; timestamp: number; id?: string } | null) => void;
}

export default function EvaluationPanel({ open, onClose, onToggle, currentReport, currentMeta, panelView, setPanelView, selectedReport, setSelectedReport, selectedMeta, setSelectedMeta }: EvaluationPanelProps) {
  const [history, setHistory] = useState<SavedSession[]>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Load history when panel opens
  useEffect(() => {
    if (open) {
      getSessionHistory().then(setHistory);
      // If we have a fresh report from playback stop, show it
      if (currentReport) {
        setSelectedReport(currentReport);
        setSelectedMeta(currentMeta ? { bpm: currentMeta.bpm, timestamp: currentMeta.timestamp } : null);
        setPanelView("detail");
      }
      // Otherwise keep existing view state (don't reset on remount)
    }
  }, [open, currentReport, currentMeta]);

  const handleSelectSession = useCallback((session: SavedSession) => {
    setSelectedReport(session.report);
    setSelectedMeta({ bpm: session.bpm, timestamp: session.timestamp, id: session.id });
    setPanelView("detail");
  }, []);

  const handleBack = useCallback(() => {
    setPanelView("history");
    setSelectedReport(null);
    setSelectedMeta(null);
    // Refresh history in case something changed
    getSessionHistory().then(setHistory);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    await deleteSession(id);
    setHistory((h) => h.filter((s) => s.id !== id));
    if (selectedMeta?.id === id) {
      setPanelView("history");
      setSelectedReport(null);
      setSelectedMeta(null);
    }
  }, [selectedMeta]);

  const handleClearCurrent = useCallback(async () => {
    await clearSession();
    onClose();
  }, [onClose]);

  const handleClearAll = useCallback(async () => {
    await clearAllSessions();
    setHistory([]);
    setPanelView("history");
    setSelectedReport(null);
    setSelectedMeta(null);
    setShowClearConfirm(false);
  }, []);

  const sessionsIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );

  return (
    <div className={`eval-panel ${open ? "open" : ""}`}>
      {!open && (
        <button
          className="eval-panel-collapsed-tab"
          onClick={onToggle}
          title="Sessions"
        >
          {sessionsIcon}
        </button>
      )}
      <div className="eval-panel-inner">
        {open && (
          <>
            <div className="eval-panel-header">
              {panelView === "detail" ? (
                <button className="eval-back-btn" onClick={handleBack}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 12H5M12 19l-7-7 7-7" />
                  </svg>
                  Sessions
                </button>
              ) : (
                <h3>Sessions</h3>
              )}
              {panelView === "history" && history.length > 0 && (
                <button
                  className="eval-clear-all-btn"
                  onClick={() => setShowClearConfirm(true)}
                  title="Clear all sessions"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                  <span className="eval-clear-all-label">Clear all</span>
                </button>
              )}
              <button className="eval-panel-close" onClick={onToggle} title="Close sessions">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {showClearConfirm && (
              <div className="eval-confirm-overlay" onClick={() => setShowClearConfirm(false)}>
                <div className="eval-confirm-dialog" onClick={(e) => e.stopPropagation()}>
                  <p>Delete all sessions? This can't be undone.</p>
                  <div className="eval-confirm-actions">
                    <button className="eval-confirm-cancel" onClick={() => setShowClearConfirm(false)}>Cancel</button>
                    <button className="eval-confirm-delete" onClick={handleClearAll}>Delete all</button>
                  </div>
                </div>
              </div>
            )}

            {panelView === "history" ? (
              <HistoryList
                sessions={history}
                onSelect={handleSelectSession}
                onDelete={handleDelete}
              />
            ) : selectedReport ? (
              <ReportDetail
                report={selectedReport}
                meta={selectedMeta}
                onDelete={selectedMeta?.id ? () => handleDelete(selectedMeta.id!) : undefined}
                onClearCurrent={!selectedMeta?.id ? handleClearCurrent : undefined}
              />
            ) : (
              <div className="eval-panel-empty">
                <p>No session data yet.</p>
                <p>Play with evaluation enabled to see your timing report.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── History List ────────────────────────────────────────────────────────────

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
      <div className="eval-panel-empty">
        <p>No sessions yet.</p>
        <p>Play with evaluation enabled to build your history.</p>
      </div>
    );
  }

  const grouped = groupByDay(sessions);

  return (
    <div className="eval-history-list">
      {grouped.map((group) => (
        <div key={group.label}>
          <div className="eval-history-heading">{group.label}</div>
          {group.sessions.map((session) => (
        <div
          key={session.id}
          className="eval-history-card"
          onClick={() => onSelect(session)}
        >
          <button
            className="eval-history-delete"
            onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <div className="eval-card-top">
            <ScoreBadge score={session.report.score} />
            <span className="eval-card-time">{new Date(session.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            <span className="eval-card-sep">&middot;</span>
            <span className="eval-card-bpm">{session.bpm} BPM</span>
          </div>
          {session.report.comment && (
            <div className="eval-card-comment">{session.report.comment}</div>
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

// ─── Report Detail ───────────────────────────────────────────────────────────

function ReportDetail({
  report,
  meta,
  onDelete,
  onClearCurrent,
}: {
  report: SessionReport;
  meta: { bpm: number; timestamp: number; id?: string } | null;
  onDelete?: () => void;
  onClearCurrent?: () => void;
}) {
  return (
    <div className="eval-panel-body">
      <div className="eval-ring-section">
        <ScoreRing score={report.score} size={96} strokeWidth={6} />
        {meta && (
          <div className="eval-ring-meta">
            {meta.bpm} BPM &middot; {formatDate(meta.timestamp)}
          </div>
        )}
        <div className="eval-comment">{report.comment}</div>
      </div>

      {report.insights.length > 0 && (
        <div className="eval-insights">
          {report.insights.map((insight, i) => (
            <div key={i} className="eval-insight">{insight}</div>
          ))}
        </div>
      )}

      <div className="eval-breakdown">
        <div className="eval-breakdown-title">Breakdown</div>
        <div className="eval-breakdown-bars">
          <BreakdownBar label="Perfect" count={report.perfectCount} total={report.hitsCount + report.missCount} color={FEEDBACK_COLORS.perfect} />
          <BreakdownBar label="Good" count={report.goodCount} total={report.hitsCount + report.missCount} color={FEEDBACK_COLORS.good} />
          <BreakdownBar label="OK" count={report.okCount} total={report.hitsCount + report.missCount} color={FEEDBACK_COLORS.ok} />
          <BreakdownBar label="Miss" count={report.missCount} total={report.hitsCount + report.missCount} color={FEEDBACK_COLORS.miss} />
        </div>
      </div>

      {report.deviations.length > 4 && (
        <div className="eval-histogram">
          <div className="eval-breakdown-title">Timing Distribution</div>
          <Histogram deviations={report.deviations} />
        </div>
      )}

      <div className="eval-stats">
        <div className="eval-breakdown-title">Details</div>
        <div className="eval-stat-row">
          <span className="eval-stat-label">Scored beats</span>
          <span className="eval-stat-value">{report.hitsCount + report.missCount}</span>
        </div>
        <div className="eval-stat-row">
          <span className="eval-stat-label">Hit rate</span>
          <span className="eval-stat-value">
            {(report.hitsCount + report.missCount) > 0
              ? Math.round((report.hitsCount / (report.hitsCount + report.missCount)) * 100)
              : 0}%
          </span>
        </div>
        <div className="eval-stat-row">
          <span className="eval-stat-label">Avg deviation</span>
          <span className="eval-stat-value">
            {report.meanDeviationMs >= 0 ? "+" : ""}
            {report.meanDeviationMs.toFixed(1)}ms
          </span>
        </div>
        <div className="eval-stat-row">
          <span className="eval-stat-label">Consistency</span>
          <span className="eval-stat-value">{"\u00B1"}{report.stdDeviationMs.toFixed(1)}ms</span>
        </div>
        <div className="eval-stat-row">
          <span className="eval-stat-label">Tempo stability</span>
          <span className="eval-stat-value">{"\u00B1"}{report.tempoStabilityMs.toFixed(1)}ms</span>
        </div>
        <div className="eval-stat-row">
          <span className="eval-stat-label">Longest streak</span>
          <span className="eval-stat-value">{report.longestStreak}</span>
        </div>
        {report.skippedBeats > 0 && (
          <div className="eval-stat-row">
            <span className="eval-stat-label">Skipped</span>
            <span className="eval-stat-value eval-stat-muted">{report.skippedBeats}</span>
          </div>
        )}
      </div>

      {onDelete && (
        <button className="eval-clear-btn" onClick={onDelete}>Delete Session</button>
      )}
      {onClearCurrent && (
        <button className="eval-clear-btn" onClick={onClearCurrent}>Dismiss</button>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
