import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { branchQuery } from '@/lib/pos/owner-api'
import { parseQuery, posJson, requirePosManager } from '@/lib/pos/server/guard'
import { readDashboard } from '@/lib/pos/server/signals'
import { createServiceRoleClient } from '@/lib/supabase/server'

// GET /api/owner/pos/dashboard?branch= — the live picture. Manager-only.
//
// Polled on a timer AND refetched whenever the realtime channel nudges, so it must stay
// cheap: every read inside readDashboard() runs in parallel and each one swallows its own
// failure (a broken query greys its own number with known:false, never a confident 0 and
// never a failed page). The numbers are computed from the same row arrays the drill-down
// lists come from, so a count and its list cannot disagree. Contains the phone numbers of
// uncollected orders (so someone can ring), hence no-store.

export const GET = apiRoute(async (request: NextRequest) => {
  const q = parseQuery(new URL(request.url), branchQuery)
  const actor = await requirePosManager(q.branch)
  return posJson(await readDashboard(createServiceRoleClient(), actor.branch))
})
