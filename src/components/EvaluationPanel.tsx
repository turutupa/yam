import { useState, useEffect, useCallback } from "react";
import { clearSession, getSessionHistory, deleteSession, clearAllSessions } from "../ipc";
import { FEEDBACK_COLORS } from "../hooks/useEvaluation";
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

// ─── Score Ring ──────────────────────────────────────────────────────────────

function ScoreRing({ score, size, strokeWidth }: { score: number; size: number; strokeWidth: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(score / 100, 1);
  const offset = circumference * (1 - progress);

  const color = score >= 90 ? "#10b981" : score >= 70 ? "#06b6d4" : score >= 50 ? "#f59e0b" : "#6b7280";

  return (
    <div className="eval-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="eval-ring-bg"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="eval-ring-fill"
        />
      </svg>
      <span className="eval-ring-score" style={{ color }}>{score}</span>
    </div>
  );
}

// ─── Breakdown Bar ───────────────────────────────────────────────────────────

function BreakdownBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="eval-bar-row">
      <span className="eval-bar-label">{label}</span>
      <div className="eval-bar-track">
        <div className="eval-bar-fill" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="eval-bar-count">{count}</span>
    </div>
  );
}

// ─── Histogram ───────────────────────────────────────────────────────────────

function Histogram({ deviations }: { deviations: number[] }) {
  const bucketCount = 10;
  const range = 50;
  const bucketSize = (range * 2) / bucketCount;
  const buckets = new Array(bucketCount).fill(0);

  for (const d of deviations) {
    const clamped = Math.max(-range, Math.min(range - 0.01, d));
    const idx = Math.floor((clamped + range) / bucketSize);
    buckets[Math.min(idx, bucketCount - 1)]++;
  }

  const maxBucket = Math.max(...buckets, 1);

  return (
    <div className="eval-hist">
      <div className="eval-hist-bars">
        {buckets.map((count, i) => {
          const pct = (count / maxBucket) * 100;
          const ms = -range + i * bucketSize + bucketSize / 2;
          const color = Math.abs(ms) < 10 ? FEEDBACK_COLORS.perfect : Math.abs(ms) < 25 ? FEEDBACK_COLORS.good : FEEDBACK_COLORS.ok;
          return (
            <div key={i} className="eval-hist-col">
              <div className="eval-hist-bar" style={{ height: `${pct}%`, backgroundColor: color }} />
            </div>
          );
        })}
      </div>
      <div className="eval-hist-labels">
        <span>-50ms</span>
        <span>0</span>
        <span>+50ms</span>
      </div>
    </div>
  );
}

// ─── Score Badge ────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 90
    ? "var(--feedback-perfect)"
    : score >= 70
    ? "var(--feedback-good)"
    : score >= 50
    ? "var(--feedback-ok)"
    : "var(--feedback-miss)";
  // Resolve the CSS var and compute luminance for text contrast
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(
    score >= 90 ? "--feedback-perfect" : score >= 70 ? "--feedback-good" : score >= 50 ? "--feedback-ok" : "--feedback-miss"
  ).trim();
  const textColor = isLightColor(resolved) ? "#1a1a2e" : "#fff";
  return (
    <span className="eval-score-badge" style={{ backgroundColor: color, color: textColor }}>
      {score}
    </span>
  );
}

// ─── Mini Sparkline ─────────────────────────────────────────────────────────

function MiniSparkline({ deviations }: { deviations: number[] }) {
  const maxPoints = 16;
  const height = 24;
  const padding = 3; // vertical padding so curve doesn't clip edges
  const width = 100;
  const range = 50; // ±50ms clamped

  // Downsample — average buckets for smoother data (not point-sampling)
  let points: number[];
  if (deviations.length <= maxPoints) {
    points = deviations;
  } else {
    const bucketSize = deviations.length / maxPoints;
    points = Array.from({ length: maxPoints }, (_, i) => {
      const start = Math.floor(i * bucketSize);
      const end = Math.floor((i + 1) * bucketSize);
      let sum = 0;
      for (let j = start; j < end; j++) sum += deviations[j];
      return sum / (end - start);
    });
  }

  const usableHeight = height - padding * 2;
  const midY = height / 2;

  // Build segments
  const segments = points.map((d, i) => {
    const x = (i / (points.length - 1)) * width;
    const clamped = Math.max(-range, Math.min(range, d));
    const y = midY - (clamped / range) * (usableHeight / 2);
    return { x, y };
  });

  // Monotone cubic interpolation (Fritsch-Carlson) — no overshoot
  const n = segments.length;
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    dx.push(segments[i + 1].x - segments[i].x);
    dy.push(segments[i + 1].y - segments[i].y);
    m.push(dy[i] / dx[i]);
  }

  // Tangents
  const tangents: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      tangents.push(0);
    } else {
      tangents.push((m[i - 1] + m[i]) / 2);
    }
  }
  tangents.push(m[n - 2]);

  // Clamp tangents to prevent overshoot (Fritsch-Carlson condition)
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(m[i]) < 1e-6) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
    } else {
      const alpha = tangents[i] / m[i];
      const beta = tangents[i + 1] / m[i];
      const s = alpha * alpha + beta * beta;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        tangents[i] = t * alpha * m[i];
        tangents[i + 1] = t * beta * m[i];
      }
    }
  }

  // Build path
  let pathD = `M ${segments[0].x.toFixed(1)} ${segments[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const d = dx[i] / 3;
    const cp1x = segments[i].x + d;
    const cp1y = segments[i].y + tangents[i] * d;
    const cp2x = segments[i + 1].x - d;
    const cp2y = segments[i + 1].y - tangents[i + 1] * d;
    pathD += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${segments[i + 1].x.toFixed(1)} ${segments[i + 1].y.toFixed(1)}`;
  }

  return (
    <div className="eval-card-sparkline">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {/* Center line */}
        <line x1="0" y1={midY} x2={width} y2={midY} stroke="currentColor" strokeWidth="0.4" opacity="0.12" />
        {/* Path */}
        <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      </svg>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isLightColor(hex: string): boolean {
  const c = hex.replace("#", "");
  if (c.length < 6) return false;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  // Relative luminance (perceived brightness)
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
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
