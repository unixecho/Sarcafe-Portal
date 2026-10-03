// Every tunable number and fixed list in the POS, in one place — named, because
// each is a judgement call somebody will want to move after a real event rather
// than a fact about the business (Ayeka's dashboard rule). Pure; safe anywhere.
//
// Several of these are the TS half of a rule the database also enforces
// (014/015): scripts/check-pos.mjs asserts the two agree.

import type { ItemStatus } from './types'

// ---- Caps (mirrors of the CHECK constraints in 014/015) ----------------------------
export const LIMITS = {
  customerNameMax: 40,
  phoneDigitsMin: 7,
  phoneDigitsMax: 15,
  lineNoteMax: 120,
  orderNoteMax: 200,
  forNameMax: 40,
  receiptRefMax: 40,
  voidReasonMax: 60,
  linesPerOrderMax: 60,
  qtyMax: 99,
  modifierQtyMax: 9,
  modifiersPerLineMax: 24,
  unitAgorotMax: 500_000,          // ₪5,000 per unit — a sanity ceiling, not a price
  customUnitAgorotMax: 99_999,     // ₪999.99 for a hand-typed item
  handleMin: 2,
  handleMax: 16,
  pointNameMax: 40,
  prepMinutesMin: 1,
  prepMinutesMax: 120,
} as const

// ---- Aging of UNACCEPTED lines — Ayeka's owner-chosen numbers -----------------------
// fresh < 60 s; warming 60–120 s (quiet amber, NO animation: a still first stage
// makes escalation read as building rather than broken-then-panicking);
// late 120–300 s (flash); critical >= 300 s (steady glow + the overdue strip).
// Only `sent` (unaccepted) lines age; once accepted the concern is prep time.
export const AGING = {
  warmingS: 60,
  lateS: 120,
  criticalS: 300,
  /** 10 s read as "the flashing is late"; tick at <= 5 s whenever a threshold is watched. */
  tickMs: 5_000,
} as const

// ---- Freshness engine (blueprint §10) ----------------------------------------------
export const REFRESH = {
  realtimeDebounceMs: 150,
  watchdogTickMs: 5_000,
  deadSocketMs: 15_000,
  /** The floor under the websocket: it drives the SAME refreshKey the socket drives. */
  backupPollMs: 8_000,
  menuPollMs: 20_000,
  boardPollMs: 3_000,
  dashboardPollMs: 30_000,
  /** The owner dashboard refetches on a realtime signal, at most this often. */
  dashboardMinRefetchMs: 2_000,
  /** Keep the realtime channel alive this long after the last subscriber leaves (route remounts). */
  channelGraceMs: 30_000,
} as const

// ---- Outbox ---------------------------------------------------------------------------
export const OUTBOX = {
  backoffStartMs: 1_000,
  backoffCapMs: 15_000,
  storageKeyPrefix: 'sarcafe.pos.outbox.v1.',
  draftKeyPrefix: 'sarcafe.pos.draft.v1.',
} as const

// ---- Undo windows ---------------------------------------------------------------------
export const UNDO = {
  /** Right after sending, the cashier may cancel the whole order (nothing is accepted yet). */
  sendWindowS: 30,
  /** The person who handed something over may take it back for this long. */
  deliveredWindowS: 30,
} as const

// ---- Station screen -------------------------------------------------------------------
export const STATION = {
  /** A fully delivered card lingers this long as a slim chip, then leaves the active area.
   *  Deliberately short (owner, 2026-10-02): the card is DONE; the Done tray stays one tap away
   *  (an edge tab) for anyone who wants it, whether or not they ever drag. */
  doneLingerMs: 5_000,
  /** A voided-after-sent line stays as a struck-through ghost this long. */
  ghostMs: 10 * 60_000,
  /** Recently completed cards kept in the Done tray. */
  doneTrayMax: 40,
  historyLimit: 60,
} as const

// ---- Dashboard signals & thresholds ---------------------------------------------------
export const DASHBOARD = {
  /** stuck = still sent/preparing after max(minMinutes, factor × the point's prep_minutes) */
  stuckMinMinutes: 4,
  stuckFactor: 2,
  /** ignore leftovers older than this (a crash / test fixture is not news) */
  stuckMaxAgeHours: 24,
  uncollectedMinutes: 5,
  sessionOpenTooLongHours: 16,
  /** point backlog warning: in-flight lines per point at/above this */
  backlogWarn: 8,
  feedLimit: 20,
} as const

export const IN_FLIGHT_ITEM_STATUSES: readonly ItemStatus[] = ['sent', 'preparing']
export const LIVE_ITEM_STATUSES: readonly ItemStatus[] = ['sent', 'preparing', 'ready']

/** Server-side rate limits (check_rate_limit; fail-open by design). */
export const RATE = {
  createOrderPerMin: 60,
  advancePerMin: 300,
  voidPerMin: 60,
  handlePerHour: 10,
  boardPerMin: 120,
} as const

/** Customer personal data retention (blueprint §14). */
export const RETENTION = { phoneDays: 30, nameDays: 365 } as const

// ---- Fixed lists --------------------------------------------------------------------------

/** Why a line / order was voided. The Hebrew string is what is STORED (the audit
 *  reads naturally in the owner's language); `en` is only for display. */
export const VOID_REASONS = [
  { key: 'typo', he: 'טעות הקלדה', en: 'Typing mistake' },
  { key: 'customer', he: 'הלקוח ביטל', en: 'Customer cancelled' },
  { key: 'soldout', he: 'אזל', en: 'Sold out' },
  { key: 'remake', he: 'הכנה מחדש', en: 'Remade' },
  { key: 'other', he: 'אחר', en: 'Other' },
] as const
export const UNCOLLECTED_REASON = 'לא נאסף'

/** Point icons are the menu's own icon keys (lib/menu/icons.tsx), so a point and its categories look related. */
export const POINT_ICONS = [
  'utensils', 'pizza', 'coffee', 'cup-soda', 'ice-cream', 'sandwich', 'croissant', 'cookie', 'soup', 'salad', 'cake', 'popcorn',
] as const

/** Point colours: warm/cool hues that avoid the semantic ones (green = ready/ok,
 *  amber = warming, red = late/critical/void, teal = whole order/shared). */
export const POINT_COLOURS = [
  '#FF7A45', '#C084FC', '#60A5FA', '#F472B6', '#A3E635', '#FDE047', '#818CF8', '#E879F9', '#FB923C', '#38BDF8',
] as const

/** Staff colours when `staff.colour` is null: deterministic round-robin over the id-sorted roster. */
export const STAFF_FALLBACK_PALETTE = [
  '#C084FC', '#F472B6', '#FDE047', '#818CF8', '#A3E635', '#E879F9', '#60A5FA', '#FB923C',
] as const

/** "How fast is this point?" as three plain choices — no numbers to type. */
export const PREP_PRESETS = [
  { key: 'fast', minutes: 3 },
  { key: 'medium', minutes: 8 },
  { key: 'slow', minutes: 15 },
] as const

export const HANDLE_PATTERN = /^[A-Za-z0-9֐-׿؀-ۿ_.-]{2,16}$/
export const PHONE_PATTERN = /^\+?[0-9]{7,15}$/
