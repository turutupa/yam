import { isLightColor } from "./helpers";

export function ScoreBadge({ score }: { score: number }) {
  const color = score >= 90
    ? "var(--feedback-perfect)"
    : score >= 70
    ? "var(--feedback-good)"
    : score >= 50
    ? "var(--feedback-ok)"
    : "var(--feedback-miss)";
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
