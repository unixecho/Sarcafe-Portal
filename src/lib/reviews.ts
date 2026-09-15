// Portal review-wall content — pure data, no Supabase.
//
// Sarcafe has no owner-facing settings system for the portal yet (unlike
// AyekaBar's `app_settings`-backed `getPortalReviews()`), and branches now
// live in the database rather than a static file (see lib/branches.ts), so
// this stays a small static module keyed by branch slug rather than a
// per-branch editor. Swap `PLACEHOLDER_REVIEWS` for real, owner-curated
// quotes before this goes live — see the warning below.
//
// ⚠️ PLACEHOLDER CONTENT — every quote, star count, rating and review count
// below is a mockup stand-in for the visual redesign, not a real customer
// review. Nothing here names a real person (reviews stay anonymous by
// design, same reasoning AyekaBar's ReviewWall documents: never invent an
// identity for someone else's words) but the numbers ARE fabricated for
// layout purposes and must not ship to real customers unreplaced.

export type ReviewLang = 'he' | 'en' | 'ar'

export type PortalReview = {
  id: string
  stars: number // 1-5
  lang: ReviewLang // which language the quote itself is written in — drives the card's `dir`
  text: string
}

export type PortalReviewsBlock = {
  rating: number
  count: number
  items: PortalReview[]
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Hard cap so a future data source can never make the wall render an
 *  unbounded number of cards. */
export const MAX_REVIEWS = 40

function normalizeReview(raw: unknown, index: number): PortalReview | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const text = typeof r.text === 'string' ? r.text.trim() : ''
  if (!text) return null
  const lang: ReviewLang = r.lang === 'en' || r.lang === 'ar' ? r.lang : 'he'
  const stars = typeof r.stars === 'number' && Number.isFinite(r.stars) ? clamp(Math.round(r.stars), 1, 5) : 5
  return { id: typeof r.id === 'string' && r.id ? r.id : `r${index}`, stars, lang, text: text.slice(0, 600) }
}

/** Coerce whatever a future data source hands back into something safe to
 *  render — same shape of defensiveness AyekaBar's normalizeReviews uses,
 *  kept even though today's only "source" is the literal object below, so
 *  swapping in a real settings table later doesn't need this rewritten. */
export function normalizeReviews(raw: unknown, fallback: PortalReviewsBlock): PortalReviewsBlock {
  if (typeof raw !== 'object' || raw === null) return fallback
  const b = raw as Record<string, unknown>
  const items = Array.isArray(b.items)
    ? b.items
        .slice(0, MAX_REVIEWS)
        .map((item, i) => normalizeReview(item, i))
        .filter((r): r is PortalReview => r !== null)
    : []
  if (!items.length) return fallback
  const rating = typeof b.rating === 'number' && Number.isFinite(b.rating) ? clamp(b.rating, 0, 5) : fallback.rating
  const count = typeof b.count === 'number' && Number.isFinite(b.count) ? Math.max(0, Math.round(b.count)) : fallback.count
  return { rating, count, items }
}

// Deliberately generic — no invented specifics (no names, no dates, no
// hyper-particular anecdotes) precisely BECAUSE these are placeholders:
// text that reads as "obviously a stand-in" is safer to accidentally ship
// than text convincing enough to pass as a real customer's words.
const PLACEHOLDER_ITEMS_HE: PortalReview[] = [
  { id: 'p1', stars: 5, lang: 'he', text: 'הקפה הכי טוב באזור, ותמיד עם חיוך. עוצרים כאן כל בוקר.' },
  { id: 'p2', stars: 5, lang: 'he', text: 'עגלה קטנה עם אווירה ענקית — בדיוק מה שהיה חסר לנו כאן.' },
  { id: 'p3', stars: 4, lang: 'he', text: 'שירות מהיר, טעם עקבי, ותמיד יודעים להמליץ על משהו חדש.' },
  { id: 'p4', stars: 5, lang: 'he', text: 'הפכה להרגל של יום שישי. אי אפשר בלי.' },
]
const PLACEHOLDER_ITEMS_EN: PortalReview[] = [
  { id: 'p5', stars: 5, lang: 'en', text: "Best coffee stop on this side of town — friendly every single time." },
  { id: 'p6', stars: 5, lang: 'en', text: 'Small truck, huge vibe. Exactly what this corner needed.' },
  { id: 'p7', stars: 4, lang: 'en', text: 'Quick, consistent, and they always have a good recommendation.' },
]

const PLACEHOLDER_BLOCK: PortalReviewsBlock = {
  rating: 4.8,
  count: 120,
  items: [...PLACEHOLDER_ITEMS_HE, ...PLACEHOLDER_ITEMS_EN],
}

/** Same placeholder block for every branch today — there is exactly one
 *  written yet. Keyed by slug (rather than a single flat export) so a real
 *  per-branch source can drop in later without changing any call site. */
const PORTAL_REVIEWS: Record<string, PortalReviewsBlock> = {}

export function getPortalReviews(branchSlug: string): PortalReviewsBlock {
  return PORTAL_REVIEWS[branchSlug] ?? PLACEHOLDER_BLOCK
}

/** The subset the wall actually renders (mirrors AyekaBar's visibleReviews —
 *  kept as its own function so a future "hide this one" flag has somewhere
 *  to live without touching call sites). */
export function visibleReviews(block: PortalReviewsBlock): PortalReview[] {
  return block.items
}
