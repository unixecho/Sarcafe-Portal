// CONTENT-SHAPED skeletons — each one is the silhouette of the thing it stands in
// for, so when the real content lands nothing moves (Ayeka's skeleton never
// rendered at all: its stylesheet was never imported — see the blueprint §3).
//
// Rules, all on purpose:
//  * Built on the global `.sk` shimmer and wrapped in `.sk-late`, which keeps the
//    whole thing invisible for the first 300 ms. A fast load must never flash one.
//  * Only for a refetch that has NOTHING cached. If you have last-known data,
//    show it; a skeleton over data you hold is a regression, not a loading state.
//  * Pure presentation, no hooks, no client directive: usable from loading.tsx
//    (a server component) and from the client tree alike. The one string a
//    skeleton carries is the screen-reader label, passed in by the caller
//    (loading.tsx has no language to read, so it falls back to Hebrew).
//
// Geometry mirrors the real components' tokens (radii, gaps, --tap-min).

import type { CSSProperties } from 'react'

type BarProps = { w?: number | string; h?: number; style?: CSSProperties }

function Bar({ w = '100%', h = 14, style }: BarProps) {
  return <span className="sk pos-sk-bar" style={{ inlineSize: w, blockSize: h, ...style }} />
}

/** A status region wrapper: delayed by 300 ms, announced politely, hidden from the tab order. */
function Shell({ label, className, children }: { label?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`sk-late ${className ?? ''}`} role="status" aria-busy="true">
      <span className="sr-only">{label ?? 'טוען…'}</span>
      <div aria-hidden="true" style={{ display: 'contents' }}>
        {children}
      </div>
    </div>
  )
}

/** One station ticket: a header bar (ticket + name + clock) and three line rows. */
export function SkTicketCard({ label, lines = 3 }: { label?: string; lines?: number }) {
  return (
    <Shell label={label} className="pos-sk-card">
      <div className="pos-sk-card-head">
        <Bar w="38%" h={20} />
        <Bar w={56} h={20} />
      </div>
      {Array.from({ length: lines }, (_, i) => (
        <div className="pos-sk-line" key={i}>
          <Bar w={`${58 - i * 9}%`} h={16} />
          <Bar w="28%" h={12} />
        </div>
      ))}
      <Bar h={52} style={{ borderRadius: 14, marginBlockStart: 4 }} />
    </Shell>
  )
}

/** One row of the orders list: ticket + name, a couple of status chips, a total. */
export function SkOrderRow({ label }: { label?: string }) {
  return (
    <Shell label={label} className="pos-sk-row">
      <div className="pos-sk-row-main">
        <Bar w="46%" h={18} />
        <div className="pos-sk-chips">
          <Bar w={64} h={22} style={{ borderRadius: 999 }} />
          <Bar w={72} h={22} style={{ borderRadius: 999 }} />
        </div>
      </div>
      <Bar w={56} h={20} />
    </Shell>
  )
}

/** The register's item grid: a category strip, then tiles. */
export function SkMenuGrid({ label, tiles = 12 }: { label?: string; tiles?: number }) {
  return (
    <Shell label={label} className="pos-sk-menu">
      <div className="pos-sk-strip">
        {Array.from({ length: 5 }, (_, i) => (
          <Bar key={i} w={72 + (i % 3) * 14} h={40} style={{ borderRadius: 999, flex: '0 0 auto' }} />
        ))}
      </div>
      <div className="pos-sk-tiles">
        {Array.from({ length: tiles }, (_, i) => (
          <Bar key={i} h={92} style={{ borderRadius: 16 }} />
        ))}
      </div>
    </Shell>
  )
}

/** The switcher's station chips. */
export function SkPointChips({ label, count = 3 }: { label?: string; count?: number }) {
  return (
    <Shell label={label} className="pos-sk-chiprow">
      {Array.from({ length: count }, (_, i) => (
        <Bar key={i} w={104} h={52} style={{ borderRadius: 16, flex: '0 0 auto' }} />
      ))}
    </Shell>
  )
}

/** The whole shell, for loading.tsx and for the instant before the app knows where to land. */
export function SkShellBody({ label }: { label?: string }) {
  return (
    <div className="pos-sk-body">
      <div className="pos-sk-grid">
        <SkTicketCard label={label} />
        <SkTicketCard lines={2} />
        <SkTicketCard lines={4} />
        <SkTicketCard lines={3} />
      </div>
    </div>
  )
}
