export function MiniSparkline({ deviations }: { deviations: number[] }) {
  const maxPoints = 16;
  const height = 24;
  const padding = 3;
  const width = 100;
  const range = 50;

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

  const segments = points.map((d, i) => {
    const x = (i / (points.length - 1)) * width;
    const clamped = Math.max(-range, Math.min(range, d));
    const y = midY - (clamped / range) * (usableHeight / 2);
    return { x, y };
  });

  // Monotone cubic interpolation (Fritsch-Carlson)
  const n = segments.length;
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    dx.push(segments[i + 1].x - segments[i].x);
    dy.push(segments[i + 1].y - segments[i].y);
    m.push(dy[i] / dx[i]);
  }

  const tangents: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      tangents.push(0);
    } else {
      tangents.push((m[i - 1] + m[i]) / 2);
    }
  }
  tangents.push(m[n - 2]);

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
        <line x1="0" y1={midY} x2={width} y2={midY} stroke="currentColor" strokeWidth="0.4" opacity="0.12" />
        <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      </svg>
    </div>
  );
}
