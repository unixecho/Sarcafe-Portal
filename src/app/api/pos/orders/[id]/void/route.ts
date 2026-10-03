import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { voidBody, type VoidResponse } from '@/lib/pos/api'
import { RATE } from '@/lib/pos/vocab'
import {
  callPosRpc, loadOrderInBranch, parseBody, posError, posJson, rateLimit, requirePosStaff, rpcFailure,
} from '@/lib/pos/server/guard'

// POST /api/pos/orders/[id]/void — cancel some lines of an order, or the whole order
// (itemIds omitted/null = every line that has not been handed over).
//
// Trust model. requirePosStaff supplies the actor; the order id from the URL is proven
// to be inside the approved branch first. Voiding is cleanup, so it works whether or not
// the POS is switched on or an event is open (blueprint §7.5). A reason is REQUIRED —
// the audit log has to be able to say why. Who may void WHAT is decided here, not by
// the browser: anyone may void a line that is still in flight, but a line that has
// already been HANDED OVER can only be voided by a manager, because by then the
// customer has the thing. That is the p_manager flag; for everyone else the RPC leaves
// delivered lines alone and reports them as `skipped`, which is how the screen tells
// the person "that one has already gone out" rather than failing the whole request.
// Line ids that belong to a different order simply do not match inside the RPC (it
// filters by order), so they cannot reach another order's lines.

export const POST = apiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await parseBody(request, voidBody)
  const actor = await requirePosStaff(body.branchId, { requireEnabled: false })
  await rateLimit('void', actor.staff.id, RATE.voidPerMin)

  const reason = body.reason.trim().replace(/\s+/g, ' ')
  if (reason === '') throw posError('bad_reason')

  await loadOrderInBranch(id, actor.branch.id, 'status')

  const result = await callPosRpc<{
    ok: boolean
    reason?: string
    voided?: string[]
    skipped?: string[]
    order_status?: string
  }>('pos_void_items', {
    p_staff: actor.staff.id,
    p_order: id,
    p_item_ids: body.itemIds ?? null,
    p_reason: reason,
    p_manager: actor.isManager,
  })
  if (!result.ok) throw rpcFailure(result.reason)

  const response: VoidResponse = {
    ok: true,
    voided: result.voided ?? [],
    skipped: result.skipped ?? [],
    orderStatus: result.order_status ?? 'open',
  }
  return posJson(response)
})
