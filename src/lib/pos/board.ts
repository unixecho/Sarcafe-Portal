// The Ready board rule (blueprint §7.4). Pure — the server endpoint and the tests
// both use it, so what the TV shows and what the harness asserts cannot drift.
//
// An entry exists per (ORDER, POINT) while that point has >= 1 `ready` line AND
// none still `sent` / `preparing` — everything THAT point owes this customer is
// done. It disappears once those ready lines are delivered. Two customers with
// the same first name stay distinguishable by the ticket number.
//
// PRIVACY: first name + number only. Never a phone, never a surname, never an item.

import type { PosItem, PosOrder, PosPoint } from './types'

export type BoardEntry = {
  orderId: string
  ticketNo: number
  firstName: string
  pointId: string
  pointName: string
  pointColour: string
  readyAt: string
}

export const FIRST_NAME_MAX = 14

/** First whitespace-separated token, trimmed to FIRST_NAME_MAX; a neutral word if empty. */
export function firstName(customerName: string | null | undefined, fallback = '—'): string {
  const token = (customerName ?? '').trim().split(/\s+/)[0] ?? ''
  if (!token) return fallback
  const chars = Array.from(token) // by code point, so an emoji or a Hebrew letter is never cut in half
  return chars.length > FIRST_NAME_MAX ? chars.slice(0, FIRST_NAME_MAX).join('') : token
}

export function boardEntries(
  items: Pick<PosItem, 'order_id' | 'point_id' | 'status' | 'ready_at'>[],
  orders: ReadonlyMap<string, Pick<PosOrder, 'ticket_no' | 'customer_name'>>,
  points: ReadonlyMap<string, Pick<PosPoint, 'name' | 'colour'>>,
): BoardEntry[] {
  type Acc = { ready: number; inflight: number; readyAt: string }
  const groups = new Map<string, Acc & { orderId: string; pointId: string }>()
  for (const it of items) {
    if (it.status === 'voided' || it.status === 'delivered') continue
    const k = `${it.order_id}|${it.point_id}`
    const g = groups.get(k) ?? { orderId: it.order_id, pointId: it.point_id, ready: 0, inflight: 0, readyAt: '' }
    if (it.status === 'ready') {
      g.ready++
      if (it.ready_at && (!g.readyAt || it.ready_at < g.readyAt)) g.readyAt = it.ready_at
    } else {
      g.inflight++
    }
    groups.set(k, g)
  }

  const out: BoardEntry[] = []
  for (const g of Array.from(groups.values())) {
    if (g.ready === 0 || g.inflight > 0) continue
    const order = orders.get(g.orderId)
    const point = points.get(g.pointId)
    if (!order || !point) continue
    out.push({
      orderId: g.orderId,
      ticketNo: order.ticket_no,
      firstName: firstName(order.customer_name),
      pointId: g.pointId,
      pointName: point.name,
      pointColour: point.colour,
      readyAt: g.readyAt,
    })
  }
  return out.sort((a, b) => (a.readyAt < b.readyAt ? -1 : a.readyAt > b.readyAt ? 1 : a.ticketNo - b.ticketNo))
}

/** Lines still being worked on — the board's quiet "בהכנה" count. */
export function preparingCount(items: Pick<PosItem, 'status'>[]): number {
  return items.filter((i) => i.status === 'sent' || i.status === 'preparing').length
}
