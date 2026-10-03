'use client'

// PosSignalStack — what the hub NOTICES, and the drill-down rows beneath a number.
//
// THE RULE (blueprint §13.3): a row renders only when it is TRUE, and when none
// is, this renders NOTHING. No "all clear" card — a panel that is always present
// becomes furniture, and the night it says something real nobody reads it.
// Order is the server's `rank`, never re-sorted here, so the stack cannot jitter
// between two loads with the same contents.
//
// LOUDER BY MORE THAN COLOUR. Critical rows carry a thicker edge, a tinted
// ground, an icon AND the word "דחוף" — a colour-blind manager and a screen
// reader get exactly what everyone else gets.
//
// DrillPanel is exported because the stat strip's tiles open the very same lists:
// a count and the rows under it come from one server array, so they cannot disagree.

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Bell, Check, ChevronDown, Clock, Flame, Hourglass, Phone } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { formatAgorot } from '@/lib/pos/money'
import { nameOf, sinceLabel, ticketLabel } from '@/lib/pos/format'
import { IN_FLIGHT_ITEM_STATUSES } from '@/lib/pos/vocab'
import type { ItemStatus } from '@/lib/pos/types'
import type { Capped, DashboardDrill, DrillKey, Known, PosSignal } from '@/lib/pos/owner-api'
import { useT, usePosLang } from '@/lib/pos/useT'
import { safeColour } from '@/components/pos/shell/safeColour'
import { Banner, OpsIcon, Who } from './FilterBar'

type Colour = (id: string | null | undefined) => string

// ---- a capped list --------------------------------------------------------------------

function CappedList<T>({
  data, keyOf, render,
}: { data: Known<Capped<T>>; keyOf: (r: T) => string; render: (r: T) => ReactNode }) {
  const t = useT()
  // A failed read says so. It must never look like "nothing to show".
  if (!data.known) return <Banner>{t('owner.ops.drill.failed')}</Banner>
  if (data.value.rows.length === 0) return <p className="ops-drill-none">{t('owner.ops.drill.none')}</p>
  const more = data.value.total - data.value.rows.length
  return (
    <>
      <ul className="ops-drill-list">
        {data.value.rows.map((r) => (
          <li key={keyOf(r)}>{render(r)}</li>
        ))}
      </ul>
      {more > 0 && <p className="ops-drill-more">{t('owner.ops.drill.more', { n: more })}</p>}
    </>
  )
}

const orderHref = (orderId: string) => `/owner/pos/orders?order=${encodeURIComponent(orderId)}`

function StageWords({ status }: { status: ItemStatus }) {
  const t = useT()
  if (status === 'preparing') return <span className="ops-stage"><Flame size={14} aria-hidden="true" />{t('owner.ops.stage.preparing')}</span>
  if (status === 'sent') return <span className="ops-stage"><Hourglass size={14} aria-hidden="true" />{t('owner.ops.stage.waiting')}</span>
  if (status === 'ready') return <span className="ops-stage"><Bell size={14} aria-hidden="true" />{t('owner.ops.stage.ready')}</span>
  return <span className="ops-stage"><Check size={14} aria-hidden="true" />{t('owner.ops.stage.done')}</span>
}

/** True while a line is still unfinished — the server's own constant, never a re-typed pair of words. */
export const isInFlight = (status: ItemStatus) => IN_FLIGHT_ITEM_STATUSES.includes(status)

export function DrillPanel({ drillKey, drill, colour }: { drillKey: DrillKey; drill: DashboardDrill; colour: Colour }) {
  const t = useT()
  const [lang] = usePosLang()

  switch (drillKey) {
    case 'openTickets':
      return (
        <CappedList
          data={drill.openTickets}
          keyOf={(r) => r.orderId}
          render={(r) => (
            <Link className="ops-drill-row press" href={orderHref(r.orderId)}>
              <span className="ops-drill-main">
                <b className="ltr-isolate">{ticketLabel(r.ticketNo)}</b>
                <span>{r.customerName || '—'}</span>
                <Who handle={r.createdBy.handle} colour={colour(r.createdBy.id)} />
              </span>
              <span className="ops-drill-meta">
                {r.lines.waiting > 0 && (
                  <span className="ops-stage"><Hourglass size={14} aria-hidden="true" /><span className="ltr-isolate">{r.lines.waiting}</span> {t('owner.ops.stage.waiting')}</span>
                )}
                {r.lines.preparing > 0 && (
                  <span className="ops-stage"><Flame size={14} aria-hidden="true" /><span className="ltr-isolate">{r.lines.preparing}</span> {t('owner.ops.stage.preparing')}</span>
                )}
                {r.lines.ready > 0 && (
                  <span className="ops-stage"><Bell size={14} aria-hidden="true" /><span className="ltr-isolate">{r.lines.ready}</span> {t('owner.ops.stage.ready')}</span>
                )}
                <span className="ltr-isolate">{formatAgorot(r.totalAgorot)}</span>
                <span className="ops-age"><Clock size={14} aria-hidden="true" />{sinceLabel(r.ageSeconds, lang)}</span>
              </span>
            </Link>
          )}
        />
      )
    case 'stuck':
      return (
        <CappedList
          data={drill.stuck}
          keyOf={(r) => r.itemId}
          render={(r) => (
            <Link className="ops-drill-row press" href={orderHref(r.orderId)}>
              <span className="ops-drill-main">
                <b>{r.qty > 1 ? `${r.qty}× ` : ''}{nameOf(r.name, lang)}</b>
                <b className="ltr-isolate">{ticketLabel(r.ticketNo)}</b>
                <span>{r.customerName || '—'}</span>
              </span>
              <span className="ops-drill-meta">
                <span className="ops-pointdot"><i aria-hidden="true" style={{ background: safeColour(r.pointColour, '#9c9086') }} />{r.pointName}</span>
                <StageWords status={r.status} />
                <span className="ops-age ops-age--late"><Clock size={14} aria-hidden="true" />{sinceLabel(r.waitingSeconds, lang)}</span>
                {r.claimedBy && <Who handle={r.claimedBy.handle} colour={colour(r.claimedBy.id)} />}
              </span>
            </Link>
          )}
        />
      )
    case 'uncollected':
      return (
        <CappedList
          data={drill.uncollected}
          keyOf={(r) => r.orderId}
          render={(r) => (
            <div className="ops-drill-row">
              <Link className="ops-drill-main press" href={orderHref(r.orderId)}>
                <b className="ltr-isolate">{ticketLabel(r.ticketNo)}</b>
                <span>{r.customerName || '—'}</span>
                {r.points.map((p) => (
                  <span key={p.id} className="ops-pointdot"><i aria-hidden="true" style={{ background: safeColour(p.colour, '#9c9086') }} />{p.name}</span>
                ))}
              </Link>
              <span className="ops-drill-meta">
                <span className="ops-age ops-age--late"><Bell size={14} aria-hidden="true" />{t('owner.ops.drill.readyFor', { t: sinceLabel(r.readySeconds, lang) })}</span>
                {r.customerPhone && (
                  <a className="ops-phone press" href={`tel:${r.customerPhone.replace(/[^\d+]/g, '')}`}>
                    <Phone size={14} aria-hidden="true" />
                    <span className="ltr-isolate">{r.customerPhone}</span>
                  </a>
                )}
              </span>
            </div>
          )}
        />
      )
    case 'unrouted':
      return (
        <CappedList
          data={drill.unrouted}
          keyOf={(r) => r.uid}
          render={(r) => (
            <Link className="ops-drill-row press" href="/owner/pos/setup">
              <span className="ops-drill-main"><b>{nameOf(r.name, lang)}</b><span>{nameOf(r.categoryTitle, lang)}</span></span>
            </Link>
          )}
        />
      )
    case 'soldOut':
      return (
        <CappedList
          data={drill.soldOut}
          keyOf={(r) => `${r.itemUid}:${r.pointId}`}
          render={(r) => (
            <div className="ops-drill-row">
              <span className="ops-drill-main"><b>{nameOf(r.name, lang)}</b><span>{r.pointName}</span></span>
            </div>
          )}
        />
      )
    case 'slipMismatches':
      return (
        <CappedList
          data={drill.slipMismatches}
          keyOf={(r) => r.orderId}
          render={(r) => (
            <Link className="ops-drill-row press" href={orderHref(r.orderId)}>
              <span className="ops-drill-main">
                <b className="ltr-isolate">{ticketLabel(r.ticketNo)}</b>
                <span>{r.customerName || '—'}</span>
              </span>
              <span className="ops-drill-meta">
                <span>{t('owner.ops.drill.slipTotal', { order: formatAgorot(r.totalAgorot), slip: formatAgorot(r.slipAgorot) })}</span>
                <b className="ltr-isolate">{formatAgorot(r.diffAgorot)}</b>
              </span>
            </Link>
          )}
        />
      )
    case 'unconfirmedHandles':
      return (
        <CappedList
          data={drill.unconfirmedHandles}
          keyOf={(r) => r.id}
          render={(r) => <div className="ops-drill-row"><Who handle={r.handle} colour={colour(r.id)} /></div>}
        />
      )
  }
}

// ---- the stack ------------------------------------------------------------------------

const LEVEL_WORD = {
  critical: 'owner.ops.level.critical',
  warning: 'owner.ops.level.warning',
  info: 'owner.ops.level.info',
} as const

export default function PosSignalStack({
  signals, drill, colour,
}: { signals: PosSignal[]; drill: DashboardDrill; colour: Colour }) {
  const t = useT()
  const [lang] = usePosLang()
  const [openId, setOpenId] = useState<string | null>(null)

  // No signals -> no element at all. Not an empty card, not a heading.
  if (signals.length === 0) return null

  return (
    <section className="ops-signals" aria-label={t('owner.ops.signals.title')}>
      <ul>
        {signals.map((s) => {
          const title = s.title[lang]
          const detail = s.detail?.[lang]
          const expandable = !!s.drill
          const open = openId === s.id
          const body = (
            <>
              <span className="ops-signal-icon"><OpsIcon name={s.icon} size={20} /></span>
              <span className="ops-signal-text">
                <span className="ops-signal-title">
                  <span className={`ops-level ops-level--${s.level}`}>{t(LEVEL_WORD[s.level])}</span>
                  {title}
                </span>
                {detail && <span className="ops-signal-detail">{detail}</span>}
              </span>
              {expandable && <ChevronDown size={18} aria-hidden="true" className="ops-filter-chev" data-open={open} />}
            </>
          )
          return (
            <li key={s.id} className={`ops-signal ops-signal--${s.level}`}>
              {expandable ? (
                <button
                  type="button"
                  className="ops-signal-row press"
                  aria-expanded={open}
                  onClick={() => {
                    haptic()
                    setOpenId(open ? null : s.id)
                  }}
                >
                  {body}
                </button>
              ) : s.href ? (
                <Link className="ops-signal-row press" href={s.href}>{body}</Link>
              ) : (
                <div className="ops-signal-row">{body}</div>
              )}
              {expandable && open && s.drill && (
                <div className="ops-signal-drill">
                  <DrillPanel drillKey={s.drill} drill={drill} colour={colour} />
                  {s.href && <Link className="ops-link-btn press" href={s.href}>{t('owner.ops.signals.open')}</Link>}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
