import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { branchQuery } from '@/lib/pos/owner-api'
import { parseQuery, posJson, requirePosManager } from '@/lib/pos/server/guard'
import { readSetupState } from '@/lib/pos/server/readiness'
import { createServiceRoleClient } from '@/lib/supabase/server'

// GET /api/owner/pos/setup?branch= — the whole checklist for one event: is it switched
// on, is the menu published, which points exist, is everything routed, who is on the
// team, the Ready-board link, and the open/closed state. Manager-only.
//
// The response carries the Ready-board's secret link, which is why it is never cached
// and why the guard is the manager guard rather than the staff one. Each row inside is
// its own independent read (see readiness.ts), so one broken query greys one row.

export const GET = apiRoute(async (request: NextRequest) => {
  const q = parseQuery(new URL(request.url), branchQuery)
  const actor = await requirePosManager(q.branch)
  const state = await readSetupState(createServiceRoleClient(), actor.branch)
  return posJson(state)
})
