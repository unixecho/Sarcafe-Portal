// Sarcafe operates exactly two physical locations. This rarely changes, so
// it's a small static list (matching supabase/migrations/000_core_schema.sql's
// seed) rather than a fetched-on-every-page config — the DB row per branch
// still carries the source-of-truth id/name, this is only for building
// static UI (nav, the branch switcher) without an extra round trip.
export const BRANCHES = [
  { slug: 'maor', name: { he: 'מאור', en: 'Maor', ar: 'ماعور' } },
  { slug: 'givat-haviva', name: { he: 'גבעת חביבה', en: 'Givat Haviva', ar: 'جفعات حبيبة' } },
] as const

export type BranchSlug = (typeof BRANCHES)[number]['slug']

export function branchName(slug: string, lang: 'he' | 'en' | 'ar' = 'he'): string {
  return BRANCHES.find((b) => b.slug === slug)?.name[lang] ?? slug
}
