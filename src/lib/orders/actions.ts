// One action union, shared between the client provider and the server
// dispatch handler — same "one action = one thing that can happen" shape
// lib/shifts/actions.ts uses. Every dispatch is a round trip (POST
// /api/orders/dispatch, await, replace state with the server's fresh
// read), same deliberate trade-off shifts already documents.

import type { Localized } from '@/lib/menu/types'
import type { OrderStatus, PaymentMethod, PaymentStatus } from './types'

export type OrderLineInput = {
  itemUid: string
  itemName: Localized
  typeUid?: string | null
  typeName?: Localized | null
  /** Staff-entered/confirmed at add-time — see migration 017's header for
   *  why this is never derived server-side from the menu doc. */
  unitPrice: number
  quantity: number
  notes?: string | null
}

export type OrderAction =
  | {
      type: 'createOrder'
      branch: string
      customerName?: string | null
      notes?: string | null
      paymentMethod?: PaymentMethod | null
      items: OrderLineInput[]
    }
  | { type: 'advanceStatus'; orderId: string; toStatus: OrderStatus }
  | { type: 'cancelOrder'; orderId: string; reason?: string | null }
  | { type: 'setPayment'; orderId: string; status: PaymentStatus; method?: PaymentMethod | null }
  /** Reprint: issues a fresh QR token + recovery code for an order whose
   *  receipt didn't print, got lost, or needs a second copy — see
   *  migration 018's issue_order_access(). Invalidates the old pair. */
  | { type: 'regenerateAccess'; orderId: string }

export type OrderActionType = OrderAction['type']
