import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { ordersQuery } from '@/lib/pos/owner-api'
import { parseQuery, posJson, requirePosManager } from '@/lib/pos/server/guard'
import { readOrdersPage } from '@/lib/pos/server/details'
import { createServiceRoleClient } from '@/lib/supabase/server'

// GET /api/owner/pos/orders — order history, newest first, 50 a page (cursor).
// Filters: session, status, point, who entered it, free text (name / phone digits /
// "#42" / receipt number), a date range in the branch's zone. Practice orders are left
// out unless asked for. Manager-only, because rows carry the customer's phone.
//
// The free text is sanitised inside readOrdersPage so a search box can never add a
// condition to the query; a failed read is an error, never an empty list.

export const GET = apiRoute(async (request: NextRequest) => {
  const q = parseQuery(new URL(request.url), ordersQuery)
  const actor = await requirePosManager(q.branch)
  return posJson(await readOrdersPage(createServiceRoleClient(), actor.branch, q))
})
