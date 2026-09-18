// The POS order domain model — see supabase/migrations/017_pos_orders.sql
// for the schema these mirror. Order content (item/type names) is a
// Localized snapshot taken at order time, same discipline the customer
// cart's CartLine already uses (lib/cart/types.ts) and for the same
// reason: the menu can be republished mid-shift, an order must not
// silently rename itself.

import type { Localized } from '@/lib/menu/types'

export type OrderStatus = 'new' | 'preparing' | 'ready' | 'completed' | 'cancelled'
export type PaymentStatus = 'unpaid' | 'paid'
export type PaymentMethod = 'cash' | 'card' | 'bit' | 'other'

export const ACTIVE_STATUSES: OrderStatus[] = ['new', 'preparing', 'ready']

export type OrderItem = {
  id: string
  itemUid: string
  itemName: Localized
  typeUid: string | null
  typeName: Localized | null
  unitPrice: number
  quantity: number
  lineTotal: number
  notes: string | null
}

export type Order = {
  id: string
  branchId: string
  orderNumber: number
  status: OrderStatus
  customerName: string | null
  notes: string | null
  subtotal: number
  total: number
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod | null
  createdByName: string | null
  cancelReason: string | null
  createdAt: string
  startedAt: string | null
  readyAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  items: OrderItem[]
}

/** What the customer's own tracking page gets back from
 *  /api/order/[token] — the staff-only fields (who took the order, any
 *  internal order-level note) are never sent there. */
export type CustomerOrder = Omit<Order, 'createdByName' | 'notes'>

export type OrdersBoard = {
  branchId: string
  /** new/preparing/ready, oldest first — the working queue. */
  active: Order[]
  /** Today's completed/cancelled, newest first — reference only. */
  history: Order[]
  viewerCanCancel: boolean
  viewerStaffId: string
}

/** The plaintext access pair — exists ONLY in a create_order()/
 *  issue_order_access() RPC response, never persisted (see migration
 *  018's header). Shown to staff exactly once per issuance, for the
 *  receipt (QR + printed code); a lost/failed print means reprinting via
 *  the 'regenerateAccess' action, which issues a fresh pair and silently
 *  invalidates the old one. */
export type OrderAccess = {
  token: string
  recoveryCode: string
  expiresAt: string
}
