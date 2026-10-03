// Audit events as plain sentences. Pure. Used by the timeline on a station, the
// order detail, the manager's live feed and the full log — one place, so the same
// event is never worded two different ways.
//
// Every sentence is built from the event's PAYLOAD (display data written in at
// write time — a feed that has to join back to recover a name shows a blank the
// day the join breaks, which is exactly what Ayeka's feed did). Payloads never
// carry a phone number, so neither can a sentence.

import type { PosEvent, PosEventType } from './types'
import type { PosLang } from './format'

export type EventTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info'
export type EventKind = 'order' | 'line' | 'session' | 'config' | 'people' | 'system'

export type EventDescription = {
  /** lucide icon name — the caller maps it (kept as a string so this file stays pure) */
  icon: string
  tone: EventTone
  kind: EventKind
  /** the sentence, WITHOUT the actor — the UI shows the actor's handle chip beside it */
  text: string
  /** low-signal events (the pickup stamp that always precedes a delivery) the feed may hide */
  quiet: boolean
}

type P = Record<string, unknown>
const s = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
// Non-finite numbers read as 0: a sentence must never say NaN or Infinity, whatever a payload held.
const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : 0
}

const STATE: Record<string, { he: string; en: string }> = {
  sent: { he: 'ממתין', en: 'waiting' },
  preparing: { he: 'בהכנה', en: 'being prepared' },
  ready: { he: 'מוכן', en: 'ready' },
  delivered: { he: 'נמסר', en: 'handed over' },
}
const state = (v: unknown, lang: PosLang) => STATE[s(v)]?.[lang] ?? s(v)

const who = (p: P) => {
  const name = s(p.customer_name)
  const no = n(p.ticket_no)
  return no ? (name ? `#${no} · ${name}` : `#${no}`) : name
}
const item = (p: P) => {
  const t = s(p.type)
  return `${n(p.qty) > 1 ? `${n(p.qty)}× ` : ''}${s(p.name)}${t ? ` · ${t}` : ''}`
}
const money = (agorot: unknown) => {
  const a = n(agorot)
  const w = Math.floor(a / 100)
  const r = a % 100
  return `₪${r === 0 ? w : `${w}.${String(r).padStart(2, '0')}`}`
}
const itemsCount = (p: P) => (Array.isArray(p.items) ? p.items.length : 0)

type Spec = {
  icon: string
  tone: EventTone
  kind: EventKind
  quiet?: boolean
  he: (p: P) => string
  en: (p: P) => string
}

const SPECS: Record<PosEventType, Spec> = {
  order_created: {
    icon: 'receipt', tone: 'info', kind: 'order',
    he: (p) => `הזמנה חדשה ${who(p)} — ${itemsCount(p)} פריטים · ${money(p.total_agorot)}${p.slip_mismatch ? ' · הסכום שונה מהקבלה' : ''}`,
    en: (p) => `New order ${who(p)} — ${itemsCount(p)} item(s) · ${money(p.total_agorot)}${p.slip_mismatch ? ' · differs from the slip' : ''}`,
  },
  items_added: {
    icon: 'plus', tone: 'info', kind: 'order',
    he: (p) => `נוספו פריטים להזמנה ${who(p)} (${itemsCount(p)})`,
    en: (p) => `Items added to ${who(p)} (${itemsCount(p)})`,
  },
  order_edited: {
    icon: 'pencil', tone: 'neutral', kind: 'order',
    he: (p) => (p.name_changed ? `פרטי הזמנה ${n(p.ticket_no) ? `#${n(p.ticket_no)}` : ''} עודכנו — השם שונה מ־${s(p.previous_name)} ל־${s(p.customer_name)}` : `פרטי הזמנה ${who(p)} עודכנו`),
    en: (p) => (p.name_changed ? `Order ${n(p.ticket_no) ? `#${n(p.ticket_no)}` : ''} updated — name changed from ${s(p.previous_name)} to ${s(p.customer_name)}` : `Order ${who(p)} updated`),
  },
  item_claimed: {
    icon: 'flame', tone: 'neutral', kind: 'line',
    he: (p) => `${item(p)} התקבל להכנה — ${who(p)}`,
    en: (p) => `${item(p)} accepted — ${who(p)}`,
  },
  item_ready: {
    icon: 'bell', tone: 'ok', kind: 'line',
    he: (p) => `${item(p)} מוכן — ${who(p)}`,
    en: (p) => `${item(p)} ready — ${who(p)}`,
  },
  item_picked_up: {
    icon: 'hand', tone: 'neutral', kind: 'line', quiet: true,
    he: (p) => `${item(p)} נאסף — ${who(p)}`,
    en: (p) => `${item(p)} picked up — ${who(p)}`,
  },
  item_delivered: {
    icon: 'check', tone: 'ok', kind: 'line',
    he: (p) => `${item(p)} נמסר — ${who(p)}`,
    en: (p) => `${item(p)} handed over — ${who(p)}`,
  },
  item_reverted: {
    icon: 'undo-2', tone: 'warn', kind: 'line',
    he: (p) => `${item(p)} הוחזר מ"${state(p.from, 'he')}" ל"${state(p.to, 'he')}" — ${who(p)}`,
    en: (p) => `${item(p)} moved back from "${state(p.from, 'en')}" to "${state(p.to, 'en')}" — ${who(p)}`,
  },
  item_voided: {
    icon: 'x', tone: 'danger', kind: 'line',
    he: (p) => `${item(p)} בוטל${s(p.reason) ? ` — ${s(p.reason)}` : ''} — ${who(p)}`,
    en: (p) => `${item(p)} cancelled${s(p.reason) ? ` — ${s(p.reason)}` : ''} — ${who(p)}`,
  },
  order_voided: {
    icon: 'ban', tone: 'danger', kind: 'order',
    he: (p) => `הזמנה ${who(p)} בוטלה${s(p.reason) ? ` — ${s(p.reason)}` : ''}`,
    en: (p) => `Order ${who(p)} cancelled${s(p.reason) ? ` — ${s(p.reason)}` : ''}`,
  },
  order_completed: {
    icon: 'circle-check', tone: 'ok', kind: 'order',
    he: (p) => `הזמנה ${who(p)} הושלמה${p.total_agorot !== undefined ? ` · ${money(p.total_agorot)}` : ''}`,
    en: (p) => `Order ${who(p)} complete${p.total_agorot !== undefined ? ` · ${money(p.total_agorot)}` : ''}`,
  },
  session_opened: {
    icon: 'play', tone: 'ok', kind: 'session',
    he: (p) => (s(p.kind) === 'training' ? 'התחיל מצב אימון' : 'האירוע נפתח'),
    en: (p) => (s(p.kind) === 'training' ? 'Training started' : 'Event opened'),
  },
  session_closed: {
    icon: 'square', tone: 'warn', kind: 'session',
    he: (p) => `האירוע נסגר${n(p.voided_uncollected) ? ` — ${n(p.voided_uncollected)} פריטים שלא נאספו בוטלו` : ''}`,
    en: (p) => `Event closed${n(p.voided_uncollected) ? ` — ${n(p.voided_uncollected)} uncollected item(s) cancelled` : ''}`,
  },
  training_wiped: {
    icon: 'eraser', tone: 'warn', kind: 'session',
    he: (p) => `נתוני האימון נמחקו (${n(p.orders)} הזמנות)`,
    en: (p) => `Training data wiped (${n(p.orders)} orders)`,
  },
  point_created: {
    icon: 'store', tone: 'info', kind: 'config',
    he: (p) => `נוצרה עמדה: ${s(p.name)}`,
    en: (p) => `Selling point created: ${s(p.name)}`,
  },
  point_updated: {
    icon: 'store', tone: 'info', kind: 'config',
    he: (p) => `העמדה ${s(p.name)} עודכנה`,
    en: (p) => `Selling point ${s(p.name)} updated`,
  },
  point_deactivated: {
    icon: 'store', tone: 'warn', kind: 'config',
    he: (p) => `העמדה ${s(p.name)} הופסקה`,
    en: (p) => `Selling point ${s(p.name)} deactivated`,
  },
  routes_changed: {
    icon: 'route', tone: 'info', kind: 'config',
    he: (p) => (s(p.moved_to) ? `מוצרים הועברו אל ${s(p.moved_to)}` : 'ניתוב המוצרים עודכן'),
    en: (p) => (s(p.moved_to) ? `Products moved to ${s(p.moved_to)}` : 'Product routing updated'),
  },
  checkin: {
    icon: 'log-in', tone: 'neutral', kind: 'people',
    he: (p) => `נכנס/ה לעמדה ${s(p.point)}`,
    en: (p) => `Checked in at ${s(p.point)}`,
  },
  checkout: {
    icon: 'log-out', tone: 'neutral', kind: 'people',
    he: (p) => `יצא/ה מהעמדה ${s(p.point)}`,
    en: (p) => `Checked out of ${s(p.point)}`,
  },
  handle_changed: {
    icon: 'at-sign', tone: 'neutral', kind: 'people',
    he: (p) => `הכינוי שונה מ־${s(p.old)} ל־${s(p.new)}`,
    en: (p) => `Nickname changed from ${s(p.old)} to ${s(p.new)}`,
  },
  board_token_rotated: {
    icon: 'key-round', tone: 'warn', kind: 'system',
    he: () => 'קישור לוח ההזמנות החדש נוצר — הקישור הישן בוטל',
    en: () => 'A new ready-board link was created — the old one stopped working',
  },
  settings_changed: {
    icon: 'settings', tone: 'info', kind: 'system',
    he: (p) => (p.enabled === true ? 'מערכת הקופה הופעלה' : p.enabled === false ? 'מערכת הקופה כובתה' : p.employee_no !== undefined ? 'מספר העובד שונה' : 'ההגדרות עודכנו'),
    en: (p) => (p.enabled === true ? 'POS turned on' : p.enabled === false ? 'POS turned off' : p.employee_no !== undefined ? 'Employee number changed' : 'Settings updated'),
  },
  pin_changed: {
    icon: 'key-round', tone: 'neutral', kind: 'people',
    he: (p) => (p.cleared ? 'קוד הכניסה המהירה בוטל' : p.by_self ? 'קוד הכניסה המהירה עודכן' : 'קוד הכניסה המהירה של עובד/ת אופס'),
    en: (p) => (p.cleared ? 'Quick-login passcode removed' : p.by_self ? 'Quick-login passcode changed' : 'A quick-login passcode was reset for a staff member'),
  },
  quick_login: {
    icon: 'log-in', tone: 'neutral', kind: 'people', quiet: true,
    he: (p) => `כניסה מהירה (עובד/ת מס׳ ${n(p.employee_no)})`,
    en: (p) => `Quick login (employee no. ${n(p.employee_no)})`,
  },
  pii_cleared: {
    icon: 'shield-check', tone: 'neutral', kind: 'system', quiet: true,
    he: (p) => `פרטי לקוחות נמחקו לפי מדיניות השמירה (${n(p.phones)} טלפונים, ${n(p.names)} שמות)`,
    en: (p) => `Customer details cleared by the retention policy (${n(p.phones)} phones, ${n(p.names)} names)`,
  },
}

export function describeEvent(ev: Pick<PosEvent, 'event' | 'payload'>, lang: PosLang = 'he'): EventDescription {
  const spec = SPECS[ev.event]
  if (!spec) {
    return { icon: 'circle', tone: 'neutral', kind: 'system', text: String(ev.event), quiet: false }
  }
  const p = (ev.payload ?? {}) as P
  return { icon: spec.icon, tone: spec.tone, kind: spec.kind, text: (lang === 'en' ? spec.en : spec.he)(p), quiet: !!spec.quiet }
}

export type FeedRow<E extends Pick<PosEvent, 'id' | 'event' | 'order_id' | 'actor_id' | 'at' | 'payload'>> = {
  /** the first (newest) event of the run */
  event: E
  /** how many consecutive identical events were folded into this row */
  count: number
  ids: number[]
}

/**
 * Folds runs of the same event by the same person on the same order into one row
 * ("3× item ready") — a batch touches a dozen lines and the feed must not read as
 * twelve lines of noise. Adjacency-based and applied at READ time on the already
 * ordered list (newest first); nothing is stored folded.
 */
export function groupFeed<E extends Pick<PosEvent, 'id' | 'event' | 'order_id' | 'actor_id' | 'at' | 'payload'>>(
  events: E[],
  windowMs = 10_000,
): FeedRow<E>[] {
  const out: FeedRow<E>[] = []
  for (const e of events) {
    const prev = out[out.length - 1]
    const foldable =
      prev &&
      prev.event.event === e.event &&
      prev.event.order_id === e.order_id &&
      prev.event.actor_id === e.actor_id &&
      Math.abs(Date.parse(prev.event.at) - Date.parse(e.at)) <= windowMs &&
      (e.event === 'item_ready' || e.event === 'item_claimed' || e.event === 'item_delivered' || e.event === 'item_picked_up' || e.event === 'item_voided')
    if (foldable) {
      prev.count++
      prev.ids.push(e.id)
    } else {
      out.push({ event: e, count: 1, ids: [e.id] })
    }
  }
  return out
}
