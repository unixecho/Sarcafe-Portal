'use client'

// PosStatStrip — the four-number pulse: open orders · sales · stuck · people on
// the points. It stays FOUR (a fifth makes the strip a table and nobody reads it).
//
// Each number carries `known`. A read that failed shows "—", never a confident 0:
// a "0 stuck" that is really "could not look" is the one lie this screen must not tell.
//
// Each tile expands in place into the list behind it. Those lists are the server's
// own `drill` arrays (the same rows the signal stack opens), so the number above an
// expanded panel and the rows inside it were counted from one array and cannot disagree.

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { formatAgorot } from '@/lib/pos/money'
import { sinceLabel } from '@/lib/pos/format'
import type { DashboardDrill, DashboardStats, DrillKey, Known, PosStat, PresenceGroup } from '@/lib/pos/owner-api'
import { usePosLang, useT } from '@/lib/pos/useT'
import { safeColour } from '@/components/pos/shell/safeColour'
import { Banner, Who } from './FilterBar'
import { DrillPanel } from './PosSignalStack'
import Sparkline from './Sparkline'

type Colour = (id: string | null | undefined) => string
type TileId = 'open' | 'sales' | 'stuck' | 'people'

export default function PosStatStrip({
  stats, drill, presence, colour, busy,
}: {
  stats: DashboardStats
  drill: DashboardDrill
  presence: Known<PresenceGroup[]>
  colour: Colour
  busy?: boolean
}) {
  const t = useT()
  const [lang] = usePosLang()
  const [open, setOpen] = useState<TileId | null>(null)

  const num = (s: PosStat) => (s.known ? String(s.value) : '—')
  const spark = stats.salesByHour.known ? stats.salesByHour.value.map((b) => b.agorot) : []

  const tiles: { id: TileId; label: string; value: string; tone?: 'danger'; extra?: React.ReactNode }[] = [
    { id: 'open', label: t('owner.ops.stat.open'), value: num(stats.openTickets) },
    {
      id: 'sales',
      label: t('owner.ops.stat.sales'),
      value: stats.salesAgorot.known ? formatAgorot(stats.salesAgorot.value) : '—',
      extra: <Sparkline values={spark} />,
    },
    {
      id: 'stuck',
      label: t('owner.ops.stat.stuck'),
      value: num(stats.stuckItems),
      tone: stats.stuckItems.known && stats.stuckItems.value > 0 ? 'danger' : undefined,
    },
    { id: 'people', label: t('owner.ops.stat.people'), value: num(stats.staffOnPoints) },
  ]

  const key = (id: TileId): DrillKey | null => (id === 'open' ? 'openTickets' : id === 'stuck' ? 'stuck' : null)

  return (
    <section className="ops-strip" aria-label={t('owner.ops.stat.title')} aria-busy={busy || undefined}>
      <div className="ops-strip-grid">
        {tiles.map((tile) => {
          const isOpen = open === tile.id
          return (
            <button
              key={tile.id}
              type="button"
              className={`ops-stat press${tile.tone === 'danger' ? ' ops-stat--danger' : ''}`}
              aria-expanded={isOpen}
              aria-controls="ops-strip-panel"
              onClick={() => {
                haptic()
                setOpen(isOpen ? null : tile.id)
              }}
            >
              <span className="ops-stat-label">{tile.label}</span>
              <span className="ops-stat-value ltr-isolate">{tile.value}</span>
              <span className="ops-stat-foot">
                {tile.extra}
                <ChevronDown size={16} aria-hidden="true" className="ops-filter-chev" data-open={isOpen} />
              </span>
            </button>
          )
        })}
      </div>

      {open && (
        <div id="ops-strip-panel" className="ops-strip-panel">
          {key(open) ? (
            <DrillPanel drillKey={key(open) as DrillKey} drill={drill} colour={colour} />
          ) : open === 'sales' ? (
            !stats.salesByPoint.known ? (
              <Banner>{t('owner.ops.drill.failed')}</Banner>
            ) : stats.salesByPoint.value.length === 0 ? (
              <p className="ops-drill-none">{t('owner.ops.drill.none')}</p>
            ) : (
              <ul className="ops-drill-list">
                {stats.salesByPoint.value.map((p) => (
                  <li key={p.pointId}>
                    <div className="ops-drill-row">
                      <span className="ops-drill-main">
                        <span className="ops-pointdot"><i aria-hidden="true" style={{ background: safeColour(p.colour, '#9c9086') }} />{p.name}</span>
                      </span>
                      <span className="ops-drill-meta">
                        <span>{t('owner.ops.stat.itemsCount', { n: p.qty })}</span>
                        <b className="ltr-isolate">{formatAgorot(p.agorot)}</b>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : !presence.known ? (
            <Banner>{t('owner.ops.drill.failed')}</Banner>
          ) : presence.value.length === 0 ? (
            <p className="ops-drill-none">{t('owner.ops.stat.nobody')}</p>
          ) : (
            <ul className="ops-drill-list">
              {presence.value.map((g) => (
                <li key={g.pointId}>
                  <div className="ops-drill-row ops-drill-row--wrap">
                    <span className="ops-pointdot"><i aria-hidden="true" style={{ background: safeColour(g.pointColour, '#9c9086') }} />{g.pointName}</span>
                    <span className="ops-who-row">
                      {g.staff.map((s) => (
                        <span key={s.id} className="ops-who-since">
                          <Who handle={s.handle} colour={colour(s.id)} />
                          <small>{t('owner.ops.stat.since', { t: sinceLabel(Math.max(0, (Date.now() - Date.parse(s.since)) / 1000), lang) })}</small>
                        </span>
                      ))}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
