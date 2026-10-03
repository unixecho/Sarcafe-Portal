import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getBranchOpenStates, type BranchOpenState } from '@/lib/shifts/hours'
import type { Branch } from '@/lib/branches'
import type { PortalReviewsBlock } from '@/lib/reviews'

type BranchRow = {
  id: string
  slug: string
  name: Record<string, string>
  kind?: string | null
  timezone: string
  nav_google_maps: string | null
  nav_waze: string | null
  nav_apple_maps: string | null
  instagram_url: string | null
  review_url: string | null
  bit_url: string | null
  reviews: PortalReviewsBlock | null
}

const BASE_COLUMNS =
  'id, slug, name, timezone, nav_google_maps, nav_waze, nav_apple_maps, instagram_url, review_url, bit_url, reviews'
const COLUMNS = `${BASE_COLUMNS}, kind`

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
    kind: row.kind === 'event' ? 'event' : 'permanent',
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

/** Postgres "undefined column" — what PostgREST relays when `branches.kind` does not exist yet. */
function isMissingKindColumn(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === '42703' || /\bkind\b/.test(error.message ?? ''))
}

/**
 * The one read of the `branches` table. `kind` arrived with the POS migration (020);
 * until that migration is applied the column does not exist and a select that names it
 * fails — which would turn into an EMPTY branch list and blank the public portal. So if
 * the first attempt fails because `kind` is missing, it is retried without it and every
 * branch is treated as permanent (correct: no event can exist before the column does).
 * Once the migration is in, the first attempt always succeeds and the retry is dead code.
 */
async function readBranches(slug: string | null, includeEvents: boolean): Promise<BranchRow[]> {
  const supabase = await createServerSupabaseClient()

  const attempt = async (withKind: boolean) => {
    let query = supabase.from('branches').select(withKind ? COLUMNS : BASE_COLUMNS).eq('active', true)
    if (slug !== null) query = query.eq('slug', slug)
    if (withKind && !includeEvents) query = query.neq('kind', 'event')
    return query.order('created_at', { ascending: true })
  }

  let { data, error } = await attempt(true)
  if (error && isMissingKindColumn(error)) ({ data, error } = await attempt(false))
  return (data as unknown as BranchRow[] | null) ?? []
}

/** Server-side read of every active branch, ordered the way they were
 * created (so a newly-added branch lands at the end, not alphabetically
 * reshuffling the switcher). Branches are public-read (see
 * 000_core_schema.sql) so the plain session-scoped client is fine here —
 * no service-role needed just to list them.
 *
 * EVENT branches (kind = 'event': a one-off stall the POS trades at) are EXCLUDED by
 * default, so a caller that forgets the option fails safe: the public portal, the
 * public GET /api/branches and the menu's branch switcher can never list one. Every
 * owner/staff page that must keep seeing events — the menu editor, the schedule, the
 * audit log — passes `{ includeEvents: true }` explicitly. */
export async function getBranches(opts: { includeEvents?: boolean } = {}): Promise<Branch[]> {
  const rows = await readBranches(null, opts.includeEvents === true)
  const openStates = await getBranchOpenStates(rows.map((r) => ({ id: r.id, timezone: r.timezone })))
  return rows.map((row) => toBranch(row, openStates[row.id]))
}

/** One branch by slug, events INCLUDED on purpose: an event's own menu link
 * (/menu/<slug>, printed on a QR at the stall) must keep working — it is simply never
 * advertised in a list. */
export async function getBranchBySlug(slug: string): Promise<Branch | null> {
  const rows = await readBranches(slug, true)
  const row = rows[0]
  if (!row) return null
  const openStates = await getBranchOpenStates([{ id: row.id, timezone: row.timezone }])
  return toBranch(row, openStates[row.id])
}
