import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { logQuery } from '@/lib/pos/owner-api'
import { parseQuery, posJson, requirePosManager } from '@/lib/pos/server/guard'
import { readLogPage } from '@/lib/pos/server/log'
import { createServiceRoleClient } from '@/lib/supabase/server'

// GET /api/owner/pos/log — the audit log: everything that happened, newest first.
// Manager-only (the actor's email is shown here). Filters: event types, who, which
// point, a date range; practice events are left out unless asked for.

export const GET = apiRoute(async (request: NextRequest) => {
  const q = parseQuery(new URL(request.url), logQuery)
  const actor = await requirePosManager(q.branch)
  return posJson(await readLogPage(createServiceRoleClient(), actor.branch, q))
})
