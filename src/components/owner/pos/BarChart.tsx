'use client'

// A bar chart in pure SVG — no chart library (the brief, and one fewer thing to
// load on event Wi-Fi). Stacked: each bucket is one bar cut into coloured
// segments (a point's colour, or the one house colour for a single series).
//
// ACCESSIBLE BY CONSTRUCTION. The drawing is role="img" with a sentence that
// says what it shows and where the peak is; underneath sits the same data as a
// real table inside a <details>, so nobody depends on seeing colours or on
// hovering. A series is also named in a legend with a swatch AND words — colour
// is never the only signal.
//
// The time axis is forced left-to-right (a clock does not read right-to-left,
// and numbers already don't), and the bars scroll sideways inside their own
// box rather than shrinking below a tappable, legible width on a phone.

import { useId } from 'react'
import { useT } from '@/lib/pos/useT'
import { safeColour } from '@/components/pos/shell/safeColour'

export type ChartSeries = { key: string; name: string; colour: string }
export type ChartBucket = {
  startsAt: string
  label: string
  /** value per series key */
  values: Record<string, number>
}

const BAR_W = 14
const GAP = 4
const H = 150
const TOP = 8
const AXIS = 22

export default function BarChart({
  title, summary, series, buckets, unit, format,
}: {
  /** names the figure for the table caption and the legend */
  title: string
  /** the sentence a screen reader gets in place of the drawing */
  summary: string
  series: ChartSeries[]
  buckets: ChartBucket[]
  /** header of the table's value columns, e.g. "הזמנות" */
  unit: string
  /** how a value is spoken in the table (default: the number itself) */
  format?: (v: number) => string
}) {
  const t = useT()
  const id = useId()
  const fmt = format ?? ((v: number) => String(v))
  const totals = buckets.map((b) => series.reduce((s, x) => s + (b.values[x.key] ?? 0), 0))
  const max = Math.max(1, ...totals)
  const width = Math.max(buckets.length * (BAR_W + GAP) + GAP, 120)
  const plotH = H - TOP - AXIS

  return (
    <figure className="ops-chart">
      <div className="ops-chart-scroll" dir="ltr" tabIndex={0} aria-label={title}>
        <svg
          viewBox={`0 0 ${width} ${H}`}
          width={width}
          height={H}
          role="img"
          aria-label={summary}
          aria-describedby={`${id}-table`}
          focusable="false"
        >
          <line x1="0" x2={width} y1={H - AXIS} y2={H - AXIS} stroke="var(--line-strong)" />
          {buckets.map((b, i) => {
            const x = GAP + i * (BAR_W + GAP)
            let y = H - AXIS
            const hour = b.label.endsWith(':00')
            return (
              <g key={b.startsAt}>
                {series.map((s) => {
                  const v = b.values[s.key] ?? 0
                  if (v <= 0) return null
                  const h = Math.max(2, (v / max) * plotH)
                  y -= h
                  return <rect key={s.key} x={x} y={y} width={BAR_W} height={h} rx="2" fill={safeColour(s.colour, '#ff7a45')} />
                })}
                {hour && (
                  <text x={x + BAR_W / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--text-dim)">
                    {b.label.slice(0, 2)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {series.length > 1 && (
        <ul className="ops-legend" aria-label={t('owner.ops.chart.legend')}>
          {series.map((s) => (
            <li key={s.key}>
              <span className="ops-swatch" aria-hidden="true" style={{ background: safeColour(s.colour, '#ff7a45') }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}

      <details className="ops-chart-table">
        <summary>{t('owner.ops.chart.table')}</summary>
        <div className="ops-table-wrap">
          <table id={`${id}-table`}>
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{t('owner.ops.chart.time')}</th>
                {series.map((s) => (
                  <th key={s.key} scope="col">{series.length > 1 ? s.name : unit}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buckets.map((b, i) => (
                (totals[i] ?? 0) > 0 ? (
                  <tr key={b.startsAt}>
                    <th scope="row" className="ltr-isolate">{b.label}</th>
                    {series.map((s) => (
                      <td key={s.key}>{fmt(b.values[s.key] ?? 0)}</td>
                    ))}
                  </tr>
                ) : null
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
