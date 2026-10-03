// Statistics (blueprint §13.2): all fourteen metrics, computed in TypeScript from the
// STAMPED columns, never from anything the browser sent.
//
// WHY TypeScript and not SQL: the figures are derived from rows the lifecycle already
// stamped (sent_at, claimed_at, ready_at, delivered_at, voided_*), the data set of one
// event is small, and a hand-written aggregate in a migration would be a second place
// the rules (what counts as a void, what a "prep" is) could drift. PostgREST caps a
// response at 1000 rows, so every read pages with `fetchAll` — an event with 1,400
// orders must not quietly report 1,000.
//
// THE POSTURE (src/lib/owner/signals.ts): every read is independent and swallows its own
// failure; every number carries `known`. A failed read shows "—", never a confident 0.
// Training sessions are excluded unless the owner asked for them.
//
// This file is pure apart from the read in `readStats`, which takes the service-role
// client as an argument (a TYPE-only import above), so the helpers — `median`, `p90`,
// the time-zone floor, the timing maths — load and run in the harness with no server.

import type { Localized } from '@/lib/menu/types'
import type { PosCheckin, PosItem, PosOrder, PosPoint, PosSession, StaffDirEntry } from '@/lib/pos/types'
import type {
  CategoryStat, ItemStat, Known, PeakBucket, PointStat, PosStat, PresenceStat, SessionLite, SlipRow, SoldOutEvent,
  StaffRef, StaffStat, StatsPayload, StatsQuery, ThroughputBucket, TimingSet, TimingStat, UncollectedRow, VoidStats,
} from '@/lib/pos/owner-api'
import {
  cap, directoryMap, fetchAll, guarded, iso, liteSession, ms, readBranch, readCheckins, readDirectory, readPoints, staffRef,
  type DirectoryMap, type Read, type Service,
} from '@/lib/pos/server/readiness'

// ======================================================================================
// Pure helpers — exported for the harness
// ======================================================================================

/** Linear-interpolated percentile (the common "type 7" definition) over a sorted copy,
 *  rounded to whole seconds. null for an empty list — "no data" is not zero. */
export function percentile(values: readonly number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  if (v.length === 1) return Math.round(v[0] as number)
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (v.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  const a = v[lo] as number
  const b = v[hi] as number
  return Math.round(a + (b - a) * (rank - lo))
}
export const median = (values: readonly number[]): number | null => percentile(values, 50)
export const p90 = (values: readonly number[]): number | null => percentile(values, 90)

export function timingStat(values: readonly number[]): TimingStat {
  return { count: values.length, medianSeconds: median(values), p90Seconds: p90(values) }
}

const FALLBACK_TZ = 'Asia/Jerusalem'
const formatters = new Map<string, Intl.DateTimeFormat>()

/** A time zone Intl accepts, else the bar's own. (A bad `branches.timezone` must not 500 the page.) */
export function safeTimeZone(tz: string | null | undefined): string {
  const name = tz || FALLBACK_TZ
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: name })
    return name
  } catch {
    return FALLBACK_TZ
  }
}

function formatterFor(tz: string): Intl.DateTimeFormat {
  const cached = formatters.get(tz)
  if (cached) return cached
  // hourCycle h23, not hour12:false — the latter prints midnight as "24" in some engines.
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  formatters.set(tz, f)
  return f
}

export type ZonedParts = { y: number; mo: number; d: number; h: number; mi: number; s: number }

/** The wall-clock fields of an instant in a zone. */
export function zonedParts(instantMs: number, tz: string): ZonedParts {
  const out: ZonedParts = { y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0 }
  for (const p of formatterFor(safeTimeZone(tz)).formatToParts(new Date(instantMs))) {
    if (p.type === 'year') out.y = Number(p.value)
    else if (p.type === 'month') out.mo = Number(p.value)
    else if (p.type === 'day') out.d = Number(p.value)
    else if (p.type === 'hour') out.h = Number(p.value) % 24
    else if (p.type === 'minute') out.mi = Number(p.value)
    else if (p.type === 'second') out.s = Number(p.value)
  }
  return out
}

/** The start (as an instant) of the `minutes`-long local bucket that contains `instantMs`.
 *  Works for any bucket that divides an hour, in any zone whose offset is whole minutes. */
export function floorLocal(instantMs: number, tz: string, minutes: number): number {
  const p = zonedParts(instantMs, tz)
  const subSecond = ((instantMs % 1000) + 1000) % 1000
  return instantMs - ((p.mi % minutes) * 60 + p.s) * 1000 - subSecond
}

/** "HH:MM" on the zone's wall clock. */
export function localHHMM(instantMs: number, tz: string): string {
  const p = zonedParts(instantMs, tz)
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`
}

/** The instant a local calendar day starts in a zone (DST-safe: a couple of fix-up passes). */
export function zonedDayStartMs(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const target = Date.UTC(y, m - 1, d, 0, 0, 0)
  let guess = target
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, tz)
    const diff = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - target
    if (diff === 0) break
    guess -= diff
  }
  return guess
}

/** `from`/`to` are `YYYY-MM-DD` in the branch zone; `to` is inclusive, so it becomes the
 *  start of the NEXT day, exclusive. */
export function dateRangeMs(from: string | undefined, to: string | undefined, tz: string): { fromMs: number | null; toMs: number | null } {
  const fromMs = from ? zonedDayStartMs(from, tz) : null
  let toMs: number | null = null
  if (to) {
    const [y, m, d] = to.split('-').map(Number) as [number, number, number]
    const next = new Date(Date.UTC(y, m - 1, d + 1))
    toMs = zonedDayStartMs(next.toISOString().slice(0, 10), tz)
  }
  return { fromMs, toMs }
}

type Stamped = Pick<PosItem, 'status' | 'sent_at' | 'claimed_at' | 'ready_at' | 'delivered_at'>

/** Seconds between the stamped moments of one line. A line a FAST point took straight to
 *  "ready" has claimed_at === ready_at (one transaction, one now()) — it was never really
 *  accepted, so its queue wait and prep are not measurable and are left out rather than
 *  recorded as a misleading 0. Voided lines produce nothing. */
export function lineTimings(l: Stamped): { queueWait: number | null; prep: number | null; uncollected: number | null; total: number | null } {
  const none = { queueWait: null, prep: null, uncollected: null, total: null }
  if (l.status === 'voided') return none
  const sent = ms(l.sent_at)
  const claimed = ms(l.claimed_at)
  const ready = ms(l.ready_at)
  const delivered = ms(l.delivered_at)
  const skippedAccept = claimed !== null && claimed === ready
  const secs = (a: number | null, b: number | null) => (a !== null && b !== null ? Math.max(0, (b - a) / 1000) : null)
  return {
    queueWait: skippedAccept ? null : secs(sent, claimed),
    prep: skippedAccept ? null : secs(claimed, ready),
    uncollected: secs(ready, delivered),
    total: secs(sent, delivered),
  }
}

export function timingSetOf(lines: readonly Stamped[]): TimingSet {
  const q: number[] = []
  const p: number[] = []
  const u: number[] = []
  const t: number[] = []
  for (const l of lines) {
    const x = lineTimings(l)
    if (x.queueWait !== null) q.push(x.queueWait)
    if (x.prep !== null) p.push(x.prep)
    if (x.uncollected !== null) u.push(x.uncollected)
    if (x.total !== null) t.push(x.total)
  }
  return { queueWait: timingStat(q), prep: timingStat(p), uncollected: timingStat(u), total: timingStat(t) }
}

const round1 = (n: number) => Math.round(n * 10) / 10
const nameKey = (n: Localized | null | undefined) => n?.he || n?.en || n?.ar || ''

// ======================================================================================
// Scope: which sessions the numbers cover
// ======================================================================================

export type Scope = { sessionId: string | null; includeTraining: boolean; sessions: PosSession[] }

/**
 * `sessions` newest first. A named session is used as asked (even a training one — the
 * owner chose it); `all` covers every session, minus practice ones unless asked; no
 * choice defaults to the active session, else the latest — live only, unless practice
 * was asked for. Training is excluded from the default on purpose: guessing "training"
 * during real service would hide real orders from the numbers (blueprint §10.5).
 */
export function resolveScope(sessions: readonly PosSession[], query: Pick<StatsQuery, 'session' | 'training'>): Scope {
  const wantTraining = query.training === '1'
  const sel = query.session
  if (sel && sel !== 'all') {
    const s = sessions.find((x) => x.id === sel)
    return { sessionId: sel, includeTraining: wantTraining || s?.kind === 'training', sessions: s ? [s] : [] }
  }
  const pool = wantTraining ? [...sessions] : sessions.filter((s) => s.kind === 'live')
  if (sel === 'all') return { sessionId: null, includeTraining: wantTraining, sessions: pool }
  const chosen = pool.find((s) => s.status === 'active') ?? pool[0]
  return { sessionId: chosen?.id ?? null, includeTraining: wantTraining, sessions: chosen ? [chosen] : [] }
}

// ======================================================================================
// The computation — pure
// ======================================================================================

export type StatsOrder = Pick<
  PosOrder,
  'id' | 'session_id' | 'ticket_no' | 'customer_name' | 'status' | 'total_agorot' | 'slip_total_agorot' | 'slip_mismatch' | 'created_by' | 'created_at'
>
export type StatsItem = Pick<
  PosItem,
  | 'id' | 'order_id' | 'point_id' | 'point_name' | 'item_uid' | 'category_id' | 'category_title' | 'name' | 'qty' | 'unit_agorot'
  | 'status' | 'sent_at' | 'claimed_by' | 'claimed_at' | 'ready_at' | 'delivered_by' | 'delivered_at' | 'voided_by' | 'void_reason'
>
export type AuditRow = {
  id: string
  actor_name: string | null
  summary: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

export type StatsInput = {
  now: number
  timezone: string
  scopeSessions: PosSession[]
  orders: Read<StatsOrder[]>
  items: Read<StatsItem[]>
  checkins: Read<PosCheckin[]>
  /** actor_id of every item_ready event in scope — `ready` has no stamped "by" column */
  readyEvents: Read<{ actor_id: string | null }[]>
  audit: Read<AuditRow[]>
  points: Read<PosPoint[]>
  dir: DirectoryMap
}

type Computed = Pick<
  StatsPayload,
  'hero' | 'tiles' | 'perItem' | 'perPoint' | 'throughput' | 'timing' | 'peakHours' | 'perStaff' | 'voids' | 'slips' | 'presence' | 'uncollected' | 'soldOut' | 'categories'
>

const lineAgorot = (l: Pick<StatsItem, 'qty' | 'unit_agorot'>) => l.qty * l.unit_agorot
const NEUTRAL = '#9CA3AF'

export function computeStats(i: StatsInput): Computed {
  const { orders, items, dir, now } = i
  const tz = safeTimeZone(i.timezone)
  const kn = <T>(value: T, ...reads: Read<unknown>[]): Known<T> => ({ known: reads.every((r) => r.ok), value })
  const st = (value: number, ...reads: Read<unknown>[]): PosStat => ({ known: reads.every((r) => r.ok), value })

  const liveOrders = orders.data.filter((o) => o.status !== 'void')
  const sales = liveOrders.reduce((s, o) => s + o.total_agorot, 0)
  const liveLines = items.data.filter((l) => l.status !== 'voided')
  const pointInfo = new Map(i.points.data.map((p) => [p.id, p] as const))
  const ref = (id: string | null) => staffRef(dir, id)
  const asRef = (id: string): StaffRef => ref(id) ?? { id, handle: '—' }

  // ---- #1 per item -------------------------------------------------------------------
  const salesTotal = liveLines.reduce((s, l) => s + lineAgorot(l), 0)
  const itemGroups = new Map<string, StatsItem[]>()
  for (const l of items.data) {
    const key = l.item_uid ?? `custom:${nameKey(l.name)}`
    const g = itemGroups.get(key)
    if (g) g.push(l)
    else itemGroups.set(key, [l])
  }
  const perItem: ItemStat[] = []
  itemGroups.forEach((lines, key) => {
    const live = lines.filter((l) => l.status !== 'voided')
    if (live.length === 0) return
    const agorot = live.reduce((s, l) => s + lineAgorot(l), 0)
    perItem.push({
      key,
      itemUid: lines[0]?.item_uid ?? null,
      name: (lines[0]?.name ?? {}) as Localized,
      qty: live.reduce((s, l) => s + l.qty, 0),
      agorot,
      share: salesTotal > 0 ? agorot / salesTotal : 0,
      timing: timingSetOf(lines),
    })
  })
  perItem.sort((a, b) => b.agorot - a.agorot || b.qty - a.qty || a.key.localeCompare(b.key))

  // ---- #2 / #3 / #4 per point ----------------------------------------------------------
  const pointGroups = new Map<string, StatsItem[]>()
  for (const l of items.data) {
    const g = pointGroups.get(l.point_id)
    if (g) g.push(l)
    else pointGroups.set(l.point_id, [l])
  }
  const perPoint: PointStat[] = []
  pointGroups.forEach((lines, pointId) => {
    const live = lines.filter((l) => l.status !== 'voided')
    const info = pointInfo.get(pointId)
    const agorot = live.reduce((s, l) => s + lineAgorot(l), 0)
    perPoint.push({
      pointId,
      // the current name when the point still exists, else the snapshot the line carries
      name: info?.name ?? lines[0]?.point_name ?? '—',
      colour: info?.colour ?? NEUTRAL,
      icon: info?.icon ?? null,
      orders: new Set(live.map((l) => l.order_id)).size,
      lines: live.length,
      qty: live.reduce((s, l) => s + l.qty, 0),
      agorot,
      share: salesTotal > 0 ? agorot / salesTotal : 0,
      backlog: {
        sent: lines.filter((l) => l.status === 'sent').length,
        preparing: lines.filter((l) => l.status === 'preparing').length,
        ready: lines.filter((l) => l.status === 'ready').length,
      },
      timing: timingSetOf(lines),
    })
  })
  perPoint.sort((a, b) => b.agorot - a.agorot || a.name.localeCompare(b.name))

  const buckets = new Map<string, ThroughputBucket>()
  for (const l of liveLines) {
    const t = ms(l.sent_at)
    if (t === null) continue
    const start = floorLocal(t, tz, 15)
    const key = `${l.point_id}|${start}`
    const b = buckets.get(key)
    if (b) b.items += l.qty
    else buckets.set(key, { startsAt: iso(start), label: localHHMM(start, tz), pointId: l.point_id, items: l.qty })
  }
  const throughput = Array.from(buckets.values()).sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : a.pointId.localeCompare(b.pointId)))

  const timing = timingSetOf(items.data)

  // ---- #5 peak hours --------------------------------------------------------------------
  const peak = new Map<number, PeakBucket>()
  for (const o of liveOrders) {
    const t = ms(o.created_at)
    if (t === null) continue
    const start = floorLocal(t, tz, 15)
    const b = peak.get(start)
    if (b) {
      b.orders++
      b.agorot += o.total_agorot
    } else {
      peak.set(start, { startsAt: iso(start), label: localHHMM(start, tz), orders: 1, agorot: o.total_agorot })
    }
  }
  const peakHours = Array.from(peak.values()).sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))

  // ---- #6 per staff -----------------------------------------------------------------------
  const staff = new Map<string, StaffStat>()
  const row = (id: string): StaffStat => {
    let r = staff.get(id)
    if (!r) {
      r = { staff: asRef(id), ordersEntered: 0, agorotEntered: 0, accepted: 0, readied: i.readyEvents.ok ? 0 : null, handedOver: 0, voids: 0 }
      staff.set(id, r)
    }
    return r
  }
  for (const o of orders.data) {
    const r = row(o.created_by)
    r.ordersEntered++
    r.agorotEntered += o.total_agorot
  }
  for (const l of items.data) {
    if (l.claimed_by) row(l.claimed_by).accepted++
    if (l.delivered_by) row(l.delivered_by).handedOver++
    if (l.voided_by) row(l.voided_by).voids++
  }
  if (i.readyEvents.ok) {
    for (const e of i.readyEvents.data) if (e.actor_id) row(e.actor_id).readied = (row(e.actor_id).readied ?? 0) + 1
  }
  const perStaff = Array.from(staff.values()).sort(
    (a, b) =>
      b.ordersEntered + b.accepted + b.handedOver - (a.ordersEntered + a.accepted + a.handedOver) || a.staff.handle.localeCompare(b.staff.handle),
  )

  // ---- #7 voids -----------------------------------------------------------------------------
  const voidedLines = items.data.filter((l) => l.status === 'voided')
  const tally = <K extends string>(keys: K[]) => {
    const m = new Map<K, number>()
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1)
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }
  const voidItems = new Map<string, { name: Localized; lines: number; qty: number }>()
  for (const l of voidedLines) {
    const key = l.item_uid ?? `custom:${nameKey(l.name)}`
    const v = voidItems.get(key) ?? { name: l.name as Localized, lines: 0, qty: 0 }
    v.lines++
    v.qty += l.qty
    voidItems.set(key, v)
  }
  const voids: VoidStats = {
    voidedLines: voidedLines.length,
    totalLines: items.data.length,
    ratePercent: items.data.length > 0 ? round1((voidedLines.length / items.data.length) * 100) : 0,
    voidedOrders: orders.data.filter((o) => o.status === 'void').length,
    byStaff: tally(voidedLines.map((l) => l.voided_by).filter((x): x is string => !!x)).map(([id, lines]) => ({ staff: asRef(id), lines })),
    byItem: Array.from(voidItems.entries())
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.lines - a.lines || a.key.localeCompare(b.key)),
    byReason: tally(voidedLines.map((l) => l.void_reason || '—')).map(([reason, lines]) => ({ reason, lines })),
  }

  // ---- #10 slips ----------------------------------------------------------------------------
  const withSlip = liveOrders.filter((o) => o.slip_total_agorot !== null)
  const slipRows: SlipRow[] = withSlip
    .filter((o) => o.slip_mismatch)
    .map((o) => ({
      orderId: o.id,
      ticketNo: o.ticket_no,
      customerName: o.customer_name,
      totalAgorot: o.total_agorot,
      slipAgorot: o.slip_total_agorot ?? 0,
      diffAgorot: (o.slip_total_agorot ?? 0) - o.total_agorot,
    }))
  const slips = { ordersWithSlip: withSlip.length, mismatches: slipRows.length, rows: slipRows.slice(0, 100) }

  // ---- #11 presence ----------------------------------------------------------------------------
  const windows = i.scopeSessions.map((s) => ({ start: ms(s.started_at) ?? now, end: ms(s.ended_at) ?? now }))
  const acceptedBy = new Map<string, number>()
  for (const l of items.data) if (l.claimed_by) acceptedBy.set(`${l.claimed_by}|${l.point_id}`, (acceptedBy.get(`${l.claimed_by}|${l.point_id}`) ?? 0) + 1)
  const presence = presenceStats(i.checkins.data, windows, now, acceptedBy, asRef, (id) => pointInfo.get(id)?.name ?? pointGroups.get(id)?.[0]?.point_name ?? '—')

  // ---- #12 uncollected ------------------------------------------------------------------------------
  const orderById = new Map(orders.data.map((o) => [o.id, o] as const))
  const readyByOrder = new Map<string, StatsItem[]>()
  for (const l of items.data) {
    if (l.status !== 'ready') continue
    const g = readyByOrder.get(l.order_id)
    if (g) g.push(l)
    else readyByOrder.set(l.order_id, [l])
  }
  const uncollectedRows: UncollectedRow[] = []
  readyByOrder.forEach((lines, orderId) => {
    const o = orderById.get(orderId)
    const pts = new Map<string, { id: string; name: string; colour: string }>()
    let oldest = now
    for (const l of lines) {
      pts.set(l.point_id, { id: l.point_id, name: pointInfo.get(l.point_id)?.name ?? l.point_name, colour: pointInfo.get(l.point_id)?.colour ?? NEUTRAL })
      oldest = Math.min(oldest, ms(l.ready_at) ?? now)
    }
    uncollectedRows.push({
      orderId,
      ticketNo: o?.ticket_no ?? 0,
      customerName: o?.customer_name ?? '—',
      // The statistics page never carries a phone — only the live dashboard does, so
      // someone can call about an order that is waiting right now.
      customerPhone: null,
      points: Array.from(pts.values()),
      lines: lines.length,
      readySeconds: Math.max(0, Math.floor((now - oldest) / 1000)),
    })
  })
  uncollectedRows.sort((a, b) => b.readySeconds - a.readySeconds || a.ticketNo - b.ticketNo)

  // ---- #13 sold-out timeline ----------------------------------------------------------------------------
  const soldOut: SoldOutEvent[] = i.audit.data.map((a) => {
    const d = (a.detail ?? {}) as Record<string, unknown>
    return {
      at: a.created_at,
      summary: a.summary ?? '',
      itemUid: typeof d.itemUid === 'string' ? d.itemUid : null,
      typeUid: typeof d.typeUid === 'string' ? d.typeUid : null,
      available: typeof d.available === 'boolean' ? d.available : null,
      quantity: typeof d.quantity === 'number' ? d.quantity : null,
      actor: a.actor_name,
    }
  })

  // ---- #14 categories --------------------------------------------------------------------------------------
  const cats = new Map<string, { categoryId: string | null; title: Localized; qty: number; agorot: number }>()
  for (const l of liveLines) {
    const key = l.category_id ?? '—'
    const c = cats.get(key) ?? { categoryId: l.category_id, title: (l.category_title ?? {}) as Localized, qty: 0, agorot: 0 }
    c.qty += l.qty
    c.agorot += lineAgorot(l)
    cats.set(key, c)
  }
  const categories: CategoryStat[] = Array.from(cats.values())
    .map((c) => ({ ...c, share: salesTotal > 0 ? c.agorot / salesTotal : 0 }))
    .sort((a, b) => b.agorot - a.agorot || (a.categoryId ?? '').localeCompare(b.categoryId ?? ''))

  // ---- tiles & hero ------------------------------------------------------------------------------------------
  const unitsLive = liveLines.reduce((s, l) => s + l.qty, 0)
  const n = liveOrders.length
  return {
    hero: { salesAgorot: st(sales, orders) },
    tiles: {
      orders: st(n, orders),
      averageTicketAgorot: st(n > 0 ? Math.round(sales / n) : 0, orders),
      itemsPerTicket: st(n > 0 ? round1(unitsLive / n) : 0, orders, items),
      voidRatePercent: st(voids.ratePercent, items),
      customersServed: st(n, orders),
      medianPrepSeconds: kn<number | null>(timing.prep.medianSeconds, items),
      medianTotalSeconds: kn<number | null>(timing.total.medianSeconds, items),
    },
    perItem: kn(perItem, items),
    perPoint: kn(perPoint, items),
    throughput: kn(throughput, items),
    timing: kn(timing, items),
    peakHours: kn(peakHours, orders),
    perStaff: kn(perStaff, orders, items),
    voids: kn(voids, items, orders),
    slips: kn(slips, orders),
    presence: kn(presence, i.checkins, items),
    uncollected: kn(cap(uncollectedRows, 100), items, orders),
    soldOut: kn(soldOut, i.audit),
    categories: kn(categories, items),
  }
}

/** Minutes each person spent on each point, clamped to the session windows, and what they
 *  accepted per hour there. A check-in with no check-out runs to the end of its window —
 *  and ONLY to it: someone who forgot to check out overnight must not be credited 14 hours. */
export function presenceStats(
  checkins: readonly PosCheckin[],
  windows: readonly { start: number; end: number }[],
  now: number,
  acceptedBy: ReadonlyMap<string, number>,
  asRef: (id: string) => StaffRef,
  pointName: (id: string) => string,
): PresenceStat[] {
  const groups = new Map<string, PosCheckin[]>()
  for (const c of checkins) {
    const key = `${c.staff_id}|${c.point_id}`
    const g = groups.get(key)
    if (g) g.push(c)
    else groups.set(key, [c])
  }
  const overlap = (a: number, b: number) => {
    let total = 0
    for (const w of windows) total += Math.max(0, Math.min(b, w.end) - Math.max(a, w.start))
    return total
  }
  const out: PresenceStat[] = []
  groups.forEach((events, key) => {
    events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.localeCompare(b.id)))
    let open: number | null = null
    let totalMs = 0
    for (const e of events) {
      const t = ms(e.at)
      if (t === null) continue
      if (e.event === 'check_in') {
        if (open === null) open = t
      } else if (open !== null) {
        totalMs += overlap(open, t)
        open = null
      }
    }
    if (open !== null) totalMs += overlap(open, now)
    const minutes = Math.round(totalMs / 60000)
    if (minutes <= 0) return
    const [staffId, pointId] = key.split('|') as [string, string]
    const accepted = acceptedBy.get(key) ?? 0
    out.push({
      staff: asRef(staffId),
      pointId,
      pointName: pointName(pointId),
      minutes,
      accepted,
      itemsPerHour: minutes >= 1 ? round1(accepted / (minutes / 60)) : null,
    })
  })
  return out.sort((a, b) => b.minutes - a.minutes || a.staff.handle.localeCompare(b.staff.handle))
}

// ======================================================================================
// The read
// ======================================================================================

const ORDER_STAT_COLUMNS =
  'id, session_id, ticket_no, customer_name, status, total_agorot, slip_total_agorot, slip_mismatch, created_by, created_at'
const ITEM_STAT_COLUMNS =
  'id, order_id, point_id, point_name, item_uid, category_id, category_title, name, qty, unit_agorot, status, sent_at, ' +
  'claimed_by, claimed_at, ready_at, delivered_by, delivered_at, voided_by, void_reason'

type ItemWithOrder = StatsItem & { pos_orders: { session_id: string } | null }

async function readAllSessions(service: Service, branchId: string): Promise<PosSession[]> {
  return fetchAll<PosSession>((from, to) =>
    service
      .from('pos_sessions')
      .select('id, branch_id, kind, status, started_at, started_by, ended_at, ended_by')
      .eq('branch_id', branchId)
      .order('started_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)
  )
}

const EMPTY: Read<never[]> = { ok: true, data: [] }

/** GET /api/owner/pos/stats */
export async function readStats(service: Service, branch: { id: string; slug: string }, query: StatsQuery): Promise<StatsPayload> {
  const now = Date.now()
  const [info, dirRead, sessionsRead, pointsRead] = await Promise.all([
    readBranch(service, branch),
    readDirectory(service),
    guarded<PosSession[]>([], () => readAllSessions(service, branch.id)),
    guarded<PosPoint[]>([], () => readPoints(service, branch.id, { includeInactive: true })),
  ])
  const tz = safeTimeZone(info.timezone)
  const dmap = directoryMap(dirRead.data)
  const scope = resolveScope(sessionsRead.data, query)
  const scopeIds = new Set(scope.sessions.map((s) => s.id))
  const pickerSessions: SessionLite[] = sessionsRead.data.slice(0, 40).map((s) => liteSession(s, dmap))

  // No sessions chosen (none exist, or the id is not this branch's) — nothing to read.
  const hasScope = scope.sessions.length > 0
  const windowStart = hasScope ? Math.min(...scope.sessions.map((s) => ms(s.started_at) ?? now)) : now
  const windowEnd = hasScope ? Math.max(...scope.sessions.map((s) => ms(s.ended_at) ?? now)) : now
  const single = scope.sessionId && scope.sessions.length === 1 ? scope.sessionId : null

  const [orders, items, checkins, readyEvents, audit] = await Promise.all([
    hasScope
      ? guarded<StatsOrder[]>([], async () => {
          const rows = await fetchAll<StatsOrder>((from, to) => {
            let q = service.from('pos_orders').select(ORDER_STAT_COLUMNS).eq('branch_id', branch.id)
            if (single) q = q.eq('session_id', single)
            return q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)
          })
          return rows.filter((o) => scopeIds.has(o.session_id))
        })
      : Promise.resolve(EMPTY as Read<StatsOrder[]>),
    hasScope
      ? guarded<StatsItem[]>([], async () => {
          const rows = await fetchAll<ItemWithOrder>((from, to) => {
            let q = service.from('pos_order_items').select(`${ITEM_STAT_COLUMNS}, pos_orders!inner(session_id)`).eq('branch_id', branch.id)
            if (single) q = q.eq('pos_orders.session_id', single)
            return q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)
          })
          return rows.filter((l) => l.pos_orders !== null && scopeIds.has(l.pos_orders.session_id))
        })
      : Promise.resolve(EMPTY as Read<StatsItem[]>),
    hasScope
      ? guarded<PosCheckin[]>([], async () => {
          // from 12 h before the window so someone who arrived and checked in BEFORE the event opened is counted
          const rows = await readCheckins(service, branch.id, iso(windowStart - 12 * 3600_000))
          return rows.filter((c) => (ms(c.at) ?? 0) <= windowEnd)
        })
      : Promise.resolve(EMPTY as Read<PosCheckin[]>),
    hasScope
      ? guarded<{ actor_id: string | null }[]>([], async () => {
          const rows = await fetchAll<{ id: number; actor_id: string | null; session_id: string | null }>((from, to) => {
            let q = service.from('pos_events').select('id, actor_id, session_id').eq('branch_id', branch.id).eq('event', 'item_ready')
            if (single) q = q.eq('session_id', single)
            return q.order('id', { ascending: true }).range(from, to)
          })
          return rows.filter((e) => e.session_id !== null && scopeIds.has(e.session_id))
        })
      : Promise.resolve(EMPTY as Read<{ actor_id: string | null }[]>),
    hasScope
      ? guarded<AuditRow[]>([], () =>
          fetchAll<AuditRow>((from, to) =>
            service
              .from('menu_audit')
              .select('id, actor_name, summary, detail, created_at')
              .eq('branch_id', branch.id)
              .eq('action', 'menu.availability')
              .gte('created_at', iso(windowStart))
              .lte('created_at', iso(windowEnd))
              .order('created_at', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to)
          )
        )
      : Promise.resolve(EMPTY as Read<AuditRow[]>),
  ])

  // A failed session read means we cannot tell what is in scope: nothing computed from
  // it may claim to be known.
  const sessionsOk: Read<unknown> = { ok: sessionsRead.ok, data: null }
  const gate = <T>(r: Read<T>): Read<T> => ({ ok: r.ok && sessionsOk.ok, data: r.data })

  const computed = computeStats({
    now,
    timezone: tz,
    scopeSessions: scope.sessions,
    orders: gate(orders),
    items: gate(items),
    checkins: gate(checkins),
    readyEvents: gate(readyEvents),
    audit: gate(audit),
    points: pointsRead,
    dir: dmap,
  })

  return {
    serverTime: new Date(now).toISOString(),
    timezone: tz,
    scope: {
      sessionId: scope.sessionId,
      includeTraining: scope.includeTraining,
      sessions: scope.sessions.map((s) => liteSession(s, dmap)),
    },
    pickerSessions,
    ...computed,
    directory: dirRead.data as StaffDirEntry[],
  }
}

