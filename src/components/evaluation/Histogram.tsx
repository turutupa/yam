import { FEEDBACK_COLORS } from "../../hooks/useEvaluation";

export function Histogram({ deviations }: { deviations: number[] }) {
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
