import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { statsQuery } from '@/lib/pos/owner-api'
import { parseQuery, posJson, requirePosManager } from '@/lib/pos/server/guard'
import { readStats } from '@/lib/pos/server/stats'
import { createServiceRoleClient } from '@/lib/supabase/server'

// GET /api/owner/pos/stats — the numbers behind the event (all fourteen metrics).
// Manager-only. Computed in TypeScript from the stamped columns (rows are paged through,
// since the database caps a response at 1000); practice sessions are excluded unless
// `training=1`. Each metric is its own read with its own known flag.

export const GET = apiRoute(async (request: NextRequest) => {
  const q = parseQuery(new URL(request.url), statsQuery)
  const actor = await requirePosManager(q.branch)
  return posJson(await readStats(createServiceRoleClient(), actor.branch, q))
})
