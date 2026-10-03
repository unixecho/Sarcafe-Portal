// Server-side read for the order board — one query for active orders, one
// for today's-ish history (most recent 30 completed/cancelled, reference
// only), one for all their line items. Snake_case DB rows -> camelCase
// domain types, same division of labor lib/shifts/serialize.ts uses for
// the scheduling feature.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { canCancelOrder } from './access'
import type { StaffRow } from '@/lib/owner/guard'
import { ACTIVE_STATUSES, type Order, type OrderItem, type OrdersBoard } from './types'

type OrderRow = {
  id: string
  branch_id: string
  order_number: number
  status: string
  customer_name: string | null
  notes: string | null
  subtotal: string | number
  total: string | number
  payment_status: string
  payment_method: string | null
  created_by_name: string | null
  cancel_reason: string | null
  created_at: string
  started_at: string | null
  ready_at: string | null
  completed_at: string | null
  cancelled_at: string | null
}

type OrderItemRow = {
  id: string
  order_id: string
  item_uid: string
  item_name: Record<string, string> | null
  type_uid: string | null
  type_name: Record<string, string> | null
  unit_price: string | number
  quantity: number
  line_total: string | number
  notes: string | null
}

function serializeItem(row: OrderItemRow): OrderItem {
  return {
    id: row.id,
    itemUid: row.item_uid,
    itemName: row.item_name ?? {},
    typeUid: row.type_uid,
    typeName: row.type_name,
    unitPrice: Number(row.unit_price),
    quantity: row.quantity,
    lineTotal: Number(row.line_total),
    notes: row.notes,
  }
}

function serializeOrder(row: OrderRow, items: OrderItem[]): Order {
  return {
    id: row.id,
    branchId: row.branch_id,
    orderNumber: row.order_number,
    status: row.status as Order['status'],
    customerName: row.customer_name,
    notes: row.notes,
    subtotal: Number(row.subtotal),
    total: Number(row.total),
    paymentStatus: row.payment_status as Order['paymentStatus'],
    paymentMethod: row.payment_method as Order['paymentMethod'],
    createdByName: row.created_by_name,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
    startedAt: row.started_at,
    readyAt: row.ready_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    items,
  }
}

/** One order by id, items included — the customer-tracking read path
 *  (/api/order/[token]) as well as anything else that needs a single
 *  order's full shape. No viewer/permission fields (those are staff-board
 *  concepts) — callers that need an access check do it themselves before
 *  calling this (see lib/orders/customer.ts's token resolution). */
export async function loadOrderById(orderId: string): Promise<Order | null> {
  const service = createServiceRoleClient()

  const [{ data: orderRow }, { data: itemRows }] = await Promise.all([
    service.from('orders').select('*').eq('id', orderId).maybeSingle(),
    service.from('order_items').select('*').eq('order_id', orderId).order('sort_order', { ascending: true }),
  ])

  if (!orderRow) return null
  return serializeOrder(orderRow as OrderRow, ((itemRows as OrderItemRow[]) ?? []).map(serializeItem))
}

export async function loadOrdersBoard(branchId: string, viewer: StaffRow): Promise<OrdersBoard> {
  const service = createServiceRoleClient()

  const [{ data: activeRows }, { data: historyRows }] = await Promise.all([
    service
      .from('orders')
      .select('*')
      .eq('branch_id', branchId)
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: true }),
    service
      .from('orders')
      .select('*')
      .eq('branch_id', branchId)
      .in('status', ['completed', 'cancelled'])
      .order('updated_at', { ascending: false })
      .limit(30),
  ])

  const allRows = [...((activeRows as OrderRow[]) ?? []), ...((historyRows as OrderRow[]) ?? [])]
  const allIds = allRows.map((o) => o.id)

  const { data: itemRows } = allIds.length
    ? await service.from('order_items').select('*').in('order_id', allIds).order('sort_order', { ascending: true })
    : { data: [] as OrderItemRow[] }

  const itemsByOrder = new Map<string, OrderItem[]>()
  for (const row of (itemRows as OrderItemRow[]) ?? []) {
    const list = itemsByOrder.get(row.order_id) ?? []
    list.push(serializeItem(row))
    itemsByOrder.set(row.order_id, list)
  }

  return {
    branchId,
    active: ((activeRows as OrderRow[]) ?? []).map((row) => serializeOrder(row, itemsByOrder.get(row.id) ?? [])),
    history: ((historyRows as OrderRow[]) ?? []).map((row) => serializeOrder(row, itemsByOrder.get(row.id) ?? [])),
    viewerCanCancel: canCancelOrder(viewer, branchId),
    viewerStaffId: viewer.id,
  }
}
