// Branch types + pure helpers only — safe to import from Client Components.
// Branches now live in the database (public.branches), not a hardcoded
// list, since the owner can create new ones from the menu editor (see
// AddBranchSheet.tsx). Server code reads them via lib/branches/server.ts;
// Client Components fetch GET /api/branches. Nothing in this file may
// import next/headers or supabase/server — that would break every client
// bundle that imports BranchSlug/branchName from here. (lib/reviews.ts is
// safe to import from here — it's the same kind of pure, client-safe
// module, with no dependency back on this file.)

import type { PortalReviewsBlock } from '@/lib/reviews'
import type { Lang } from '@/lib/menu/types'

export type BranchSlug = string

/** Today's operating hours in the branch's own timezone, pulled from the
 * scheduler's per-branch settings (shift_settings — "שעות פעילות" in
 * ManagerPanel.tsx) — never from shift instances, which start earlier and
 * end later than the branch is actually open. null = not a working day (or
 * hours were never configured). Computed server-side by
 * lib/shifts/hours.ts; this file only carries the resulting shape so it
 * stays importable from Client Components. */
export type BranchHours = { open: string; close: string } | null

export type LocalizedText = { he: string; en?: string; ar?: string }

export type BranchLinks = {
  navGoogleMaps: string | null
  navWaze: string | null
  navAppleMaps: string | null
  instagram: string | null
  review: string | null
  bit: string | null
}

export type Branch = {
  id: string
  slug: BranchSlug
  name: LocalizedText
  links: BranchLinks
  /** Owner-curated review-wall content, or null when this branch has never
   * had one saved — callers fall back to lib/reviews.ts's placeholder via
   * normalizeReviews() rather than treating null as "show nothing." */
  reviews: PortalReviewsBlock | null
  hoursToday: BranchHours
  /** Whether the branch is inside its operating-hours window right now, as
   * of when this Branch was fetched — a page-load snapshot, not a live
   * tick, same freshness contract as everything else on the portal/menu
   * pages that isn't behind the realtime channel. */
  openNow: boolean
}

// U+2066 FIRST STRONG ISOLATE / U+2069 POP DIRECTIONAL ISOLATE — isolates a
// substring's bidi behavior using its OWN inherent direction (a time like
// "19:00" resolves LTR from its first digit) without touching the
// surrounding Hebrew/Arabic text's own flow. This is the fix for a real bug:
// wrapping the WHOLE mixed phrase in a `direction:ltr` container (the
// `ltr-isolate` CSS class, meant for a standalone number/price) reverses the
// Hebrew words' order relative to the time and breaks `margin-inline-start`
// (which resolves against the element's OWN direction, not the page's) —
// confirmed live as a quantity badge rendering mashed into the preceding
// word with no gap. Plain Unicode control characters avoid both: no CSS
// container, so nothing about surrounding text or spacing changes.
function isolateDigits(value: string): string {
  return `⁦${value}⁩`
}

const HOURS_COPY: Record<Lang, { closedToday: string; openUntil: (close: string) => string; closedNow: (open: string, close: string) => string }> = {
  he: {
    closedToday: 'סגור היום',
    openUntil: (close) => `פתוח עד ${isolateDigits(close)}`,
    closedNow: (open, close) => `סגור כרגע · ${isolateDigits(`${open}–${close}`)}`,
  },
  en: {
    closedToday: 'Closed today',
    openUntil: (close) => `Open until ${isolateDigits(close)}`,
    closedNow: (open, close) => `Closed now · ${isolateDigits(`${open}–${close}`)}`,
  },
  ar: {
    closedToday: 'مغلق اليوم',
    openUntil: (close) => `مفتوح حتى ${isolateDigits(close)}`,
    closedNow: (open, close) => `مغلق الآن · ${isolateDigits(`${open}–${close}`)}`,
  },
}

/** One label for "is this branch open, and until/since when" — shared by
 * the portal's branch picker/detail panel and the public menu header, so
 * the wording never drifts between the two places it appears. */
export function hoursStatusLabel(branch: Pick<Branch, 'hoursToday' | 'openNow'>, lang: Lang): string {
  const copy = HOURS_COPY[lang] ?? HOURS_COPY.he
  if (!branch.hoursToday) return copy.closedToday
  return branch.openNow ? copy.openUntil(branch.hoursToday.close) : copy.closedNow(branch.hoursToday.open, branch.hoursToday.close)
}

export function branchName(
  branches: readonly { slug: string; name: Record<string, string | undefined> }[],
  slug: string,
  lang: 'he' | 'en' | 'ar' = 'he'
): string {
  const match = branches.find((b) => b.slug === slug)
  return match?.name[lang] ?? match?.name.he ?? slug
}

// A short English "code" a branch slug must satisfy — lowercase letters,
// digits, hyphens, matching the existing 'maor' / 'givat-haviva' shape.
// Shared between the client-side AddBranchSheet form and the server-side
// Zod schema in api/owner/branches so both reject the same inputs.
export const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,29}$/

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
}
