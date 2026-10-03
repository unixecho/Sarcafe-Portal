import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { addItemsBody, type AddItemsResponse } from '@/lib/pos/api'
import { RATE } from '@/lib/pos/vocab'
import { problemToApiError, resolveLines } from '@/lib/pos/server/lines'
import {
  callPosRpc, loadOrderInBranch, parseBody, posError, posJson, rateLimit, requirePosStaff, rpcFailure,
} from '@/lib/pos/server/guard'

// POST /api/pos/orders/[id]/items — add more items to an order that already exists
// ("and one more coffee"). The new lines arrive at their points flagged as an addition
// (the RPC numbers them as a later batch) and a completed order is reopened.
//
// Trust model. Same as order creation: requirePosStaff supplies the actor, the body
// carries ids and counts only, and every price / name / destination point is resolved
// server-side from the published menu. On top of that the ORDER ID comes from the URL,
// so it is proven to belong to the branch the guard approved (loadOrderInBranch)
// before the RPC — which trusts any id it is handed — ever sees it. Adding is new work,
// so the POS must be switched on; it is not tied to an open session (an order that
// already exists can still be added to while the event is being wound down).

export const POST = apiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await parseBody(request, addItemsBody)
  const actor = await requirePosStaff(body.branchId)
  await rateLimit('add', actor.staff.id, RATE.createOrderPerMin)

  const order = await loadOrderInBranch<{ status: string }>(id, actor.branch.id, 'status')
  if (order.status === 'void') throw posError('order_void')

  const resolved = await resolveLines(body.lines, actor.branch.id)
  if (!resolved.ok) throw problemToApiError(resolved.problem, resolved.index)

  const result = await callPosRpc<{ ok: boolean; reason?: string; added?: number; total_agorot?: number }>('pos_add_items', {
    p_staff: actor.staff.id,
    p_order: id,
    p_lines: resolved.lines,
  })
  if (!result.ok) throw rpcFailure(result.reason)
  if (typeof result.added !== 'number' || typeof result.total_agorot !== 'number') {
    console.error('pos_add_items answered ok without counts')
    throw posError('internal_error')
  }

  const response: AddItemsResponse = { ok: true, added: result.added, totalAgorot: result.total_agorot }
  return posJson(response)
})
