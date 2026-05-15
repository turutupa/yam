export function BreakdownBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
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
