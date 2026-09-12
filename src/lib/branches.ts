// Branch types + pure helpers only — safe to import from Client Components.
// Branches now live in the database (public.branches), not a hardcoded
// list, since the owner can create new ones from the menu editor (see
// AddBranchSheet.tsx). Server code reads them via lib/branches/server.ts;
// Client Components fetch GET /api/branches. Nothing in this file may
// import next/headers or supabase/server — that would break every client
// bundle that imports BranchSlug/branchName from here.

export type BranchSlug = string

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
