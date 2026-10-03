// The OWNER / MANAGER API contract: request schemas (zod, every one `.strict()` —
// the server narrows each body and query field by field, never spreading input
// into a write) and the response types the owner screens are typed against.
// One file, imported by the /api/owner/pos/* route handlers AND by the owner UI,
// so the two sides cannot drift. Pure: zod + types only — no React, no DOM, no
// server APIs — so a client component may import the schemas too.
//
// CONVENTIONS
//   * Every route is addressed by `branch` (the branch's slug OR its id), in the
//     query string for GET / DELETE and in the body for POST / PATCH. The server
//     passes it to requirePosManager(), which decides whether this person may
//     manage that branch — the browser is never believed about branch access.
//   * Row-shaped things keep the database's snake_case (PosOrder, PosItem,
//     PosEvent …) so a component can be shared with the staff screens; the
//     envelope around them is camelCase.
//   * A number that can fail to load is a `Known<number>` (`PosStat`): `known:
//     false` means the read failed and the screen must show "—", never a
//     confident 0 (the rule from src/lib/owner/dashboard-stats.ts).
//   * REFUSALS ARE NORMAL OUTCOMES, not errors: "this item is already sold at
//     another point", "the event still has items in preparation" … come back as
//     HTTP 409 with `{ ok:false, reason, message, … }` so a wizard can react
//     ("move it here?"). Real errors use the shared envelope
//     `{ error: { code, message } }` from lib/http/errors.ts. Both carry a plain
//     Hebrew `message` (English in `message.en` for refusals) — no codes, ids or
//     technical words ever reach a person.
//   * GET query strings are strict: an unknown parameter (a cache-buster, say) is
//     a 400. Dates are `YYYY-MM-DD`, read in the BRANCH's time zone.
//   * Responses that can contain the Ready-board link or a customer's phone are
//     sent `Cache-Control: no-store`. The phone appears ONLY in manager-gated
//     responses (order history/detail, the uncollected drill-down) — never in an
//     event payload, a log line, or anything public.

import { z } from 'zod'
import type { Localized } from '@/lib/menu/types'
import type {
  ItemStatus, PosEvent, PosEventType, PosItem, PosOrder, PosSession, SessionKind, StaffDirEntry,
} from './types'
import { POS_EVENT_TYPES } from './types'
import { LIMITS, POINT_ICONS } from './vocab'

// ---- Shared bits ----------------------------------------------------------------------

export type Bilingual = { he: string; en: string }

/** A number (or value) that can fail to load. `known:false` => render "—". */
export type Known<T> = { known: boolean; value: T }
export type PosStat = Known<number>

/** A list cut to a screen's worth, with the true total so "12 items" never lies
 *  about a list that shows 8. `total` is counted BEFORE the cut, from the same
 *  array the number above the panel comes from — a count and its drill-down can
 *  never disagree. */
export type Capped<T> = { total: number; rows: T[] }

export type StaffRef = { id: string; handle: string }

export type BranchInfo = {
  id: string
  slug: string
  name: Localized
  kind: 'permanent' | 'event'
  /** IANA zone — hours, peak buckets and date filters are read in it */
  timezone: string
}

const uuid = z.string().uuid()
const branchRef = z.string().trim().regex(/^[A-Za-z0-9-]{1,80}$/)
const refString = z.string().min(1).max(80)
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const cursor = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/)
const flag = z.enum(['0', '1'])

/** `?branch=` — every GET that needs nothing else. */
export const branchQuery = z.object({ branch: branchRef }).strict()
export type BranchQuery = z.infer<typeof branchQuery>

// ---- Sessions ("the event is open") ----------------------------------------------------

export type SessionLite = PosSession & {
  started_by_handle: string | null
  ended_by_handle: string | null
}
/** `totals_known:false` => the order totals could not be read; show "—" for orders and sales. */
export type SessionRow = SessionLite & { orders: number; sales_agorot: number; totals_known: boolean }

export type SessionsPayload = {
  /** false => the settings row is missing or off: the event cannot be opened yet */
  enabled: boolean
  /** the one active session (any kind), or null */
  current: SessionLite | null
  /** the latest 10 sessions, newest first — includes `current` */
  recent: SessionRow[]
  /** practice data waiting to be wiped */
  training: { sessions: number; orders: number; known: boolean }
  serverTime: string
}

export const SESSION_ACTIONS = ['open', 'open_training', 'close', 'close_void_uncollected', 'wipe_training'] as const
export type SessionAction = (typeof SESSION_ACTIONS)[number]

export const sessionBody = z.object({ branch: branchRef, action: z.enum(SESSION_ACTIONS) }).strict()
export type SessionBody = z.infer<typeof sessionBody>

export type SessionActionOk = {
  ok: true
  action: SessionAction
  /** open / open_training */
  sessionId?: string
  /** close_void_uncollected: how many ready-but-never-collected items were cancelled */
  voidedUncollected?: number
  /** wipe_training: how many practice orders were deleted */
  wipedOrders?: number
}
export type SessionRefusalReason = 'already_open' | 'not_enabled' | 'no_session' | 'in_flight' | 'uncollected'
export type SessionActionRefused = {
  ok: false
  reason: SessionRefusalReason
  message: Bilingual
  /** close: items still waiting / being prepared (blocks closing) */
  inFlight?: number
  /** close: items ready but not collected (the UI offers "cancel them and close") */
  uncollected?: number
}

// ---- Selling points --------------------------------------------------------------------

/** What the wizard edits. `categoryIds` are claimed whole; `itemUids` are claimed
 *  one by one; `excludedUids` are items inside the claimed categories this point
 *  does NOT make; `staffIds` are "who usually works here" (a landing choice, not
 *  a permission). */
export const pointConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(LIMITS.pointNameMax),
    icon: z.enum(POINT_ICONS),
    colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    handsOver: z.boolean().default(true),
    prepMinutes: z.number().int().min(LIMITS.prepMinutesMin).max(LIMITS.prepMinutesMax),
    categoryIds: z.array(refString).max(200).default([]),
    itemUids: z.array(refString).max(400).default([]),
    excludedUids: z.array(refString).max(400).default([]),
    staffIds: z.array(uuid).max(200).default([]),
  })
  .strict()
export type PointConfig = z.infer<typeof pointConfigSchema>
export type PointConfigInput = z.input<typeof pointConfigSchema>

export const pointCreateBody = z
  .object({ branch: branchRef, config: pointConfigSchema, move: z.boolean().optional() })
  .strict()
export type PointCreateBody = z.infer<typeof pointCreateBody>

export const pointUpdateBody = z
  .object({ branch: branchRef, pointId: uuid, config: pointConfigSchema, move: z.boolean().optional() })
  .strict()
export type PointUpdateBody = z.infer<typeof pointUpdateBody>

/** DELETE /api/owner/pos/points?branch=&pointId= */
export const pointDeleteQuery = z.object({ branch: branchRef, pointId: uuid }).strict()
export type PointDeleteQuery = z.infer<typeof pointDeleteQuery>

/** One thing another point already makes. The wizard asks "move it here?" and
 *  re-sends the same body with `move: true`. `label` is the menu name when known. */
export type RouteConflict = {
  kind: 'category' | 'item'
  ref: string
  pointId: string
  pointName: string
  label: Localized | null
}

export type PointSaveOk = { ok: true; pointId: string }
export type PointSaveRefused =
  | { ok: false; reason: 'conflicts'; message: Bilingual; conflicts: RouteConflict[] }
  | { ok: false; reason: 'name_taken'; message: Bilingual }
export type PointSaveResult = PointSaveOk | PointSaveRefused

export type PointDeactivateOk = { ok: true }
export type PointDeactivateRefused = { ok: false; reason: 'live_items'; message: Bilingual; liveItems: number }
export type PointDeactivateResult = PointDeactivateOk | PointDeactivateRefused

/** A point as the checklist card and the wizard's edit mode show it. */
export type PointSummary = {
  id: string
  name: string
  icon: string
  colour: string
  handsOver: boolean
  prepMinutes: number
  sortOrder: number
  /** everything the wizard needs to reopen on the same data (send back as `config`) */
  config: PointConfig
  /** how many menu items this point makes, however they got there */
  itemCount: number
  /** categories claimed whole, for the one-line summary */
  categories: { id: string; title: Localized; itemCount: number }[]
  /** items claimed one by one */
  extraItems: { uid: string; name: Localized }[]
  /** lines waiting / being prepared / ready here right now — deactivating is refused while > 0 */
  liveItems: number
}

export type PointsPayload = { points: PointSummary[]; serverTime: string }

// ---- Setup / readiness ---------------------------------------------------------------------

export type ReadinessStatus = 'done' | 'attention' | 'blocked'
export type ReadinessId = 'event' | 'menu' | 'points' | 'routing' | 'people' | 'board' | 'session'

type RowBase = {
  status: ReadinessStatus
  /** false => the read behind this row failed; show "—" and a retry, never a green tick */
  known: boolean
}

export type UnroutedItem = { uid: string; name: Localized; categoryId: string; categoryTitle: Localized }

export type PersonRow = {
  id: string
  handle: string
  /** false => the system picked the handle; the person has not confirmed it yet */
  handleConfirmed: boolean
  colour: string | null
  badge: string | null
  /** the points this person usually works at ("lands" there) */
  pointIds: string[]
}

export type EventRow = RowBase & {
  id: 'event'
  /** POS switched on for this branch */
  enabled: boolean
}
export type MenuRow = RowBase & {
  id: 'menu'
  published: boolean
  publishedAt: string | null
  itemCount: number
  categoryCount: number
  /** the draft differs from what is published (edited, not published yet) */
  unpublishedChanges: boolean
  /** published items that have no id and so cannot be ordered — republish the menu */
  itemsWithoutId: number
}
export type PointsRow = RowBase & { id: 'points'; points: PointSummary[] }
export type RoutingRow = RowBase & {
  id: 'routing'
  /** items customers could ask for that no point makes — THE gate for opening */
  unrouted: UnroutedItem[]
  /** items the owner deliberately does not sell here ('c:<category>' / 'i:<item>') */
  unsold: string[]
}
export type PeopleRow = RowBase & {
  id: 'people'
  people: PersonRow[]
  /** how many people can work here but have not confirmed a nickname */
  unconfirmed: number
}
export type BoardRow = RowBase & {
  id: 'board'
  hasToken: boolean
  /** the secret link's token — present in manager responses only (setup GET, settings GET/PATCH) */
  token: string | null
  /** `/board/<token>` — add the site origin to copy or open it */
  path: string | null
}
export type SessionRowSetup = RowBase & {
  id: 'session'
  active: SessionLite | null
  /** why the button is disabled (plain words), when status is 'blocked' */
  blockedBecause: ReadinessId | null
}
export type ReadinessRow = EventRow | MenuRow | PointsRow | RoutingRow | PeopleRow | BoardRow | SessionRowSetup

export type CatalogueItem = {
  uid: string
  name: Localized
  /** where it goes right now */
  route: 'point' | 'unrouted' | 'unsold' | 'excluded'
  pointId: string | null
  /** 'item' = an item-level route; 'category' = inherited from its category */
  via: 'item' | 'category' | null
}
export type CatalogueCategory = {
  id: string
  title: Localized
  icon: string | null
  /** the point that claims the whole category, or null */
  ownerPointId: string | null
  /** the owner marked the whole category as not sold at this event */
  unsold: boolean
  items: CatalogueItem[]
}

export type SetupState = {
  branch: BranchInfo
  /** in checklist order */
  rows: ReadinessRow[]
  /** event on, menu published, at least one point, everything routed. The UI gates "open the event" on this. */
  canOpen: boolean
  /** the rows (by id) standing in the way, in order */
  blockers: ReadinessId[]
  /** the menu as the wizard browses it: every category with where each item goes */
  catalogue: CatalogueCategory[]
  directory: StaffDirEntry[]
  serverTime: string
}

// ---- Settings (on/off, Ready-board link, unsold) -----------------------------------------------------

/** `rotateBoardToken: true` makes a new secret link and kills the old one. */
export const settingsPatchBody = z
  .object({
    branch: branchRef,
    enabled: z.boolean().optional(),
    rotateBoardToken: z.literal(true).optional(),
    /** replaces the whole list: 'c:<categoryId>' / 'i:<itemUid>' the owner does not sell here */
    unsold: z.array(z.string().regex(/^[ci]:.{1,78}$/)).max(600).optional(),
  })
  .strict()
  .refine((b) => b.enabled !== undefined || b.rotateBoardToken !== undefined || b.unsold !== undefined, {
    message: 'nothing to change',
  })
export type SettingsPatchBody = z.infer<typeof settingsPatchBody>

export type SettingsPayload = {
  enabled: boolean
  /** SECRET — manager responses only, never logged, never in an event payload */
  boardToken: string | null
  boardPath: string | null
  unsold: string[]
  updatedAt: string | null
}
export type SettingsRefused = { ok: false; reason: 'session_active'; message: Bilingual }

// ---- Dashboard ---------------------------------------------------------------------------

export type SignalId =
  | 'training-mode' | 'event-not-open' | 'unrouted-items' | 'stuck-items' | 'point-backlog'
  | 'sold-out-at-point' | 'uncollected' | 'session-too-long' | 'slip-mismatch' | 'handle-unconfirmed'
export type SignalLevel = 'critical' | 'warning' | 'info'
export type DrillKey = keyof DashboardDrill

/** Rendered only when TRUE — the stack has no empty state. `rank` is fixed
 *  server-side (>= 80 critical, 40–79 warning, < 40 info) and never re-sorted by
 *  the component, so the stack cannot jitter between two identical loads. */
export type PosSignal = {
  id: SignalId
  rank: number
  level: SignalLevel
  /** lucide icon name */
  icon: string
  title: Bilingual
  detail?: Bilingual
  href?: string
  /** the count the title states — equals `drill[drill].total` when there is a drill list */
  count: number
  /** which list under `drill` expands beneath this row */
  drill?: DrillKey
}

export type HourBucket = { startsAt: string; label: string; orders: number; agorot: number }
export type PointSales = { pointId: string; name: string; colour: string; qty: number; agorot: number }
export type StaffOrders = { staff: StaffRef; orders: number; agorot: number }

export type DashboardStats = {
  // the four headline numbers (StatStrip)
  openTickets: PosStat
  salesAgorot: PosStat
  stuckItems: PosStat
  staffOnPoints: PosStat
  // orders in the scope session
  ordersTotal: PosStat
  ordersOpen: PosStat
  ordersCompleted: PosStat
  ordersVoided: PosStat
  averageTicketAgorot: PosStat
  salesByHour: Known<HourBucket[]>
  salesByPoint: Known<PointSales[]>
  // items right now, branch-wide
  itemsWaiting: PosStat
  itemsPreparing: PosStat
  itemsReady: PosStat
  /** waiting longer than AGING.lateS (flashing or worse) */
  itemsOverdue: PosStat
  /** waiting longer than AGING.criticalS (the red strip) — a subset of overdue */
  itemsCritical: PosStat
  /** ready for longer than DASHBOARD.uncollectedMinutes */
  itemsUncollected: PosStat
  /** who entered orders in the scope session */
  ordersByStaff: Known<StaffOrders[]>
}

export type OpenTicketRow = {
  orderId: string
  ticketNo: number
  customerName: string
  createdBy: StaffRef
  totalAgorot: number
  ageSeconds: number
  lines: { waiting: number; preparing: number; ready: number; delivered: number }
}
export type StuckRow = {
  itemId: string
  orderId: string
  ticketNo: number
  customerName: string
  pointId: string
  pointName: string
  pointColour: string
  name: Localized
  qty: number
  /** only lines that are still unfinished: waiting or being prepared */
  status: Extract<ItemStatus, 'sent' | 'preparing'>
  waitingSeconds: number
  thresholdMinutes: number
  claimedBy: StaffRef | null
}
export type UncollectedRow = {
  orderId: string
  ticketNo: number
  customerName: string
  /** PERSONAL DATA — shown so someone can call; manager-only */
  customerPhone: string | null
  points: { id: string; name: string; colour: string }[]
  lines: number
  readySeconds: number
}
export type SoldOutRow = { itemUid: string; name: Localized; pointId: string; pointName: string }
export type SlipRow = {
  orderId: string
  ticketNo: number
  customerName: string
  totalAgorot: number
  slipAgorot: number
  diffAgorot: number
}

export type DashboardDrill = {
  openTickets: Known<Capped<OpenTicketRow>>
  stuck: Known<Capped<StuckRow>>
  uncollected: Known<Capped<UncollectedRow>>
  unrouted: Known<Capped<UnroutedItem>>
  soldOut: Known<Capped<SoldOutRow>>
  slipMismatches: Known<Capped<SlipRow>>
  unconfirmedHandles: Known<Capped<StaffRef>>
}

export type PointCard = {
  id: string
  name: string
  icon: string
  colour: string
  handsOver: boolean
  prepMinutes: number
  waiting: number
  preparing: number
  ready: number
  /** waiting + preparing */
  queue: number
  /** the longest any unfinished line here has been waiting, or null when the queue is empty */
  oldestWaitSeconds: number | null
  /** lines unfinished past this point's stuck threshold */
  stuck: number
  /** median of (ready − accepted) over the last 20 finished lines; null when none */
  medianPrepSeconds: number | null
  /** median of (ready − sent) over the last 20 finished lines — what the customer waited */
  medianToReadySeconds: number | null
  /** queue >= DASHBOARD.backlogWarn — the same test as the "point backlog" signal */
  bottleneck: boolean
  checkedIn: StaffRef[]
}

export type PresenceGroup = {
  pointId: string
  pointName: string
  pointColour: string
  staff: (StaffRef & { since: string })[]
}

export type ProcessingLine = {
  itemId: string
  orderId: string
  ticketNo: number
  customerName: string
  name: Localized
  qty: number
  status: ItemStatus
  pointId: string
  pointName: string
  sinceSeconds: number
}
/** Who is working on what: unfinished lines grouped by the person who accepted them. */
export type ProcessingRow = {
  staff: StaffRef
  lines: number
  qty: number
  oldestSeconds: number
  /** at most 6, oldest first */
  current: ProcessingLine[]
}

export type DashboardPayload = {
  serverTime: string
  branch: BranchInfo
  enabled: Known<boolean>
  /** the one open session (any kind), null = none; `known:false` = could not tell */
  active: Known<SessionLite | null>
  /** what the numbers are about: the active session, else the latest live one */
  scope: Known<SessionLite | null>
  stats: DashboardStats
  signals: PosSignal[]
  drill: DashboardDrill
  points: Known<PointCard[]>
  presence: Known<PresenceGroup[]>
  processing: Known<ProcessingRow[]>
  /** newest first, DASHBOARD.feedLimit rows — raw events; the UI words them with describeEvent() */
  feed: Known<PosEvent[]>
  directory: StaffDirEntry[]
}

// ---- Orders history ---------------------------------------------------------------------------

export const ORDER_STATUS_FILTERS = ['open', 'completed', 'void'] as const

export const ordersQuery = z
  .object({
    branch: branchRef,
    /** a session id, or 'all' (default) */
    session: z.union([uuid, z.literal('all')]).optional(),
    status: z.enum(ORDER_STATUS_FILTERS).optional(),
    point: uuid.optional(),
    /** the handle of whoever ENTERED the order (case-insensitive) */
    handle: z.string().trim().min(1).max(40).optional(),
    /** free text: customer name, phone digits, "#42" / a ticket number, receipt number */
    q: z.string().trim().min(1).max(80).optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    /** '1' includes practice (training) orders; picking a training session explicitly includes it anyway */
    training: flag.optional(),
    cursor: cursor.optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict()
export type OrdersQuery = z.infer<typeof ordersQuery>

export type PointChip = {
  point_id: string
  point_name: string
  sent: number
  preparing: number
  ready: number
  delivered: number
  voided: number
}
export type OrderListRow = PosOrder & {
  session_kind: SessionKind
  /** per-point status counts for the chips in the row */
  points: PointChip[]
  item_count: number
}
export type OrdersPage = {
  rows: OrderListRow[]
  /** pass back as `cursor` for the next 50; null = that was the last page */
  nextCursor: string | null
  directory: StaffDirEntry[]
}

export const orderParams = z.object({ id: uuid }).strict()

/** A person who touched an order. `email` is for managers only and appears nowhere else but here and the log. */
export type OrderStaffRef = {
  id: string
  handle: string
  colour: string | null
  email: string | null
  displayName: string | null
}
export type OrderDetail = {
  order: PosOrder
  session: SessionLite | null
  items: PosItem[]
  /** the full timeline, oldest first */
  events: PosEvent[]
  staff: OrderStaffRef[]
  points: { id: string; name: string; colour: string; icon: string }[]
  directory: StaffDirEntry[]
  serverTime: string
}

// ---- Statistics ---------------------------------------------------------------------------

export const statsQuery = z
  .object({
    branch: branchRef,
    /** a session id, or 'all'. Omitted = the active live session, else the latest live one. */
    session: z.union([uuid, z.literal('all')]).optional(),
    /** '1' adds practice sessions when `session` is 'all' / omitted */
    training: flag.optional(),
  })
  .strict()
export type StatsQuery = z.infer<typeof statsQuery>

export type TimingStat = { count: number; medianSeconds: number | null; p90Seconds: number | null }
/** queueWait = accepted − sent; prep = ready − accepted; uncollected = handed over − ready;
 *  total = handed over − sent. Lines a fast point took straight to "ready" (accepted at the
 *  same instant) are left out of queueWait and prep — those two are not measurable for them. */
export type TimingSet = { queueWait: TimingStat; prep: TimingStat; uncollected: TimingStat; total: TimingStat }

export type ItemStat = {
  key: string
  itemUid: string | null
  name: Localized
  qty: number
  agorot: number
  /** share of all sales, 0..1 */
  share: number
  timing: TimingSet
}
export type PointStat = {
  pointId: string
  name: string
  colour: string
  icon: string | null
  orders: number
  lines: number
  qty: number
  agorot: number
  share: number
  backlog: { sent: number; preparing: number; ready: number }
  timing: TimingSet
}
export type ThroughputBucket = { startsAt: string; label: string; pointId: string; items: number }
export type PeakBucket = { startsAt: string; label: string; orders: number; agorot: number }
export type StaffStat = {
  staff: StaffRef
  ordersEntered: number
  agorotEntered: number
  accepted: number
  /** null when the ready events could not be read */
  readied: number | null
  handedOver: number
  voids: number
}
export type VoidStats = {
  voidedLines: number
  totalLines: number
  /** 0..100, one decimal */
  ratePercent: number
  voidedOrders: number
  byStaff: { staff: StaffRef; lines: number }[]
  byItem: { key: string; name: Localized; lines: number; qty: number }[]
  byReason: { reason: string; lines: number }[]
}
export type PresenceStat = {
  staff: StaffRef
  pointId: string
  pointName: string
  minutes: number
  accepted: number
  /** accepted ÷ hours on the point; null under a minute of presence */
  itemsPerHour: number | null
}
export type SoldOutEvent = {
  at: string
  summary: string
  itemUid: string | null
  typeUid: string | null
  available: boolean | null
  quantity: number | null
  actor: string | null
}
export type CategoryStat = { categoryId: string | null; title: Localized; qty: number; agorot: number; share: number }

export type StatsPayload = {
  serverTime: string
  timezone: string
  scope: {
    /** the chosen session, or null = every session in range */
    sessionId: string | null
    includeTraining: boolean
    /** the sessions the numbers cover */
    sessions: SessionLite[]
  }
  /** for the picker: the latest 40 sessions, newest first, both kinds (the UI labels training) */
  pickerSessions: SessionLite[]
  hero: { salesAgorot: PosStat }
  tiles: {
    orders: PosStat
    averageTicketAgorot: PosStat
    itemsPerTicket: PosStat
    voidRatePercent: PosStat
    /** #9 customers served = orders that were not cancelled */
    customersServed: PosStat
    medianPrepSeconds: Known<number | null>
    medianTotalSeconds: Known<number | null>
  }
  /** #1 */ perItem: Known<ItemStat[]>
  /** #2, #3 (backlog), #4 (timing) */ perPoint: Known<PointStat[]>
  /** #3 items sent per 15 minutes per point */ throughput: Known<ThroughputBucket[]>
  /** #4 overall */ timing: Known<TimingSet>
  /** #5 orders per 15 minutes, in the branch's time zone */ peakHours: Known<PeakBucket[]>
  /** #6 */ perStaff: Known<StaffStat[]>
  /** #7 */ voids: Known<VoidStats>
  /** #10 */ slips: Known<{ ordersWithSlip: number; mismatches: number; rows: SlipRow[] }>
  /** #11 */ presence: Known<PresenceStat[]>
  /** #12 */ uncollected: Known<Capped<UncollectedRow>>
  /** #13 from the menu's own change history */ soldOut: Known<SoldOutEvent[]>
  /** #14 */ categories: Known<CategoryStat[]>
  directory: StaffDirEntry[]
}

// ---- Audit log ---------------------------------------------------------------------------------

export const logQuery = z
  .object({
    branch: branchRef,
    /** comma-separated event types, e.g. `item_voided,order_voided` */
    events: z
      .string()
      .regex(/^[a-z_]+(,[a-z_]+)*$/)
      .max(400)
      .refine((v) => v.split(',').every((e) => (POS_EVENT_TYPES as readonly string[]).includes(e)), { message: 'unknown event' })
      .optional(),
    handle: z.string().trim().min(1).max(40).optional(),
    point: uuid.optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    /** '1' includes events of practice sessions */
    training: flag.optional(),
    cursor: cursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict()
export type LogQuery = z.infer<typeof logQuery>

export type LogRow = PosEvent & {
  /** managers only: the actor's email, shown in the row's detail */
  actor_email: string | null
  point_name: string | null
  session_kind: SessionKind | null
}
export type LogPage = { rows: LogRow[]; nextCursor: string | null; directory: StaffDirEntry[] }

// ---- CSV export ---------------------------------------------------------------------------------

export const exportQuery = z
  .object({
    branch: branchRef,
    session: z.union([uuid, z.literal('all')]).optional(),
    training: flag.optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
  })
  .strict()
export type ExportQuery = z.infer<typeof exportQuery>

// ---- Plain-language refusals (Hebrew + English) ----------------------------------------------------

/** Every refusal / owner-side error a person can read, in plain words. No ids, no
 *  status names, no permission talk. The routes put these in `message`. */
export const OWNER_MESSAGES = {
  conflicts: {
    he: 'חלק מהמוצרים כבר נמכרים בעמדה אחרת. אפשר להעביר אותם לכאן.',
    en: 'Some items are already sold at another point. You can move them here.',
  },
  name_taken: {
    he: 'כבר יש עמדה בשם הזה. בחרו שם אחר.',
    en: 'There is already a point with this name. Choose another name.',
  },
  live_items: {
    he: 'יש עדיין הזמנות פתוחות בעמדה הזאת. אפשר להפסיק אותה אחרי שיסתיימו.',
    en: 'This point still has open orders. You can stop it once they are finished.',
  },
  already_open: { he: 'האירוע כבר פתוח.', en: 'The event is already open.' },
  not_enabled: {
    he: 'הקופה עדיין לא הופעלה לאירוע הזה.',
    en: 'The register has not been switched on for this event yet.',
  },
  no_session: { he: 'האירוע לא פתוח כרגע.', en: 'The event is not open right now.' },
  in_flight: {
    he: 'עדיין יש פריטים שמחכים או בהכנה. סיימו אותם לפני סגירת האירוע.',
    en: 'Some items are still waiting or being prepared. Finish them before closing the event.',
  },
  uncollected: {
    he: 'יש הזמנות שמוכנות ועדיין לא נאספו.',
    en: 'Some orders are ready and still not collected.',
  },
  session_active: {
    he: 'אי אפשר לכבות את הקופה כשהאירוע פתוח. סגרו קודם את האירוע.',
    en: 'The register cannot be switched off while the event is open. Close the event first.',
  },
  not_found: { he: 'לא מצאנו את זה.', en: 'We could not find that.' },
  bad_request: { he: 'הבקשה לא תקינה. בדקו את הפרטים ונסו שוב.', en: 'That request is not valid. Check the details and try again.' },
  bad_config: { he: 'ההגדרות של העמדה לא תקינות.', en: 'The point settings are not valid.' },
  handle_taken: { he: 'הכינוי הזה כבר תפוס. בחרו כינוי אחר.', en: 'This nickname is already taken. Choose another one.' },
  handle_invalid: {
    he: 'הכינוי צריך להיות 2 עד 16 תווים: אותיות, ספרות, נקודה, מקף או קו תחתון.',
    en: 'A nickname is 2 to 16 characters: letters, digits, dot, dash or underscore.',
  },
  handle_required: { he: 'צריך לבחור כינוי לעובד.', en: 'Choose a nickname for the person.' },
  colour_invalid: { he: 'הצבע לא תקין.', en: 'That colour is not valid.' },
  clone_failed: {
    he: 'הסניף נוצר, אבל לא הצלחנו להעתיק את התפריט. אפשר לנסות שוב מעורך התפריט.',
    en: 'The location was created, but the menu could not be copied. You can try again from the menu editor.',
  },
  source_menu_missing: { he: 'לא מצאנו תפריט להעתקה.', en: 'We could not find a menu to copy.' },
} as const satisfies Record<string, Bilingual>
export type OwnerMessageKey = keyof typeof OWNER_MESSAGES

export type { PosEventType }
