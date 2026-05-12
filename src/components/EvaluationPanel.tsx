import { useState, useEffect, useCallback } from "react";
import { getSessionReport, clearSession } from "../ipc";
import { FEEDBACK_COLORS } from "../hooks/useEvaluation";
import type { SessionReport } from "../types";
import "../styles/evaluation-panel.css";

interface EvaluationPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function EvaluationPanel({ open, onClose }: EvaluationPanelProps) {
  const [report, setReport] = useState<SessionReport | null>(null);

  useEffect(() => {
    if (open) {
      getSessionReport().then(setReport);
    }
  }, [open]);

  const handleClear = useCallback(async () => {
    await clearSession();
    setReport(null);
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div className={`eval-panel ${open ? "open" : ""}`}>
      <div className="eval-panel-header">
        <h3>Session Report</h3>
        <button className="eval-panel-close" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {report ? (
        <div className="eval-panel-body">
          <div className="eval-grade-section">
            <div className={`eval-grade grade-${report.grade.toLowerCase()}`}>
              {report.grade}
            </div>
            <div className="eval-score">{report.score}/100</div>
          </div>

          <div className="eval-stats">
            <div className="eval-stat-row">
              <span className="eval-stat-label">Total beats</span>
              <span className="eval-stat-value">{report.totalBeats}</span>
            </div>
            <div className="eval-stat-row">
              <span className="eval-stat-label">Hit rate</span>
              <span className="eval-stat-value">
                {report.totalBeats > 0
                  ? Math.round((report.hitsCount / report.totalBeats) * 100)
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
              <span className="eval-stat-value">
                {"\u00B1"}{report.stdDeviationMs.toFixed(1)}ms
              </span>
            </div>
            <div className="eval-stat-row">
              <span className="eval-stat-label">Tempo stability</span>
              <span className="eval-stat-value">
                {"\u00B1"}{report.tempoStabilityMs.toFixed(1)}ms
              </span>
            </div>
            <div className="eval-stat-row">
              <span className="eval-stat-label">Longest streak</span>
              <span className="eval-stat-value">{report.longestStreak}</span>
            </div>
          </div>

          <div className="eval-breakdown">
            <div className="eval-breakdown-title">Breakdown</div>
            <div className="eval-breakdown-bars">
              <BreakdownBar
                label="Perfect"
                count={report.perfectCount}
                total={report.totalBeats}
                color={FEEDBACK_COLORS.perfect}
              />
              <BreakdownBar
                label="Good"
                count={report.goodCount}
                total={report.totalBeats}
                color={FEEDBACK_COLORS.good}
              />
              <BreakdownBar
                label="OK"
                count={report.okCount}
                total={report.totalBeats}
                color={FEEDBACK_COLORS.ok}
              />
              <BreakdownBar
                label="Miss"
                count={report.missCount}
                total={report.totalBeats}
                color={FEEDBACK_COLORS.miss}
              />
            </div>
          </div>

          {report.deviations.length > 4 && (
            <div className="eval-histogram">
              <div className="eval-breakdown-title">Timing Distribution</div>
              <Histogram deviations={report.deviations} />
            </div>
          )}

          <button className="eval-clear-btn" onClick={handleClear}>
            Clear &amp; Close
          </button>
        </div>
      ) : (
        <div className="eval-panel-empty">
          <p>No session data yet.</p>
          <p>Play with evaluation enabled to see your timing report.</p>
        </div>
      )}
    </div>
  );
}

function BreakdownBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="eval-bar-row">
      <span className="eval-bar-label">{label}</span>
      <div className="eval-bar-track">
        <div
          className="eval-bar-fill"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="eval-bar-count">{count}</span>
    </div>
  );
}

function Histogram({ deviations }: { deviations: number[] }) {
  // Bucket deviations into 10ms bins from -50 to +50
  const bucketCount = 10;
  const range = 50; // ±50ms
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
          const color =
            Math.abs(ms) < 10
              ? FEEDBACK_COLORS.perfect
              : Math.abs(ms) < 25
                ? FEEDBACK_COLORS.good
                : FEEDBACK_COLORS.ok;
          return (
            <div key={i} className="eval-hist-col">
              <div
                className="eval-hist-bar"
                style={{ height: `${pct}%`, backgroundColor: color }}
              />
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
