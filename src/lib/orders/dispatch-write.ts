// Server-only write path. One switch over every OrderAction — each case
// resolves the branch a target order belongs to (when the action doesn't
// already carry it), authorizes via requireOrderStaff()/requireOrderManager()
// (never trusting the client's own idea of who it is), then performs the
// write via the migration 017/018 RPCs, mirroring lib/shifts/dispatch-write.ts.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { BadRequest, NotFound } from '@/lib/http/errors'
import { requireOrderStaff, requireOrderManager } from './guard'
import { broadcastOrdersUpdated, broadcastOrderStatusChanged } from './realtime'
import { notifyOrderReady } from '@/lib/push/send'
import type { OrderAction } from './actions'
import type { OrderAccess } from './types'

type Service = ReturnType<typeof createServiceRoleClient>

type OrderRouting = { branchId: string; branchSlug: string; orderNumber: number }

async function loadOrderRouting(service: Service, orderId: string): Promise<OrderRouting> {
  const { data: order } = await service.from('orders').select('branch_id, order_number').eq('id', orderId).maybeSingle()
  if (!order) throw NotFound('Order not found.')
  const { data: branch } = await service.from('branches').select('slug').eq('id', order.branch_id).maybeSingle()
  return { branchId: order.branch_id as string, branchSlug: (branch?.slug as string) ?? '', orderNumber: order.order_number as number }
}

export type DispatchResult = { orderId?: string; orderNumber?: number; access?: OrderAccess }

export async function performOrderDispatch(action: OrderAction): Promise<DispatchResult> {
  const service = createServiceRoleClient()

  switch (action.type) {
    case 'createOrder': {
      if (!action.items || action.items.length === 0) throw BadRequest('An order needs at least one item.')
      if (action.items.length > 60) throw BadRequest('Too many lines for one order.')

      const { data: branch } = await service.from('branches').select('id').eq('slug', action.branch).maybeSingle()
      if (!branch) throw NotFound('Branch not found.')

      const staff = await requireOrderStaff(branch.id)

      for (const line of action.items) {
        if (!line.itemUid) throw BadRequest('Invalid order line.')
        if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) throw BadRequest('Invalid price.')
        if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 50) throw BadRequest('Invalid quantity.')
      }

      const staffName = staff.display_name || [staff.first_name, staff.last_name].filter(Boolean).join(' ') || staff.email || null

      const { data, error } = await service.rpc('create_order', {
        p_branch_id: branch.id,
        p_created_by: staff.id,
        p_created_by_name: staffName,
        p_customer_name: action.customerName ?? null,
        p_notes: action.notes ?? null,
        p_payment_method: action.paymentMethod ?? null,
        p_items: action.items.map((line) => ({
          itemUid: line.itemUid,
          itemName: line.itemName ?? {},
          typeUid: line.typeUid ?? null,
          typeName: line.typeName ?? null,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
          notes: line.notes ?? null,
        })),
      })
      if (error || !data?.[0]) throw BadRequest(error?.message ?? 'Could not create the order.')

      const row = data[0] as { id: string; order_number: number; token: string; recovery_code: string; expires_at: string }

      await broadcastOrdersUpdated(action.branch)
      return {
        orderId: row.id,
        orderNumber: row.order_number,
        access: { token: row.token, recoveryCode: row.recovery_code, expiresAt: row.expires_at },
      }
    }

    case 'advanceStatus': {
      const { branchId, branchSlug, orderNumber } = await loadOrderRouting(service, action.orderId)
      await requireOrderStaff(branchId)
      const { error } = await service.rpc('advance_order_status', { p_order_id: action.orderId, p_to_status: action.toStatus })
      if (error) throw BadRequest(error.message || 'Could not update the order.')

      await Promise.all([broadcastOrdersUpdated(branchSlug), broadcastOrderStatusChanged(action.orderId)])
      // Fire-and-forget on purpose — see lib/push/send.ts's own header for
      // why a push failure must never surface as a failed status update.
      if (action.toStatus === 'ready') void notifyOrderReady(action.orderId, orderNumber)
      return {}
    }

    case 'cancelOrder': {
      const { branchId, branchSlug } = await loadOrderRouting(service, action.orderId)
      const staff = await requireOrderManager(branchId)
      const { error } = await service.rpc('cancel_order', {
        p_order_id: action.orderId,
        p_cancelled_by: staff.id,
        p_reason: action.reason ?? null,
      })
      if (error) throw BadRequest(error.message || 'Could not cancel the order.')
      await Promise.all([broadcastOrdersUpdated(branchSlug), broadcastOrderStatusChanged(action.orderId)])
      return {}
    }

    case 'setPayment': {
      const { branchId, branchSlug } = await loadOrderRouting(service, action.orderId)
      await requireOrderStaff(branchId)
      const { error } = await service.rpc('set_order_payment', {
        p_order_id: action.orderId,
        p_status: action.status,
        p_method: action.method ?? null,
      })
      if (error) throw BadRequest(error.message || 'Could not update payment.')
      await broadcastOrdersUpdated(branchSlug)
      return {}
    }

    case 'regenerateAccess': {
      const { branchId } = await loadOrderRouting(service, action.orderId)
      await requireOrderStaff(branchId)
      const { data, error } = await service.rpc('issue_order_access', { p_order_id: action.orderId })
      if (error || !data?.[0]) throw BadRequest(error?.message ?? 'Could not reissue the receipt.')
      const row = data[0] as { token: string; recovery_code: string; expires_at: string }
      return { orderId: action.orderId, access: { token: row.token, recoveryCode: row.recovery_code, expiresAt: row.expires_at } }
    }

    default: {
      const _exhaustive: never = action
      throw BadRequest(`Unknown action: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
