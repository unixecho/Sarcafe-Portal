// Order history and one order's full story — for managers.
//
//   readOrdersPage   every order ever, filterable, 50 a page, cursor-paginated
//   readOrderDetail  one order: its lines, its whole event timeline, who touched it
//
// UNLIKE the dashboard these reads do NOT swallow their failure: the list IS the
// content, so a failed read must surface as an error the screen can show as "couldn't
// load" — an empty list that is really a failed read would read as "no orders" (the
// feed rule from Ayeka's bug history: distinguish failed from empty). Only the staff
// directory, which merely decorates rows, degrades quietly.
//
// MANAGER-ONLY, because this is where a customer's phone number and a staff member's
// email legitimately appear: the order row carries the phone (so a manager can ring
// about an uncollected order), the timeline carries the actors' emails. Neither ever
// reaches an event payload, a log line, or anything public.

import { EVENT_COLUMNS, ITEM_COLUMNS, ORDER_COLUMNS } from '@/lib/pos/columns'
import type { PosEvent, PosItem, PosOrder, PosSession, StaffDirEntry } from '@/lib/pos/types'
import type {
  OrderDetail, OrderListRow, OrderStaffRef, OrdersPage, OrdersQuery, PointChip, SessionLite,
} from '@/lib/pos/owner-api'
import {
  directoryMap, fetchAll, guarded, iso, liteSession, readBranch, readDirectory, unwrap, type Service,
} from '@/lib/pos/server/readiness'
import { dateRangeMs } from '@/lib/pos/server/stats'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/

export const DEFAULT_PAGE = 50

/** Event payloads never carry a phone (the RPCs do not write one). This is the belt to
 *  that pair of braces: a key that looks like a phone is dropped before a payload leaves. */
export function scrubPayload(p: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(p ?? {})) if (!/phone/i.test(k)) out[k] = v
  return out
}

// ---- Cursor: (created_at, id) of the last row, base64url JSON ------------------------

export function encodeOrderCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ c: createdAt, i: id }), 'utf8').toString('base64url')
}

/** null for anything that is not a cursor WE made. The values go into a filter string, so
 *  they are checked against the exact shapes (an instant, a uuid) — never trusted as text. */
export function decodeOrderCursor(raw: string | undefined): { c: string; i: string } | null {
  if (!raw) return null
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { c?: unknown; i?: unknown }
    if (typeof v.c === 'string' && typeof v.i === 'string' && ISO_INSTANT.test(v.c) && UUID.test(v.i)) return { c: v.c, i: v.i }
  } catch {
    // fall through
  }
  return null
}

/** Characters that mean something inside a PostgREST `or(...)` string are removed from
 *  free text — a search box must not be able to add a condition. */
export function sanitizeSearch(q: string): string {
  return q.replace(/[,()"\\*%:]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The `or(...)` conditions for the search box: name and receipt number always; phone
 * digits when there are enough to mean something (a typed "054-123 4567" finds a stored
 * "+972541234567" because the leading 0 is also tried without); a ticket number when the
 * text is "#42" or a short number. Returns [] when nothing usable is left.
 */
export function searchConditions(raw: string): string[] {
  const text = sanitizeSearch(raw)
  if (!text) return []
  const out: string[] = []
  const bare = text.replace(/^#/, '')
  if (bare) {
    out.push(`customer_name.ilike.*${bare}*`)
    out.push(`receipt_ref.ilike.*${bare}*`)
  }
  const digits = text.replace(/\D/g, '')
  if (digits.length >= 3) {
    out.push(`customer_phone.ilike.*${digits}*`)
    if (digits.startsWith('0') && digits.length >= 4) out.push(`customer_phone.ilike.*${digits.slice(1)}*`)
  }
  if (/^#?\d{1,6}$/.test(text)) out.push(`ticket_no.eq.${Number(text.replace('#', ''))}`)
  return out
}

type ItemChipRow = Pick<PosItem, 'order_id' | 'point_id' | 'point_name' | 'status' | 'qty'>

function chipsFor(lines: ItemChipRow[]): { chips: PointChip[]; count: number } {
  const byPoint = new Map<string, PointChip>()
  for (const l of lines) {
    const c = byPoint.get(l.point_id) ?? {
      point_id: l.point_id, point_name: l.point_name, sent: 0, preparing: 0, ready: 0, delivered: 0, voided: 0,
    }
    c[l.status] += 1
    byPoint.set(l.point_id, c)
  }
  return { chips: Array.from(byPoint.values()).sort((a, b) => a.point_name.localeCompare(b.point_name)), count: lines.length }
}

/** GET /api/owner/pos/orders */
export async function readOrdersPage(service: Service, branch: { id: string; slug: string }, query: OrdersQuery): Promise<OrdersPage> {
  const [info, dirRead] = await Promise.all([readBranch(service, branch), readDirectory(service)])
  const sessionRes = await service
    .from('pos_sessions')
    .select('id, branch_id, kind, status, started_at, started_by, ended_at, ended_by')
    .eq('branch_id', branch.id)
  const sessions = unwrap<PosSession[] | null>(sessionRes) ?? []
  const kindOf = new Map(sessions.map((s) => [s.id, s.kind] as const))
  const trainingIds = sessions.filter((s) => s.kind === 'training').map((s) => s.id)

  const limit = query.limit ?? DEFAULT_PAGE
  const { fromMs, toMs } = dateRangeMs(query.from, query.to, info.timezone)
  const dmap = directoryMap(dirRead.data)
  const empty: OrdersPage = { rows: [], nextCursor: null, directory: dirRead.data }

  // The handle filter means "who ENTERED the order", resolved through the roster to a
  // person (not a text match on the snapshot), so a renamed nickname still finds them.
  let createdBy: string | null = null
  if (query.handle) {
    const wanted = query.handle.toLowerCase()
    const hit = dirRead.data.find((d) => d.handle.toLowerCase() === wanted)
    if (!hit) return empty
    createdBy = hit.id
  }

  const wantsPoint = !!query.point
  const select = wantsPoint ? `${ORDER_COLUMNS}, pos_order_items!inner(point_id)` : ORDER_COLUMNS
  let q = service.from('pos_orders').select(select).eq('branch_id', branch.id)

  const explicitSession = query.session && query.session !== 'all' ? query.session : null
  if (explicitSession) q = q.eq('session_id', explicitSession)
  else if (query.training !== '1' && trainingIds.length > 0) q = q.not('session_id', 'in', `(${trainingIds.join(',')})`)

  if (query.status) q = q.eq('status', query.status)
  if (createdBy) q = q.eq('created_by', createdBy)
  if (wantsPoint) q = q.eq('pos_order_items.point_id', query.point as string)
  if (fromMs !== null) q = q.gte('created_at', iso(fromMs))
  if (toMs !== null) q = q.lt('created_at', iso(toMs))

  if (query.q) {
    const conditions = searchConditions(query.q)
    // Text was typed but nothing usable survived sanitising: that is "no match", not "everything".
    if (conditions.length === 0) return empty
    q = q.or(conditions.join(','))
  }

  const cursor = decodeOrderCursor(query.cursor)
  if (query.cursor && !cursor) return empty
  if (cursor) q = q.or(`created_at.lt.${cursor.c},and(created_at.eq.${cursor.c},id.lt.${cursor.i})`)

  const res = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1)
  const fetched = unwrap<(PosOrder & { pos_order_items?: unknown })[] | null>(res) ?? []
  const hasMore = fetched.length > limit
  const orders = (hasMore ? fetched.slice(0, limit) : fetched).map((o) => {
    // The embed used only to FILTER by point is not part of the row.
    const { pos_order_items: _embed, ...rest } = o
    void _embed
    return rest as PosOrder
  })

  const ids = orders.map((o) => o.id)
  const lines =
    ids.length === 0
      ? []
      : await fetchAll<ItemChipRow>((from, to) =>
          service
            .from('pos_order_items')
            .select('id, order_id, point_id, point_name, status, qty')
            .in('order_id', ids)
            .order('id', { ascending: true })
            .range(from, to)
        )
  const linesByOrder = new Map<string, ItemChipRow[]>()
  for (const l of lines) {
    const g = linesByOrder.get(l.order_id)
    if (g) g.push(l)
    else linesByOrder.set(l.order_id, [l])
  }

  const rows: OrderListRow[] = orders.map((o) => {
    const { chips, count } = chipsFor(linesByOrder.get(o.id) ?? [])
    return { ...o, session_kind: kindOf.get(o.session_id) ?? 'live', points: chips, item_count: count }
  })
  void dmap
  const last = orders[orders.length - 1]
  return { rows, nextCursor: hasMore && last ? encodeOrderCursor(last.created_at, last.id) : null, directory: dirRead.data }
}

/** GET /api/owner/pos/orders/[id] — null when the order is not in THIS branch (the route answers 404). */
export async function readOrderDetail(service: Service, branch: { id: string; slug: string }, orderId: string): Promise<OrderDetail | null> {
  const orderRes = await service.from('pos_orders').select(ORDER_COLUMNS).eq('id', orderId).eq('branch_id', branch.id).maybeSingle()
  const order = unwrap<PosOrder | null>(orderRes)
  if (!order) return null

  const [dirRead, items, events, sessionRes] = await Promise.all([
    readDirectory(service),
    fetchAll<PosItem>((from, to) =>
      service.from('pos_order_items').select(ITEM_COLUMNS).eq('order_id', orderId).order('seq', { ascending: true }).range(from, to)
    ),
    fetchAll<PosEvent>((from, to) =>
      service
        .from('pos_events')
        .select(EVENT_COLUMNS)
        .eq('order_id', orderId)
        .order('at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    ),
    service.from('pos_sessions').select('id, branch_id, kind, status, started_at, started_by, ended_at, ended_by').eq('id', order.session_id).maybeSingle(),
  ])
  const dmap = directoryMap(dirRead.data)
  const sessionRaw = unwrap<PosSession | null>(sessionRes)
  const session: SessionLite | null = sessionRaw ? liteSession(sessionRaw, dmap) : null

  const people = new Set<string>([order.created_by])
  if (order.voided_by) people.add(order.voided_by)
  for (const l of items) for (const id of [l.created_by, l.claimed_by, l.picked_up_by, l.delivered_by, l.voided_by]) if (id) people.add(id)
  for (const e of events) if (e.actor_id) people.add(e.actor_id)

  const staffRes = await guarded<{ id: string; handle: string; colour: string | null; email: string | null; display_name: string | null }[]>([], async () => {
    const r = await service.from('staff').select('id, handle, colour, email, display_name').in('id', Array.from(people))
    return unwrap<{ id: string; handle: string; colour: string | null; email: string | null; display_name: string | null }[] | null>(r) ?? []
  })
  // Emails are the manager's, here only. If the read failed, handles still resolve from the directory.
  const staff: OrderStaffRef[] = staffRes.ok
    ? staffRes.data.map((s) => ({ id: s.id, handle: s.handle, colour: s.colour, email: s.email, displayName: s.display_name }))
    : Array.from(people).flatMap((id) => {
        const d = dmap.get(id)
        return d ? [{ id, handle: d.handle, colour: d.colour, email: null, displayName: null }] : []
      })

  const pointIds = Array.from(new Set(items.map((l) => l.point_id)))
  const pointsRes = await guarded<{ id: string; name: string; colour: string; icon: string }[]>([], async () => {
    if (pointIds.length === 0) return []
    const r = await service.from('pos_points').select('id, name, colour, icon').in('id', pointIds)
    return unwrap<{ id: string; name: string; colour: string; icon: string }[] | null>(r) ?? []
  })

  return {
    order,
    session,
    items,
    events: events.map((e) => ({ ...e, payload: scrubPayload(e.payload) })),
    staff,
    points: pointsRes.data,
    directory: dirRead.data as StaffDirEntry[],
    serverTime: new Date().toISOString(),
  }
}
