export function ScoreRing({ score, size, strokeWidth }: { score: number; size: number; strokeWidth: number }) {
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
