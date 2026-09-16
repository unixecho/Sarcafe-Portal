import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { Branch } from '@/lib/branches'
import type { PortalReviewsBlock } from '@/lib/reviews'

type BranchRow = {
  id: string
  slug: string
  name: Record<string, string>
  nav_google_maps: string | null
  nav_waze: string | null
  nav_apple_maps: string | null
  instagram_url: string | null
  review_url: string | null
  bit_url: string | null
  reviews: PortalReviewsBlock | null
}

const COLUMNS =
  'id, slug, name, nav_google_maps, nav_waze, nav_apple_maps, instagram_url, review_url, bit_url, reviews'

function toBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    slug: row.slug,
    name: { he: row.name.he ?? row.slug, en: row.name.en, ar: row.name.ar },
    links: {
      navGoogleMaps: row.nav_google_maps,
      navWaze: row.nav_waze,
      navAppleMaps: row.nav_apple_maps,
      instagram: row.instagram_url,
      review: row.review_url,
      bit: row.bit_url,
    },
    reviews: row.reviews ?? null,
  }
}

/** Server-side read of every active branch, ordered the way they were
 * created (so a newly-added branch lands at the end, not alphabetically
 * reshuffling the switcher). Branches are public-read (see
 * 000_core_schema.sql) so the plain session-scoped client is fine here —
 * no service-role needed just to list them. */
export async function getBranches(): Promise<Branch[]> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('branches')
    .select(COLUMNS)
    .eq('active', true)
    .order('created_at', { ascending: true })
  return ((data as BranchRow[] | null) ?? []).map(toBranch)
}

export async function getBranchBySlug(slug: string): Promise<Branch | null> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('branches')
    .select(COLUMNS)
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle()
  return data ? toBranch(data as BranchRow) : null
}
