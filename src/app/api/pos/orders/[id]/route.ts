import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { editOrderBody, type EditOrderResponse } from '@/lib/pos/api'
import { RATE } from '@/lib/pos/vocab'
import { normalizeCustomerFields } from '@/lib/pos/server/lines'
import {
  callPosRpc, loadOrderInBranch, parseBody, posJson, rateLimit, requirePosStaff, rpcFailure,
} from '@/lib/pos/server/guard'

// PATCH /api/pos/orders/[id] — fix a typo in an order's customer name, phone, receipt
// number or note (never its items: those are void-and-re-add, because the database
// refuses to edit what was sold).
//
// Trust model. requirePosStaff supplies the actor; the order id from the URL is proven
// to be inside the approved branch first. This is cleanup, not new work, so it is NOT
// gated on the POS being switched on (blueprint §7.5). Semantics of the optional fields:
// ABSENT = leave as it is, null or empty = clear it. pos_edit_order wants all four
// customer fields every time, so the unchanged ones are filled in from the current row.
// That row's phone is read only to be handed straight back to the RPC — it is never
// logged and never returned (the editor's screen already holds it, read over its own
// RLS-protected table access). The audit event records THAT the phone changed, never
// what it was.

export const PATCH = apiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await parseBody(request, editOrderBody)
  const actor = await requirePosStaff(body.branchId, { requireEnabled: false })
  await rateLimit('edit', actor.staff.id, RATE.createOrderPerMin)

  const current = await loadOrderInBranch<{
    customer_phone: string | null
    receipt_ref: string | null
    note: string | null
  }>(id, actor.branch.id, 'customer_phone, receipt_ref, note')

  const customer = normalizeCustomerFields({
    customerName: body.customerName,
    customerPhone: body.customerPhone === undefined ? current.customer_phone : body.customerPhone,
    receiptRef: body.receiptRef === undefined ? current.receipt_ref : body.receiptRef,
    note: body.note === undefined ? current.note : body.note,
  })

  const result = await callPosRpc<{ ok: boolean; reason?: string }>('pos_edit_order', {
    p_staff: actor.staff.id,
    p_order: id,
    p_customer_name: customer.name,
    p_customer_phone: customer.phone,
    p_note: customer.note,
    p_receipt_ref: customer.receiptRef,
  })
  if (!result.ok) throw rpcFailure(result.reason)

  const response: EditOrderResponse = { ok: true }
  return posJson(response)
})
