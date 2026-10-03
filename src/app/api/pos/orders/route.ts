import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { createOrderBody, type CreateOrderResponse } from '@/lib/pos/api'
import { RATE } from '@/lib/pos/vocab'
import { normalizeCustomerFields, problemToApiError, resolveLines } from '@/lib/pos/server/lines'
import { callPosRpc, parseBody, posError, posJson, rateLimit, requirePosStaff, rpcFailure } from '@/lib/pos/server/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'

// POST /api/pos/orders — a cashier sends an order they have just typed from the HYP slip.
//
// Trust model. The customer has ALREADY PAID when this arrives, so losing or doubling an
// order is the worst thing this route can do. Hence:
//   * ACTOR: requirePosStaff (active staff, may work this branch, POS on, nickname
//     confirmed). The actor is passed to the RPC as p_staff and is never read from the
//     body — the strict schema would reject a body that tried.
//   * IDEMPOTENT on clientKey, checked BEFORE the lines are priced. A retry after a lost
//     response must return the original order even if, in the meantime, an item sold out
//     or was repriced: re-pricing it first would refuse a retry for an order that already
//     exists and strand the cashier with a "failed" order the customer has paid for. The
//     RPC repeats the same check inside its transaction, which is what settles a race.
//   * PRICE, NAME, ROUTE, EVERY MODIFIER LABEL come from the published menu and the
//     owner's routing (resolveLines), never from the browser. The body carries ids
//     and counts only.
//   * The customer's phone is personal data: normalised here, handed to the RPC, and
//     never logged, echoed, or placed in an error.

export const POST = apiRoute(async (request: NextRequest) => {
  const body = await parseBody(request, createOrderBody)
  const actor = await requirePosStaff(body.branchId)

  // 1. Already sent? Answer with the original, whatever the menu looks like now. (The rate
  //    check rides along in parallel — both are one cheap query, and the till is waiting.)
  const service = createServiceRoleClient()
  const [, { data: existing, error: existingError }] = await Promise.all([
    rateLimit('create', actor.staff.id, RATE.createOrderPerMin),
    service
      .from('pos_orders')
      .select('id, ticket_no, total_agorot')
      .eq('branch_id', actor.branch.id)
      .eq('client_key', body.clientKey)
      .maybeSingle(),
  ])
  if (existingError) {
    console.error('pos_orders idempotency read failed:', existingError.code)
    throw posError('internal_error')
  }
  if (existing) {
    const o = existing as { id: string; ticket_no: number; total_agorot: number }
    const done: CreateOrderResponse = { ok: true, deduped: true, order: { id: o.id, ticketNo: o.ticket_no, totalAgorot: o.total_agorot } }
    return posJson(done)
  }

  // 2. The customer block (a refusal here is 'bad_customer', the database's own word).
  const customer = normalizeCustomerFields(body)

  // 3. Price + route every line, server-side.
  const resolved = await resolveLines(body.lines, actor.branch.id)
  if (!resolved.ok) throw problemToApiError(resolved.problem, resolved.index)

  // 4. One transaction: number, order, lines, total, audit event.
  const result = await callPosRpc<{
    ok: boolean
    reason?: string
    deduped?: boolean
    order_id?: string
    ticket_no?: number
    total_agorot?: number
  }>('pos_create_order', {
    p_staff: actor.staff.id,
    p_branch: actor.branch.id,
    p_client_key: body.clientKey,
    p_customer_name: customer.name,
    p_customer_phone: customer.phone,
    p_receipt_ref: customer.receiptRef,
    p_slip_total_agorot: body.slipTotalAgorot ?? null,
    p_note: customer.note,
    p_lines: resolved.lines,
  })
  if (!result.ok) throw rpcFailure(result.reason)
  if (!result.order_id || typeof result.ticket_no !== 'number' || typeof result.total_agorot !== 'number') {
    console.error('pos_create_order answered ok without an order')
    throw posError('internal_error')
  }

  const response: CreateOrderResponse = {
    ok: true,
    deduped: result.deduped === true,
    order: { id: result.order_id, ticketNo: result.ticket_no, totalAgorot: result.total_agorot },
  }
  return posJson(response)
})
