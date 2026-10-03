'use client'

// One row of the orders list, plus the small pieces the detail sheet shares with it
// (the status chip and the per-point grouping), so a line is never worded or coloured
// two different ways on two screens.
//
// A row is a real <button> for "open this order" with the handover buttons as its
// SIBLINGS, never children: a button inside a button is invalid HTML and breaks
// keyboard and screen-reader use. The row never re-sorts on a status change (the list
// orders by ticket number) — a card that jumps under a finger is the whack-a-mole bug.

import { memo } from 'react'
import { Ban, BellRing, Check, CheckCheck, Clock, Flame, type LucideIcon } from 'lucide-react'
import { resolveCategoryIcon } from '@/lib/menu/icons'
import { formatAgorot } from '@/lib/pos/money'
import { sinceLabel, ticketLabel } from '@/lib/pos/format'
import { cardStage } from '@/lib/pos/lifecycle'
import { useT } from '@/lib/pos/useT'
import type { StrKey } from '@/lib/pos/i18n'
import type { ItemStatus, PosItem, PosOrderWithItems, PosPoint } from '@/lib/pos/types'
import { haptic } from '@/lib/haptics'
import { HandleChip } from '../shell/HandleChip'
import { safeColour } from '../shell/safeColour'

export const STATUS_KEY: Record<ItemStatus, StrKey> = {
  sent: 'orders.st.sent',
  preparing: 'orders.st.preparing',
  ready: 'orders.st.ready',
  delivered: 'orders.st.delivered',
  voided: 'orders.st.voided',
}

// Each status has its own glyph so colour is never the only signal.
export const STATUS_ICON: Record<ItemStatus, LucideIcon> = {
  sent: Clock,
  preparing: Flame,
  ready: BellRing,
  delivered: Check,
  voided: Ban,
}

const NEUTRAL = '#9c9086'

export type PointGroup = {
  pointId: string
  pointName: string
  /** the earliest stage still live, or 'delivered' when everything here is handed over */
  status: ItemStatus
  lines: PosItem[]
}

/** Lines grouped by the point that makes them, in first-line order. Cancelled lines are left out. */
export function groupByPoint(items: readonly PosItem[]): PointGroup[] {
  const map = new Map<string, PosItem[]>()
  for (const it of items) {
    if (it.status === 'voided') continue
    const arr = map.get(it.point_id)
    if (arr) arr.push(it)
    else map.set(it.point_id, [it])
  }
  const out: PointGroup[] = []
  map.forEach((lines, pointId) => {
    out.push({
      pointId,
      pointName: lines[0]?.point_name ?? '',
      status: cardStage(lines) ?? 'delivered',
      lines,
    })
  })
  return out
}

/** Ready lines sitting at points that do NOT hand over — the runner's list. */
export function readyForHandover(
  order: PosOrderWithItems,
  pointsById: ReadonlyMap<string, PosPoint>,
): { pointId: string; pointName: string; ids: string[] }[] {
  const out: { pointId: string; pointName: string; ids: string[] }[] = []
  for (const g of groupByPoint(order.items)) {
    const point = pointsById.get(g.pointId)
    // An unknown point is treated as one that hands over itself: never offer a button we cannot justify.
    if (!point || point.hands_over) continue
    const ids = g.lines.filter((l) => l.status === 'ready').map((l) => l.id)
    if (ids.length) out.push({ pointId: g.pointId, pointName: g.pointName, ids })
  }
  return out
}

export function StatusChip({
  status,
  label,
  colour,
  Icon,
}: {
  status: ItemStatus
  /** the point's name, when the chip belongs to a point */
  label?: string
  colour?: string
  Icon?: LucideIcon
}) {
  const t = useT()
  const StatusIcon = STATUS_ICON[status]
  const c = safeColour(colour, NEUTRAL)
  return (
    <span className={`ord-chip ord-chip--${status}`} style={{ ['--pt' as string]: c }}>
      {Icon ? <Icon size={14} aria-hidden="true" className="ord-chip-pt" /> : null}
      <StatusIcon size={14} aria-hidden="true" />
      <span>{label ? t('orders.row.chip', { point: label, status: t(STATUS_KEY[status]) }) : t(STATUS_KEY[status])}</span>
    </span>
  )
}

type Props = {
  order: PosOrderWithItems
  points: ReadonlyMap<string, PosPoint>
  nowMs: number
  onOpen: (id: string) => void
  /** Present only on the "ready to hand over" tab. */
  handover?: { pointId: string; pointName: string; ids: string[] }[]
  onHandover?: (ids: string[]) => void
}

function OrderRowBase({ order, points, nowMs, onOpen, handover, onHandover }: Props) {
  const t = useT()
  const ticket = ticketLabel(order.ticket_no)
  const name = order.customer_name.trim() || t('orders.row.noName')
  const groups = groupByPoint(order.items)
  const voided = order.status === 'void'
  const age = sinceLabel((nowMs - Date.parse(order.created_at)) / 1000)

  return (
    <li className={`ord-row${voided ? ' ord-row--void' : ''}`}>
      <button
        type="button"
        className="ord-row-main press"
        onClick={() => onOpen(order.id)}
        aria-label={t('orders.row.open', { ticket, name })}
      >
        <span className="ord-row-head">
          <span className="ord-ticket ltr-isolate">{ticket}</span>
          <span className="ord-name">{name}</span>
          <span className="ord-total ltr-isolate">{formatAgorot(order.total_agorot)}</span>
        </span>
        <span className="ord-row-meta">
          <span className="ord-by" title={t('orders.row.by', { name: order.created_by_handle })}>
            <HandleChip staffId={order.created_by} handle={order.created_by_handle} />
          </span>
          <span className="ord-age">{t('orders.row.age', { time: age })}</span>
        </span>
        <span className="ord-chips">
          {voided ? (
            <StatusChip status="voided" label={undefined} />
          ) : (
            groups.map((g) => {
              const p = points.get(g.pointId)
              return (
                <StatusChip
                  key={g.pointId}
                  status={g.status}
                  label={g.pointName}
                  colour={p?.colour}
                  Icon={resolveCategoryIcon(p?.icon)}
                />
              )
            })
          )}
          {order.status === 'completed' ? (
            <span className="ord-done" aria-hidden="true">
              <CheckCheck size={16} />
            </span>
          ) : null}
        </span>
      </button>
      {handover && handover.length > 0 ? (
        <div className="ord-handover">
          {handover.map((h) => (
            <button
              key={h.pointId}
              type="button"
              className="pos-btn pos-btn--primary ord-handover-btn press"
              onClick={() => {
                haptic('tick')
                onHandover?.(h.ids)
              }}
            >
              <Check size={18} aria-hidden="true" />
              <span>{handover.length > 1 ? t('orders.row.handoverFor', { point: h.pointName }) : t('orders.act.handover')}</span>
            </button>
          ))}
        </div>
      ) : null}
    </li>
  )
}

export const OrderRow = memo(OrderRowBase)
