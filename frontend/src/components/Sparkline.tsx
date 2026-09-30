export function Sparkline({ points, width = 90, height = 28, up = true }: { points: number[]; width?: number; height?: number; up?: boolean }) {
  if (points.length < 2) return <span className="dim">—</span>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${(height - 3 - ((p - min) / range) * (height - 6)).toFixed(1)}`)
    .join(' ');
  const color = up ? 'var(--up)' : 'var(--down)';
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <path d={d} fill="none" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: color }} />
    </svg>
  );
}
