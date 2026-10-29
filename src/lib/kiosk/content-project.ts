// The kiosk's rotating cards, timings and hours: a strict projection of what the owner saved on /owner/kiosk (plus the
// branch's operating hours and the published menu) into the exact shape GET /api/kiosk/content answers with. The kiosk
// app is coded against this shape: change nothing in KioskContent without the kiosk.
//
// Pure: no imports, no database, no network, no clock unless one is passed. The QR encoder and the hash are handed in
// (lib/kiosk/content.ts gives the real ones), so scripts/check-kiosk-content.mjs can run this file directly.

export const AD_KINDS = ['location', 'feedback', 'loyalty', 'hours', 'menu_highlight', 'custom'] as const
export const AD_ACTIONS = ['none', 'join', 'menu'] as const
export type AdKind = (typeof AD_KINDS)[number]
export type AdAction = (typeof AD_ACTIONS)[number]

export const SETTINGS_BOUNDS = {
  idleSeconds: { min: 30, max: 300, fallback: 60 },
  graceSeconds: { min: 5, max: 30, fallback: 10 },
  slideSeconds: { min: 3, max: 60, fallback: 7 },
} as const

/** The public poll page the feedback card's QR opens. */
export const FEEDBACK_PATH = '/feedback'

export type KioskContentSettings = { idleSeconds: number; graceSeconds: number; slideSeconds: number }

export type KioskAd = {
  id: string
  kind: AdKind
  title: string
  body: string
  action: AdAction
  qr: { url: string; modules: string[] } | null
  imageUrl: string | null
}

export type KioskHoursDay = { day: number; open: string | null; close: string | null }
export type KioskHoursException = { date: string; closed: boolean; open: string | null; close: string | null; note: string | null }
export type KioskHours = { timezone: string; week: KioskHoursDay[]; exceptions: KioskHoursException[] }
export type KioskHighlight = { name: string; price: number | null; note: string | null }

export type KioskContent = {
  version: string
  settings: KioskContentSettings
  ads: KioskAd[]
  hours: KioskHours | null
  highlights: KioskHighlight[]
}

/** A stored card, as the database row has it (snake_case columns mapped by the loader). */
export type StoredAd = {
  id: string
  kind: string
  title: string
  body: string
  action: string
  imageUrl: string | null
  menuItemIds: string[]
  enabled: boolean
  sortOrder: number
}

/** The minimum of a published menu item the highlights need (lib/menu/types MenuItem satisfies it). */
export type HighlightSourceItem = {
  uid?: string
  he?: string
  en?: string
  price?: number | string | null
  note?: { he?: string; en?: string }
  available?: boolean
  quantity?: number
}

export type ContentInput = {
  settings: Partial<KioskContentSettings> | null
  ads: StoredAd[]
  /** Sunday-to-Saturday operating hours (null entry = closed day), or null when the branch has none configured. */
  weeklyHours: Array<{ open: string; close: string } | null> | null
  exceptions: KioskHoursException[]
  timezone: string
  /** Every item of the published menu, in menu order. */
  menuItems: HighlightSourceItem[]
  /** Absolute URL of the public poll page. */
  feedbackUrl: string
  /** Today in the branch's timezone, YYYY-MM-DD: exceptions before it are dropped. */
  today: string
  /** The only place a card's picture may come from (our own public storage, see imageAllowed); null = no pictures. */
  imagePrefix: string | null
}

export type ContentDeps = {
  /** QR matrix rows of '0'/'1' for a URL. */
  qr: (url: string) => string[]
  /** A short content hash of a string. */
  hash: (text: string) => string
}

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
const HM = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

const isKind = (value: string): value is AdKind => (AD_KINDS as readonly string[]).includes(value)
const isAction = (value: string): value is AdAction => (AD_ACTIONS as readonly string[]).includes(value)

function clampInt(value: unknown, bounds: { min: number; max: number; fallback: number }): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return bounds.fallback
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(n)))
}

export function normalizeSettings(raw: Partial<KioskContentSettings> | null): KioskContentSettings {
  return {
    idleSeconds: clampInt(raw?.idleSeconds, SETTINGS_BOUNDS.idleSeconds),
    graceSeconds: clampInt(raw?.graceSeconds, SETTINGS_BOUNDS.graceSeconds),
    slideSeconds: clampInt(raw?.slideSeconds, SETTINGS_BOUNDS.slideSeconds),
  }
}

/** The week (always 7 entries, Sunday = 0) and the exceptions from today on, sorted; null when there is nothing. */
export function projectHours(
  weeklyHours: ContentInput['weeklyHours'],
  exceptions: KioskHoursException[],
  timezone: string,
  today: string,
): KioskHours | null {
  const upcoming = exceptions
    .filter((e) => DATE.test(e.date) && e.date >= today)
    .map((e) => ({
      date: e.date,
      closed: e.closed === true,
      open: e.closed !== true && typeof e.open === 'string' && HM.test(e.open) ? e.open : null,
      close: e.closed !== true && typeof e.close === 'string' && HM.test(e.close) ? e.close : null,
      note: typeof e.note === 'string' && e.note.trim() ? e.note.trim() : null,
    }))
    // an open day with no valid times says nothing: drop it rather than show it as closed
    .filter((e) => e.closed || (e.open !== null && e.close !== null))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, 20)
  if (!weeklyHours && upcoming.length === 0) return null
  const week: KioskHoursDay[] = Array.from({ length: 7 }, (_, day) => {
    const hours = weeklyHours?.[day] ?? null
    return hours && HM.test(hours.open) && HM.test(hours.close)
      ? { day, open: hours.open, close: hours.close }
      : { day, open: null, close: null }
  })
  return { timezone, week, exceptions: upcoming }
}

/** "ראשון–חמישי 08:00–19:00 · שישי 08:00–13:00 · שבת 09:00–14:00", then the next exceptions. */
export function hoursText(hours: KioskHours | null): string {
  if (!hours) return ''
  const parts: string[] = []
  let start = 0
  const same = (a: KioskHoursDay | undefined, b: KioskHoursDay | undefined) => a?.open === b?.open && a?.close === b?.close
  for (let day = 1; day <= 7; day++) {
    if (day < 7 && same(hours.week[day], hours.week[start])) continue
    const first = hours.week[start]
    const days = start === day - 1 ? DAY_NAMES[start] : `${DAY_NAMES[start]}–${DAY_NAMES[day - 1]}`
    parts.push(first?.open && first.close ? `${days} ${first.open}–${first.close}` : `${days} סגור`)
    start = day
  }
  const weekText = hours.week.every((d) => d.open === null) ? '' : parts.join(' · ')
  const exceptionText = hours.exceptions
    .slice(0, 3)
    .map((e) => {
      const [, m, d] = e.date.split('-')
      const date = `${Number(d)}.${Number(m)}`
      const what = e.closed ? 'סגור' : `${e.open}–${e.close}`
      return `${date}${e.note ? ` (${e.note})` : ''}: ${what}`
    })
    .join(' · ')
  return [weekText, exceptionText ? `שינויים קרובים: ${exceptionText}` : ''].filter(Boolean).join('\n')
}

/** Our own public storage only: https, under the given prefix, no tricks (`..`, `@`, quotes, spaces, backslashes). */
export function imageAllowed(url: string, prefix: string | null): boolean {
  if (!prefix || !prefix.startsWith('https://') || !url.startsWith(prefix)) return false
  if (url.length > 500 || /[\s"'<>\\@]|\.\./.test(url)) return false
  return url.length > prefix.length
}

function itemPrice(price: HighlightSourceItem['price']): number | null {
  if (typeof price === 'number' && Number.isFinite(price)) return price
  if (typeof price === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(price)) return Number(price)
  return null
}

/** The selected items, in the owner's order, with their current published name and price; unavailable ones skipped. */
export function projectHighlights(ids: string[], menuItems: HighlightSourceItem[]): KioskHighlight[] {
  const byUid = new Map<string, HighlightSourceItem>()
  for (const item of menuItems) if (item.uid && !byUid.has(item.uid)) byUid.set(item.uid, item)
  const out: KioskHighlight[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const item = byUid.get(id)
    if (!item || item.available === false || item.quantity === 0) continue
    const name = (item.he ?? item.en ?? '').trim()
    if (!name) continue
    const note = (item.note?.he ?? item.note?.en ?? '').trim()
    out.push({ name, price: itemPrice(item.price), note: note || null })
  }
  return out
}

/** The whole answer, without its version. Only enabled cards, in order; a card with nothing to say is left out. */
export function projectContent(input: ContentInput, deps: Pick<ContentDeps, 'qr'>): Omit<KioskContent, 'version'> {
  const settings = normalizeSettings(input.settings)
  const hours = projectHours(input.weeklyHours, input.exceptions, input.timezone, input.today)
  const enabled = input.ads
    .filter((ad) => ad.enabled && isKind(ad.kind))
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const highlightIds = enabled.filter((ad) => ad.kind === 'menu_highlight').flatMap((ad) => ad.menuItemIds)
  const highlights = projectHighlights(highlightIds, input.menuItems)

  const ads: KioskAd[] = []
  for (const ad of enabled) {
    const kind = ad.kind as AdKind
    const title = ad.title.trim()
    let body = ad.body.trim()
    if (kind === 'hours') {
      body = hoursText(hours)
      if (!body) continue // no hours anywhere: no hours card
    }
    if (kind === 'menu_highlight' && projectHighlights(ad.menuItemIds, input.menuItems).length === 0) continue
    if (!title) continue
    ads.push({
      id: ad.id,
      kind,
      title,
      body,
      action: isAction(ad.action) ? ad.action : 'none',
      qr: kind === 'feedback' ? { url: input.feedbackUrl, modules: deps.qr(input.feedbackUrl) } : null,
      imageUrl: ad.imageUrl && imageAllowed(ad.imageUrl, input.imagePrefix) ? ad.imageUrl : null,
    })
  }
  return { settings, ads, hours, highlights }
}

export function buildKioskContent(input: ContentInput, deps: ContentDeps): KioskContent {
  const content = projectContent(input, deps)
  return { version: deps.hash(JSON.stringify(content)), ...content }
}
