import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getBranchOpenStates, type BranchOpenState } from '@/lib/shifts/hours'
import type { Branch } from '@/lib/branches'
import type { PortalReviewsBlock } from '@/lib/reviews'

type BranchRow = {
  id: string
  slug: string
  name: Record<string, string>
  timezone: string
  nav_google_maps: string | null
  nav_waze: string | null
  nav_apple_maps: string | null
  instagram_url: string | null
  review_url: string | null
  bit_url: string | null
  reviews: PortalReviewsBlock | null
}

const COLUMNS =
  'id, slug, name, timezone, nav_google_maps, nav_waze, nav_apple_maps, instagram_url, review_url, bit_url, reviews'

// shift_settings (the operating-hours source) is staff-only under RLS —
// getBranchOpenStates reads it via the service-role client internally, so
// this stays the one place branches/server.ts reaches past the caller's own
// session, purely to compute a public-safe derived value (today's hours +
// open-now), never to expose the settings row itself.
const UNCONFIGURED_OPEN_STATE: BranchOpenState = { hoursToday: null, openNow: true }

function toBranch(row: BranchRow, openState: BranchOpenState | undefined): Branch {
  const state = openState ?? UNCONFIGURED_OPEN_STATE
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
    hoursToday: state.hoursToday,
    openNow: state.openNow,
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
  const rows = (data as BranchRow[] | null) ?? []
  const openStates = await getBranchOpenStates(rows.map((r) => ({ id: r.id, timezone: r.timezone })))
  return rows.map((row) => toBranch(row, openStates[row.id]))
}

export async function getBranchBySlug(slug: string): Promise<Branch | null> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('branches')
    .select(COLUMNS)
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle()
  if (!data) return null
  const row = data as BranchRow
  const openStates = await getBranchOpenStates([{ id: row.id, timezone: row.timezone }])
  return toBranch(row, openStates[row.id])
}
