import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { branchQuery, orderParams } from '@/lib/pos/owner-api'
import { parseQuery, posError, posJson, requirePosManager } from '@/lib/pos/server/guard'
import { readOrderDetail } from '@/lib/pos/server/details'
import { createServiceRoleClient } from '@/lib/supabase/server'

// GET /api/owner/pos/orders/[id]?branch= — one order: its lines, its whole timeline, and
// who touched it (handles; emails appear here, for managers, and nowhere else).
//
// The order is looked up INSIDE the branch the guard approved, so a manager of one event
// asking for another event's order id gets the same 404 as for an id that does not exist.

export const GET = apiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const parsedId = orderParams.safeParse(await params)
  if (!parsedId.success) throw posError('not_found')
  const q = parseQuery(new URL(request.url), branchQuery)
  const actor = await requirePosManager(q.branch)
  const detail = await readOrderDetail(createServiceRoleClient(), actor.branch, parsedId.data.id)
  if (!detail) throw posError('not_found')
  return posJson(detail)
})
