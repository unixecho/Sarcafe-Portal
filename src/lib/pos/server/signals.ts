// The owner dashboard's data: the four numbers, the signal stack, the per-point cards,
// who is on which point, who is working on what, the live feed — one payload.
//
// IT IS A SIGNAL SURFACE, NOT A SETTINGS PAGE (src/lib/owner/signals.ts, blueprint
// §13.3). Four rules this file exists to keep:
//   * A signal is returned ONLY when it is true. There is no "all clear" row — a panel
//     that is always present becomes furniture and the night it says something real
//     nobody reads it.
//   * Every signal has a FIXED `rank` decided here, and the list leaves already sorted,
//     so the stack cannot jitter between two loads with identical contents.
//   * Every read is independent and swallows its own failure. A broken query drops its
//     own number to `known:false` and its own signal out of the list — never the page,
//     and never a confident 0.
//   * A number and the list under it come from ONE array. `stuckItems` is
//     `drill.stuck.total`, the "stuck" signal's count is the same; the filter constants
//     (IN_FLIGHT_ITEM_STATUSES …) are imported from vocab.ts, never re-typed, so a
//     drill-down can never disagree with the figure above it.
//
// Cheap on purpose: it is polled every 30 s AND refetched on a realtime signal (at most
// every 2 s), so it makes a fixed handful of narrow parallel reads — never a per-row query.
// The unfinished-lines read is the live set (tens of rows), the session reads carry only
// the columns the maths needs.

import type { Localized } from '@/lib/menu/types'
import { routeMenu, type RoutedItem } from '@/lib/pos/routing'
import { EVENT_COLUMNS } from '@/lib/pos/columns'
import type { PosCheckin, PosEvent, PosItem, PosOrder, PosPoint, PosRoute, PosSession } from '@/lib/pos/types'
import { AGING, DASHBOARD, IN_FLIGHT_ITEM_STATUSES, LIVE_ITEM_STATUSES } from '@/lib/pos/vocab'
import type {
  Bilingual, BranchInfo, DashboardDrill, DashboardPayload, DashboardStats, HourBucket, Known, OpenTicketRow, PointCard,
  PointSales, PosSignal, PosStat, PresenceGroup, ProcessingLine, ProcessingRow, SessionLite, SlipRow,
  SoldOutRow, StaffOrders, StaffRef, StuckRow, UncollectedRow, UnroutedItem,
} from '@/lib/pos/owner-api'
import {
  cap, directoryMap, fetchAll, guarded, iso, liteSession, ms, readBranch, readCheckins, readDirectory, readPeople,
  readPoints, readPublishedMenu, readRoutes, readSessions, readSettingsRow, routingContext, staffRef, toUnrouted,
  unwrap, type DirectoryMap, type PublishedMenu, type Read, type Service, type SettingsRow, type StaffPerson,
} from '@/lib/pos/server/readiness'
import { floorLocal, lineTimings, localHHMM, median, safeTimeZone } from '@/lib/pos/server/stats'

// ---- Thresholds. Exported: a count and its drill-down share them. ------------------------

/** Stuck = still waiting / being prepared after max(minMinutes, factor × the point's prep). */
export const stuckThresholdMinutes = (prepMinutes: number): number =>
  Math.max(DASHBOARD.stuckMinMinutes, DASHBOARD.stuckFactor * prepMinutes)

/** How long a drill-down panel is allowed to get before it says "…and N more". */
export const DRILL_LIMIT = 50
/** Median prep on a card looks at this many of the point's most recently finished lines. */
export const CARD_TIMING_SAMPLE = 20
/** Check-ins older than this are not "on the point now" — someone who forgot to check out. */
const PRESENCE_LOOKBACK_HOURS = DASHBOARD.sessionOpenTooLongHours

// ---- Rows ------------------------------------------------------------------------------

type OrderEmbed = { ticket_no: number; customer_name: string; customer_phone: string | null }
export type LiveLine = Pick<
  PosItem,
  'id' | 'order_id' | 'point_id' | 'point_name' | 'name' | 'qty' | 'status' | 'sent_at' | 'claimed_by' | 'claimed_at' | 'ready_at'
> & { pos_orders: OrderEmbed | null }

export type TimedLine = Pick<PosItem, 'point_id' | 'status' | 'sent_at' | 'claimed_at' | 'ready_at' | 'delivered_at'>

export type ScopeOrder = Pick<
  PosOrder,
  'id' | 'ticket_no' | 'customer_name' | 'status' | 'total_agorot' | 'slip_total_agorot' | 'slip_mismatch' | 'created_by' | 'created_at'
>
export type ScopeItem = Pick<PosItem, 'id' | 'order_id' | 'point_id' | 'point_name' | 'qty' | 'unit_agorot' | 'status'>

export type DashInput = {
  now: number
  settings: Read<SettingsRow | null>
  sessions: Read<PosSession[]>
  points: Read<PosPoint[]>
  routes: Read<PosRoute[]>
  menu: Read<PublishedMenu | null>
  live: Read<LiveLine[]>
  timed: Read<TimedLine[]>
  scopeOrders: Read<ScopeOrder[]>
  scopeItems: Read<ScopeItem[]>
  checkins: Read<PosCheckin[]>
  people: Read<StaffPerson[]>
  timezone: string
  dir: DirectoryMap
}

const both = (he: string, en: string): Bilingual => ({ he, en })
const nameOf = (l: Localized | null | undefined) => l?.he || l?.en || l?.ar || ''
const minutesOf = (seconds: number) => Math.max(1, Math.floor(seconds / 60))
const levelOf = (rank: number): PosSignal['level'] => (rank >= 80 ? 'critical' : rank >= 40 ? 'warning' : 'info')
/** "a, b, c and 4 more" — names only, the first few. */
function nameList(names: string[], lang: 'he' | 'en', max = 3): string {
  const shown = names.filter(Boolean).slice(0, max)
  const more = names.length - shown.length
  const tail = more > 0 ? (lang === 'he' ? ` ועוד ${more}` : ` and ${more} more`) : ''
  return shown.join(', ') + tail
}

// ======================================================================================
// The computation — pure, so it can be tested without a database
// ======================================================================================

export type DashComputed = Pick<DashboardPayload, 'active' | 'scope' | 'stats' | 'signals' | 'drill' | 'points' | 'presence' | 'processing' | 'enabled'>

export function computeDashboard(i: DashInput): DashComputed {
  const { now, dir } = i
  const tz = safeTimeZone(i.timezone)
  const ref = (id: string | null): StaffRef | null => staffRef(dir, id)
  const refOr = (id: string): StaffRef => ref(id) ?? { id, handle: '—' }
  const knownOf = <T,>(value: T, ...reads: Read<unknown>[]): Known<T> => ({ known: reads.every((r) => r.ok), value })
  const statOf = (value: number, ...reads: Read<unknown>[]): PosStat => ({ known: reads.every((r) => r.ok), value })

  const enabled = i.settings.data?.enabled === true
  const sessions = i.sessions.data
  const activeRaw = sessions.find((s) => s.status === 'active') ?? null
  // The numbers are about the open session, or — once it has closed — the latest LIVE one,
  // so a closed event's takings stay on the page until the next one opens.
  const scopeRaw = activeRaw ?? sessions.find((s) => s.kind === 'live') ?? null

  const allPoints = i.points.data
  const activePoints = allPoints.filter((p) => p.active)
  const pointById = new Map(allPoints.map((p) => [p.id, p] as const))
  const colourOf = (id: string) => pointById.get(id)?.colour ?? '#9CA3AF'
  const nameOfPoint = (id: string, snapshot: string) => pointById.get(id)?.name ?? snapshot

  // ---- Unfinished lines, branch-wide, newer than the stuck horizon --------------------
  const live = i.live.data
  const ageS = (l: LiveLine) => Math.max(0, (now - (ms(l.sent_at) ?? now)) / 1000)
  const inFlight = live.filter((l) => (IN_FLIGHT_ITEM_STATUSES as readonly string[]).includes(l.status))
  const waiting = live.filter((l) => l.status === 'sent')
  const preparing = live.filter((l) => l.status === 'preparing')
  const ready = live.filter((l) => l.status === 'ready')
  const overdue = waiting.filter((l) => ageS(l) >= AGING.lateS)
  const critical = waiting.filter((l) => ageS(l) >= AGING.criticalS)
  const readyAgeS = (l: LiveLine) => Math.max(0, (now - (ms(l.ready_at) ?? ms(l.sent_at) ?? now)) / 1000)
  const uncollectedLines = ready.filter((l) => readyAgeS(l) >= DASHBOARD.uncollectedMinutes * 60)

  const thresholdFor = (l: LiveLine) => stuckThresholdMinutes(pointById.get(l.point_id)?.prep_minutes ?? 8)
  const stuckLines = inFlight.filter((l) => ageS(l) >= thresholdFor(l) * 60)

  // ---- Drill-down rows -------------------------------------------------------------------
  const stuckRows: StuckRow[] = stuckLines
    .map((l): StuckRow => ({
      itemId: l.id,
      orderId: l.order_id,
      ticketNo: l.pos_orders?.ticket_no ?? 0,
      customerName: l.pos_orders?.customer_name ?? '—',
      pointId: l.point_id,
      pointName: nameOfPoint(l.point_id, l.point_name),
      pointColour: colourOf(l.point_id),
      name: l.name as Localized,
      qty: l.qty,
      status: l.status as StuckRow['status'],
      waitingSeconds: Math.floor(ageS(l)),
      thresholdMinutes: thresholdFor(l),
      claimedBy: ref(l.claimed_by),
    }))
    .sort((a, b) => b.waitingSeconds - a.waitingSeconds || a.itemId.localeCompare(b.itemId))

  const uncollectedByOrder = new Map<string, LiveLine[]>()
  for (const l of uncollectedLines) {
    const g = uncollectedByOrder.get(l.order_id)
    if (g) g.push(l)
    else uncollectedByOrder.set(l.order_id, [l])
  }
  const uncollectedRows: UncollectedRow[] = []
  uncollectedByOrder.forEach((lines, orderId) => {
    const pts = new Map<string, { id: string; name: string; colour: string }>()
    for (const l of lines) pts.set(l.point_id, { id: l.point_id, name: nameOfPoint(l.point_id, l.point_name), colour: colourOf(l.point_id) })
    const first = lines[0]
    uncollectedRows.push({
      orderId,
      ticketNo: first?.pos_orders?.ticket_no ?? 0,
      customerName: first?.pos_orders?.customer_name ?? '—',
      // PERSONAL DATA: shown so a manager can call; this response is manager-gated, never public.
      customerPhone: first?.pos_orders?.customer_phone ?? null,
      points: Array.from(pts.values()),
      lines: lines.length,
      readySeconds: Math.floor(Math.max(...lines.map(readyAgeS))),
    })
  })
  uncollectedRows.sort((a, b) => b.readySeconds - a.readySeconds || a.ticketNo - b.ticketNo)

  // The menu-derived lists only mean anything for a branch that actually runs a POS.
  const menu = i.menu.data
  const menuReads: Read<unknown>[] = [i.menu, i.points, i.routes, i.settings]
  const ctx = routingContext(activePoints, i.routes.data, i.settings.data?.unsold_refs ?? [])
  const routed: RoutedItem[] = enabled && menu ? routeMenu(ctx, menu.categories) : []
  const unroutedList: UnroutedItem[] = toUnrouted(routed.filter((r) => r.route.kind === 'unrouted'))
  const soldOutRows: SoldOutRow[] = routed
    .filter((r) => r.route.kind === 'point' && (r.item.available === false || r.item.quantity === 0))
    .map((r) => {
      const pointId = (r.route as { pointId: string }).pointId
      return {
        itemUid: r.item.uid as string,
        name: { he: r.item.he, en: r.item.en, ar: r.item.ar },
        pointId,
        pointName: pointById.get(pointId)?.name ?? '',
      }
    })

  // ---- The scope session's orders ----------------------------------------------------------
  const orders = i.scopeOrders.data
  const scopeItems = i.scopeItems.data
  const liveOrders = orders.filter((o) => o.status !== 'void')
  const sales = liveOrders.reduce((s, o) => s + o.total_agorot, 0)

  const linesByOrder = new Map<string, OpenTicketRow['lines']>()
  for (const l of scopeItems) {
    const c = linesByOrder.get(l.order_id) ?? { waiting: 0, preparing: 0, ready: 0, delivered: 0 }
    if (l.status === 'sent') c.waiting++
    else if (l.status === 'preparing') c.preparing++
    else if (l.status === 'ready') c.ready++
    else if (l.status === 'delivered') c.delivered++
    linesByOrder.set(l.order_id, c)
  }
  const openTicketRows: OpenTicketRow[] = orders
    .filter((o) => o.status === 'open')
    .map((o) => ({
      orderId: o.id,
      ticketNo: o.ticket_no,
      customerName: o.customer_name,
      createdBy: refOr(o.created_by),
      totalAgorot: o.total_agorot,
      ageSeconds: Math.max(0, Math.floor((now - (ms(o.created_at) ?? now)) / 1000)),
      lines: linesByOrder.get(o.id) ?? { waiting: 0, preparing: 0, ready: 0, delivered: 0 },
    }))
    .sort((a, b) => b.ageSeconds - a.ageSeconds || a.ticketNo - b.ticketNo)

  // Slip mismatches matter while the event runs; once it is closed nobody can act on one,
  // and a signal that can never clear becomes furniture — so only the OPEN session counts.
  const slipRows: SlipRow[] =
    activeRaw && scopeRaw && activeRaw.id === scopeRaw.id
      ? liveOrders
          .filter((o) => o.slip_mismatch && o.slip_total_agorot !== null)
          .map((o) => ({
            orderId: o.id,
            ticketNo: o.ticket_no,
            customerName: o.customer_name,
            totalAgorot: o.total_agorot,
            slipAgorot: o.slip_total_agorot ?? 0,
            diffAgorot: (o.slip_total_agorot ?? 0) - o.total_agorot,
          }))
          .sort((a, b) => a.ticketNo - b.ticketNo)
      : []

  const unconfirmed: StaffRef[] = enabled
    ? i.people.data.filter((p) => p.handle_set_at === null).map((p) => ({ id: p.id, handle: p.handle }))
    : []

  // ---- Sales by hour / by point / who entered orders -----------------------------------------
  const hours = new Map<number, HourBucket>()
  for (const o of liveOrders) {
    const t = ms(o.created_at)
    if (t === null) continue
    const start = floorLocal(t, tz, 60)
    const b = hours.get(start)
    if (b) {
      b.orders++
      b.agorot += o.total_agorot
    } else {
      hours.set(start, { startsAt: iso(start), label: localHHMM(start, tz), orders: 1, agorot: o.total_agorot })
    }
  }
  const salesByHour = Array.from(hours.values()).sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))

  const pointSales = new Map<string, PointSales>()
  for (const l of scopeItems) {
    if (l.status === 'voided') continue
    const p = pointSales.get(l.point_id) ?? { pointId: l.point_id, name: nameOfPoint(l.point_id, l.point_name), colour: colourOf(l.point_id), qty: 0, agorot: 0 }
    p.qty += l.qty
    p.agorot += l.qty * l.unit_agorot
    pointSales.set(l.point_id, p)
  }
  const salesByPoint = Array.from(pointSales.values()).sort((a, b) => b.agorot - a.agorot || a.name.localeCompare(b.name))

  const byStaff = new Map<string, StaffOrders>()
  for (const o of liveOrders) {
    const r = byStaff.get(o.created_by) ?? { staff: refOr(o.created_by), orders: 0, agorot: 0 }
    r.orders++
    r.agorot += o.total_agorot
    byStaff.set(o.created_by, r)
  }
  const ordersByStaff = Array.from(byStaff.values()).sort((a, b) => b.orders - a.orders || a.staff.handle.localeCompare(b.staff.handle))

  // ---- Who is on which point NOW ------------------------------------------------------------
  // Latest event per (person, point): present when the latest is a check-in. Looked at
  // across the last 16 h so a stale check-in from yesterday is not "on the point".
  const latest = new Map<string, PosCheckin>()
  for (const c of [...i.checkins.data].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.localeCompare(b.id)))) {
    latest.set(`${c.staff_id}|${c.point_id}`, c)
  }
  const presentByPoint = new Map<string, (StaffRef & { since: string })[]>()
  const presentPeople = new Set<string>()
  latest.forEach((c) => {
    if (c.event !== 'check_in') return
    const who = refOr(c.staff_id)
    const list = presentByPoint.get(c.point_id) ?? []
    list.push({ ...who, since: c.at })
    presentByPoint.set(c.point_id, list)
    presentPeople.add(c.staff_id)
  })
  const presence: PresenceGroup[] = Array.from(presentByPoint.entries())
    .map(([pointId, staff]) => ({
      pointId,
      pointName: pointById.get(pointId)?.name ?? '—',
      pointColour: colourOf(pointId),
      staff: staff.sort((a, b) => a.handle.localeCompare(b.handle)),
    }))
    .sort((a, b) => a.pointName.localeCompare(b.pointName))

  // ---- Per-point cards ---------------------------------------------------------------------------
  const timedByPoint = new Map<string, TimedLine[]>()
  for (const t of i.timed.data) {
    const g = timedByPoint.get(t.point_id) ?? []
    if (g.length < CARD_TIMING_SAMPLE) g.push(t) // already newest-ready first
    timedByPoint.set(t.point_id, g)
  }
  const cards: PointCard[] = activePoints.map((p) => {
    const mine = live.filter((l) => l.point_id === p.id)
    const mineInFlight = mine.filter((l) => (IN_FLIGHT_ITEM_STATUSES as readonly string[]).includes(l.status))
    const timings = (timedByPoint.get(p.id) ?? []).map((t) => lineTimings(t))
    const toReady = (timedByPoint.get(p.id) ?? [])
      .map((t) => {
        const a = ms(t.sent_at)
        const b = ms(t.ready_at)
        return a !== null && b !== null ? Math.max(0, (b - a) / 1000) : null
      })
      .filter((x): x is number => x !== null)
    const queue = mineInFlight.length
    return {
      id: p.id,
      name: p.name,
      icon: p.icon,
      colour: p.colour,
      handsOver: p.hands_over,
      prepMinutes: p.prep_minutes,
      waiting: mine.filter((l) => l.status === 'sent').length,
      preparing: mine.filter((l) => l.status === 'preparing').length,
      ready: mine.filter((l) => l.status === 'ready').length,
      queue,
      oldestWaitSeconds: queue > 0 ? Math.floor(Math.max(...mineInFlight.map(ageS))) : null,
      stuck: stuckLines.filter((l) => l.point_id === p.id).length,
      medianPrepSeconds: median(timings.map((t) => t.prep).filter((x): x is number => x !== null)),
      medianToReadySeconds: median(toReady),
      // The same test as the "point backlog" signal, so card and signal cannot disagree.
      bottleneck: queue >= DASHBOARD.backlogWarn,
      checkedIn: (presentByPoint.get(p.id) ?? []).map(({ id, handle }) => ({ id, handle })),
    }
  })

  // ---- Who is working on what -----------------------------------------------------------------------
  const byClaimer = new Map<string, LiveLine[]>()
  for (const l of inFlight) {
    if (!l.claimed_by) continue
    const g = byClaimer.get(l.claimed_by)
    if (g) g.push(l)
    else byClaimer.set(l.claimed_by, [l])
  }
  const processing: ProcessingRow[] = Array.from(byClaimer.entries())
    .map(([staffId, lines]): ProcessingRow => {
      const since = (l: LiveLine) => Math.max(0, Math.floor((now - (ms(l.claimed_at) ?? ms(l.sent_at) ?? now)) / 1000))
      const sorted = [...lines].sort((a, b) => since(b) - since(a) || a.id.localeCompare(b.id))
      return {
        staff: refOr(staffId),
        lines: lines.length,
        qty: lines.reduce((s, l) => s + l.qty, 0),
        oldestSeconds: sorted[0] ? since(sorted[0]) : 0,
        current: sorted.slice(0, 6).map((l): ProcessingLine => ({
          itemId: l.id,
          orderId: l.order_id,
          ticketNo: l.pos_orders?.ticket_no ?? 0,
          customerName: l.pos_orders?.customer_name ?? '—',
          name: l.name as Localized,
          qty: l.qty,
          status: l.status,
          pointId: l.point_id,
          pointName: nameOfPoint(l.point_id, l.point_name),
          sinceSeconds: since(l),
        })),
      }
    })
    .sort((a, b) => b.oldestSeconds - a.oldestSeconds || a.staff.handle.localeCompare(b.staff.handle))

  // ---- Drill + stats ---------------------------------------------------------------------------------
  const drill: DashboardDrill = {
    openTickets: knownOf(cap(openTicketRows, DRILL_LIMIT), i.scopeOrders, i.scopeItems),
    stuck: knownOf(cap(stuckRows, DRILL_LIMIT), i.live, i.points),
    uncollected: knownOf(cap(uncollectedRows, DRILL_LIMIT), i.live),
    unrouted: knownOf(cap(unroutedList, DRILL_LIMIT), ...menuReads),
    soldOut: knownOf(cap(soldOutRows, DRILL_LIMIT), ...menuReads),
    slipMismatches: knownOf(cap(slipRows, DRILL_LIMIT), i.scopeOrders, i.sessions),
    unconfirmedHandles: knownOf(cap(unconfirmed, DRILL_LIMIT), i.people, i.settings),
  }

  const ordersRead = [i.scopeOrders, i.sessions]
  const stats: DashboardStats = {
    openTickets: statOf(drill.openTickets.value.total, ...ordersRead, i.scopeItems),
    salesAgorot: statOf(sales, ...ordersRead),
    stuckItems: statOf(drill.stuck.value.total, i.live, i.points),
    staffOnPoints: statOf(presentPeople.size, i.checkins),
    ordersTotal: statOf(orders.length, ...ordersRead),
    ordersOpen: statOf(orders.filter((o) => o.status === 'open').length, ...ordersRead),
    ordersCompleted: statOf(orders.filter((o) => o.status === 'completed').length, ...ordersRead),
    ordersVoided: statOf(orders.filter((o) => o.status === 'void').length, ...ordersRead),
    averageTicketAgorot: statOf(liveOrders.length > 0 ? Math.round(sales / liveOrders.length) : 0, ...ordersRead),
    salesByHour: knownOf(salesByHour, ...ordersRead),
    salesByPoint: knownOf(salesByPoint, i.scopeItems, i.sessions),
    itemsWaiting: statOf(waiting.length, i.live),
    itemsPreparing: statOf(preparing.length, i.live),
    itemsReady: statOf(ready.length, i.live),
    itemsOverdue: statOf(overdue.length, i.live),
    itemsCritical: statOf(critical.length, i.live),
    itemsUncollected: statOf(uncollectedLines.length, i.live),
    ordersByStaff: knownOf(ordersByStaff, ...ordersRead),
  }

  // ---- Signals --------------------------------------------------------------------------------------------
  const signals: PosSignal[] = []
  const add = (s: Omit<PosSignal, 'level'>) => signals.push({ ...s, level: levelOf(s.rank) })
  const plural = (n: number, one: Bilingual, many: (n: number) => Bilingual): Bilingual => (n === 1 ? one : many(n))

  // 100 — training mode. Loud on purpose: practice orders are invisible to the statistics,
  // and forgetting to switch it off before real service is the expensive mistake.
  if (i.sessions.ok && activeRaw?.kind === 'training') {
    add({
      id: 'training-mode', rank: 100, icon: 'graduation-cap', count: 1, href: '/owner/pos',
      title: both('מצב אימון פעיל', 'Training mode is on'),
      detail: both(
        'ההזמנות כרגע לא נספרות בסטטיסטיקה. כשמסיימים לתרגל, סגרו את האימון ומחקו את נתוני האימון.',
        'Orders are not counted in the statistics. When you finish practising, close the training and wipe its data.',
      ),
    })
  }

  // 90 — enabled but nobody opened it: the register cannot take an order.
  if (i.settings.ok && i.sessions.ok && enabled && !activeRaw) {
    add({
      id: 'event-not-open', rank: 90, icon: 'power', count: 1, href: '/owner/pos',
      title: both('האירוע סגור — אי אפשר לקבל הזמנות', 'The event is closed — no orders can be taken'),
      detail: both('פתחו את האירוע כדי שהקופה תתחיל לקבל הזמנות.', 'Open the event so the register can take orders.'),
    })
  }

  // 88 — an item customers can buy that no point makes.
  if (drill.unrouted.known && enabled && drill.unrouted.value.total > 0) {
    const names = unroutedList.map((u) => nameOf(u.name))
    const enNames = unroutedList.map((u) => u.name.en || nameOf(u.name))
    const n = drill.unrouted.value.total
    add({
      id: 'unrouted-items', rank: 88, icon: 'route', count: n, href: '/owner/pos/setup', drill: 'unrouted',
      title: plural(n, both('מוצר אחד לא מוגדר באף עמדה', 'One item is not made by any point'), (c) =>
        both(`${c} מוצרים לא מוגדרים באף עמדה`, `${c} items are not made by any point`)),
      detail: both(
        `${nameList(names, 'he')} — לא ניתן להזמין אותם בקופה.`,
        `${nameList(enNames, 'en')} — they cannot be ordered at the register.`,
      ),
    })
  }

  // 70 — stuck items.
  if (drill.stuck.known && drill.stuck.value.total > 0) {
    const n = drill.stuck.value.total
    const oldest = stuckRows[0]
    add({
      id: 'stuck-items', rank: 70, icon: 'timer', count: n, href: '/owner/pos', drill: 'stuck',
      title: plural(n, both('פריט אחד תקוע', 'One item is stuck'), (c) => both(`${c} פריטים תקועים`, `${c} items are stuck`)),
      detail: oldest
        ? both(
            `הוותיק ביותר מחכה ${minutesOf(oldest.waitingSeconds)} דק׳ — ${oldest.pointName}`,
            `The oldest has been waiting ${minutesOf(oldest.waitingSeconds)} min — ${oldest.pointName}`,
          )
        : undefined,
    })
  }

  // 68 — a point with a long queue (the same test as the card's bottleneck flag).
  const backlogged = cards.filter((c) => c.bottleneck)
  if (i.live.ok && i.points.ok && backlogged.length > 0) {
    const n = backlogged.length
    const top = [...backlogged].sort((a, b) => b.queue - a.queue)[0]
    add({
      id: 'point-backlog', rank: 68, icon: 'layers', count: n, href: '/owner/pos',
      title: plural(n, both(`עומס בעמדה ${top?.name ?? ''}`, `${top?.name ?? 'A point'} has a long queue`), (c) =>
        both(`עומס ב־${c} עמדות`, `${c} points have a long queue`)),
      detail: both(
        backlogged.map((c) => `${c.name}: ${c.queue} פריטים בתור`).join(' · '),
        backlogged.map((c) => `${c.name}: ${c.queue} in the queue`).join(' · '),
      ),
    })
  }

  // 60 — sold out at a point.
  if (drill.soldOut.known && enabled && drill.soldOut.value.total > 0) {
    const n = drill.soldOut.value.total
    add({
      id: 'sold-out-at-point', rank: 60, icon: 'package-x', count: n, href: '/owner/tablet', drill: 'soldOut',
      title: plural(n, both('מוצר אחד אזל', 'One item is sold out'), (c) => both(`${c} מוצרים אזלו`, `${c} items are sold out`)),
      detail: both(
        nameList(soldOutRows.map((r) => `${nameOf(r.name)} (${r.pointName})`), 'he'),
        nameList(soldOutRows.map((r) => `${r.name.en || nameOf(r.name)} (${r.pointName})`), 'en'),
      ),
    })
  }

  // 55 — ready, and nobody came for it. A reminder, not an alarm: it lists names so someone can call.
  if (drill.uncollected.known && drill.uncollected.value.total > 0) {
    const n = drill.uncollected.value.total
    const label = (r: UncollectedRow) => `${r.customerName} #${r.ticketNo}`
    add({
      id: 'uncollected', rank: 55, icon: 'bell-ring', count: n, href: '/owner/pos', drill: 'uncollected',
      title: plural(n, both('הזמנה אחת מוכנה וממתינה לאיסוף', 'One order is ready and waiting to be collected'), (c) =>
        both(`${c} הזמנות מוכנות וממתינות לאיסוף`, `${c} orders are ready and waiting to be collected`)),
      detail: both(nameList(uncollectedRows.map(label), 'he'), nameList(uncollectedRows.map(label), 'en')),
    })
  }

  // 50 — an open event nobody closed. Ayeka left one open for a week and its gate silently never mattered.
  if (i.sessions.ok && activeRaw) {
    const hours = (now - (ms(activeRaw.started_at) ?? now)) / 3_600_000
    if (hours >= DASHBOARD.sessionOpenTooLongHours) {
      const h = Math.floor(hours)
      add({
        id: 'session-too-long', rank: 50, icon: 'hourglass', count: 1, href: '/owner/pos',
        title: both(`האירוע פתוח כבר ${h} שעות`, `The event has been open for ${h} hours`),
        detail: both('אולי שכחתם לסגור אותו?', 'Did you forget to close it?'),
      })
    }
  }

  // 45 — a typed total that differs from the card slip.
  if (drill.slipMismatches.known && drill.slipMismatches.value.total > 0) {
    const n = drill.slipMismatches.value.total
    add({
      id: 'slip-mismatch', rank: 45, icon: 'receipt', count: n, href: '/owner/pos/orders', drill: 'slipMismatches',
      title: plural(n, both('הסכום שונה מהקבלה בהזמנה אחת', 'One order differs from the slip'), (c) =>
        both(`הסכום שונה מהקבלה ב־${c} הזמנות`, `${c} orders differ from the slip`)),
      detail: both('כדאי לבדוק שההזמנה הוקלדה נכון.', 'Worth checking the order was typed correctly.'),
    })
  }

  // 25 — people who have not confirmed the nickname everybody else will see.
  if (drill.unconfirmedHandles.known && drill.unconfirmedHandles.value.total > 0) {
    const n = drill.unconfirmedHandles.value.total
    add({
      id: 'handle-unconfirmed', rank: 25, icon: 'at-sign', count: n, href: '/owner/staff', drill: 'unconfirmedHandles',
      title: plural(n, both('לאדם אחד עדיין אין כינוי מאושר', 'One person has not confirmed a nickname'), (c) =>
        both(`ל־${c} אנשים עדיין אין כינוי מאושר`, `${c} people have not confirmed a nickname`)),
      detail: both(nameList(unconfirmed.map((u) => u.handle), 'he'), nameList(unconfirmed.map((u) => u.handle), 'en')),
    })
  }

  signals.sort((a, b) => b.rank - a.rank)

  const lite = (s: PosSession | null): SessionLite | null => (s ? liteSession(s, dir) : null)
  return {
    enabled: knownOf(enabled, i.settings),
    active: knownOf(lite(activeRaw), i.sessions),
    scope: knownOf(lite(scopeRaw), i.sessions),
    stats,
    signals,
    drill,
    points: knownOf(cards, i.points, i.live, i.timed, i.checkins),
    presence: knownOf(presence, i.checkins, i.points),
    processing: knownOf(processing, i.live),
  }
}

// ======================================================================================
// The read
// ======================================================================================

const SCOPE_ORDER_COLUMNS =
  'id, ticket_no, customer_name, status, total_agorot, slip_total_agorot, slip_mismatch, created_by, created_at'
const LIVE_COLUMNS = 'id, order_id, point_id, point_name, name, qty, status, sent_at, claimed_by, claimed_at, ready_at'

/** GET /api/owner/pos/dashboard — also what the hub refetches on a realtime signal. */
export async function readDashboard(service: Service, branch: { id: string; slug: string }): Promise<DashboardPayload> {
  const now = Date.now()
  const horizon = iso(now - DASHBOARD.stuckMaxAgeHours * 3_600_000)
  const presenceSince = iso(now - PRESENCE_LOOKBACK_HOURS * 3_600_000)

  // Wave 1: everything that does not depend on which session is in scope — all in flight at once.
  const infoP = readBranch(service, branch)
  const dirP = readDirectory(service)
  const settingsP = guarded<SettingsRow | null>(null, () => readSettingsRow(service, branch.id))
  const sessionsP = guarded<PosSession[]>([], () => readSessions(service, branch.id, 10))
  const pointsP = guarded<PosPoint[]>([], () => readPoints(service, branch.id, { includeInactive: true }))
  const routesP = guarded<PosRoute[]>([], () => readRoutes(service, branch.id))
  const menuP = guarded<PublishedMenu | null>(null, () => readPublishedMenu(service, branch.id))
  const peopleP = guarded<StaffPerson[]>([], () => readPeople(service, branch.id))
  const checkinsP = guarded<PosCheckin[]>([], () => readCheckins(service, branch.id, presenceSince))
  const liveP = guarded<LiveLine[]>([], () =>
    fetchAll<LiveLine>((from, to) =>
      service
        .from('pos_order_items')
        .select(`${LIVE_COLUMNS}, pos_orders!inner(ticket_no, customer_name, customer_phone)`)
        .eq('branch_id', branch.id)
        .in('status', [...LIVE_ITEM_STATUSES])
        .gte('sent_at', horizon)
        .order('sent_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    )
  )
  const timedP = guarded<TimedLine[]>([], async () => {
    const res = await service
      .from('pos_order_items')
      .select('point_id, status, sent_at, claimed_at, ready_at, delivered_at')
      .eq('branch_id', branch.id)
      .not('ready_at', 'is', null)
      .in('status', ['ready', 'delivered'])
      .order('ready_at', { ascending: false })
      .limit(300)
    return unwrap<TimedLine[] | null>(res) ?? []
  })
  const feedP = guarded<PosEvent[]>([], async () => {
    const res = await service
      .from('pos_events')
      .select(EVENT_COLUMNS)
      .eq('branch_id', branch.id)
      .order('id', { ascending: false })
      .limit(DASHBOARD.feedLimit)
    return unwrap<PosEvent[] | null>(res) ?? []
  })

  // Wave 2: the session in scope needs the sessions answer first — everything above keeps running meanwhile.
  const sessions = await sessionsP
  const scope = sessions.data.find((s) => s.status === 'active') ?? sessions.data.find((s) => s.kind === 'live') ?? null
  const scopeOrdersP = scope
    ? guarded<ScopeOrder[]>([], () =>
        fetchAll<ScopeOrder>((from, to) =>
          service
            .from('pos_orders')
            .select(SCOPE_ORDER_COLUMNS)
            .eq('session_id', scope.id)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
        )
      )
    : Promise.resolve<Read<ScopeOrder[]>>({ ok: true, data: [] })
  const scopeItemsP = scope
    ? guarded<ScopeItem[]>([], () =>
        fetchAll<ScopeItem>((from, to) =>
          service
            .from('pos_order_items')
            .select('id, order_id, point_id, point_name, qty, unit_agorot, status, pos_orders!inner(session_id)')
            .eq('pos_orders.session_id', scope.id)
            .order('id', { ascending: true })
            .range(from, to)
        )
      )
    : Promise.resolve<Read<ScopeItem[]>>({ ok: true, data: [] })

  const [info, dir, settings, points, routes, menu, people, checkins, live, timed, feed, scopeOrders, scopeItems] = await Promise.all([
    infoP, dirP, settingsP, pointsP, routesP, menuP, peopleP, checkinsP, liveP, timedP, feedP, scopeOrdersP, scopeItemsP,
  ])

  const computed = computeDashboard({
    now, settings, sessions, points, routes, menu, live, timed, scopeOrders, scopeItems, checkins, people,
    timezone: info.timezone, dir: directoryMap(dir.data),
  })

  return {
    serverTime: new Date(now).toISOString(),
    branch: info as BranchInfo,
    ...computed,
    feed: { known: feed.ok, value: feed.data },
    directory: dir.data,
  }
}

