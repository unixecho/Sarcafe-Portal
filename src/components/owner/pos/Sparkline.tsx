// A tiny trend line inside a stat tile. Decorative: the tile already says the
// number in words, so this is aria-hidden — a shape you glance at, not data you
// must read. Pure SVG, no animation (nothing here should move on a refetch).

export default function Sparkline({
  values, width = 96, height = 28, colour = 'var(--neon-soft)',
}: { values: readonly number[]; width?: number; height?: number; colour?: string }) {
  if (values.length < 2 || values.every((v) => v === values[0])) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 2
  const step = (width - pad * 2) / (values.length - 1)
  const pts = values.map((v, i) => `${(pad + i * step).toFixed(1)},${(height - pad - ((v - min) / span) * (height - pad * 2)).toFixed(1)}`)
  return (
    <svg className="ops-spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true" focusable="false">
      <polyline points={pts.join(' ')} fill="none" stroke={colour} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
