// Portal review-wall content — pure data/validation, no Supabase.
//
// Reviews now live per-branch on public.branches.reviews (see migration
// 008_branch_reviews.sql), owner-editable via BranchReviewsEditor.tsx —
// never pulled from Google automatically, by design (the site has no
// Google API integration). A branch with nothing saved falls back to
// PLACEHOLDER_BLOCK below via normalizeReviews() rather than rendering an
// empty wall.

export type ReviewLang = 'he' | 'en' | 'ar'

export type PortalReview = {
  id: string
  /** Owner's own reference only (e.g. "Google review, Jan 2026") — the
   *  public wall deliberately never surfaces a reviewer's identity, same
   *  reasoning AyekaBar's ReviewWall documents: never invent, and never
   *  publish, an identity for someone else's words. */
  author?: string
  stars: number // 1-5
  lang: ReviewLang // which language the quote itself is written in — drives the card's `dir`
  /** Freeform, owner's own reference only — not parsed or displayed. */
  date?: string
  text: string
  /** false = kept but hidden from the public wall (an owner "unpublish"
   *  without deleting). Defaults to visible when absent. */
  visible?: boolean
}

export type PortalReviewsBlock = {
  rating: number
  count: number
  items: PortalReview[]
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Hard cap so the editor (and a malformed row) can never make the wall
 *  render an unbounded number of cards. */
export const MAX_REVIEWS = 40
export const MAX_REVIEW_TEXT_LEN = 600

function normalizeReview(raw: unknown, index: number): PortalReview | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const text = typeof r.text === 'string' ? r.text.trim() : ''
  if (!text) return null
  const lang: ReviewLang = r.lang === 'en' || r.lang === 'ar' ? r.lang : 'he'
  const stars = typeof r.stars === 'number' && Number.isFinite(r.stars) ? clamp(Math.round(r.stars), 1, 5) : 5
  const author = typeof r.author === 'string' && r.author.trim() ? r.author.trim().slice(0, 120) : undefined
  const date = typeof r.date === 'string' && r.date.trim() ? r.date.trim().slice(0, 40) : undefined
  const visible = r.visible !== false
  return {
    id: typeof r.id === 'string' && r.id ? r.id : `r${index}`,
    author,
    stars,
    lang,
    date,
    text: text.slice(0, MAX_REVIEW_TEXT_LEN),
    visible,
  }
}

/** Coerce whatever the DB (or a malformed write) hands back into something
 *  safe to render — same shape of defensiveness AyekaBar's normalizeReviews
 *  uses. Also the single validator the owner-facing write path
 *  (PATCH /api/owner/branches) runs input through before saving, so what's
 *  stored is exactly what will render. */
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
// than text convincing enough to pass as a real customer's words. Shown
// only when a branch has no reviews of its own saved yet.
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

export const PLACEHOLDER_BLOCK: PortalReviewsBlock = {
  rating: 4.8,
  count: 120,
  items: [...PLACEHOLDER_ITEMS_HE, ...PLACEHOLDER_ITEMS_EN],
}

/** The subset the wall actually renders — visible items only, per the
 *  owner's show/hide toggle (mirrors AyekaBar's visibleReviews, extended
 *  with the visibility filter now that one exists). */
export function visibleReviews(block: PortalReviewsBlock): PortalReview[] {
  return block.items.filter((r) => r.visible !== false)
}
