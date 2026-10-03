'use client'

import { useState, type CSSProperties } from 'react'
import { ChevronDown } from 'lucide-react'
import PromptSheet, { type PromptRequest } from '@/components/PromptSheet'
import { haptic } from '@/lib/haptics'
import { useOrders } from './OrdersProvider'
import OrderCard from './OrderCard'
import type { ReceiptData } from './ReceiptSheet'
import type { Order, OrderStatus } from '@/lib/orders/types'

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = { new: 'preparing', preparing: 'ready', ready: 'completed' }

// The live queue — every active order at this branch, oldest first (first
// in, first served), plus a collapsed disclosure for today's completed/
// cancelled history. Reads/writes go through OrdersProvider's context, so
// this never talks to the API directly.
export default function OrderBoard({ onReceipt }: { onReceipt: (receipt: ReceiptData) => void }) {
  const { board, loading, dispatch } = useOrders()
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  if (!board) {
    return loading ? <p style={emptyStyle}>טוען הזמנות…</p> : null
  }

  async function advance(order: Order) {
    const next = NEXT_STATUS[order.status]
    if (!next) return
    haptic('select')
    setBusyId(order.id)
    await dispatch({ type: 'advanceStatus', orderId: order.id, toStatus: next })
    setBusyId(null)
  }

  async function togglePayment(order: Order) {
    setBusyId(order.id)
    await dispatch({ type: 'setPayment', orderId: order.id, status: order.paymentStatus === 'paid' ? 'unpaid' : 'paid' })
    setBusyId(null)
  }

  async function confirmCancel(reason: string) {
    const order = cancelTarget
    setCancelTarget(null)
    if (!order) return
    haptic('impact')
    setBusyId(order.id)
    await dispatch({ type: 'cancelOrder', orderId: order.id, reason: reason || null })
    setBusyId(null)
  }

  async function reprint(order: Order) {
    haptic('select')
    setBusyId(order.id)
    const outcome = await dispatch({ type: 'regenerateAccess', orderId: order.id })
    setBusyId(null)
    if (outcome.ok && outcome.access) {
      onReceipt({
        orderNumber: order.orderNumber,
        access: outcome.access,
        lines: order.items.map((item) => ({
          label: item.typeName?.he ? `${item.itemName.he || '—'} — ${item.typeName.he}` : item.itemName.he || '—',
          qty: item.quantity,
          unitPrice: item.unitPrice,
        })),
        total: order.total,
      })
    }
  }

  const cancelRequest: PromptRequest | null = cancelTarget
    ? { title: `ביטול הזמנה #${cancelTarget.orderNumber}`, label: 'סיבת הביטול', submitLabel: 'ביטול ההזמנה', cancelLabel: 'חזרה', allowEmpty: true }
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {board.active.length === 0 ? (
        <p style={emptyStyle}>אין הזמנות פעילות כרגע.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {board.active.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              canCancel={board.viewerCanCancel}
              busy={busyId === order.id}
              onAdvance={() => advance(order)}
              onCancel={() => setCancelTarget(order)}
              onTogglePayment={() => togglePayment(order)}
              onReprint={() => reprint(order)}
            />
          ))}
        </div>
      )}

      {board.history.length > 0 && (
        <div>
          <button type="button" className="press" onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen} style={historyToggleStyle}>
            <span>היסטוריית היום ({board.history.length})</span>
            <ChevronDown size={16} aria-hidden="true" style={{ transform: historyOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s var(--ease)' }} />
          </button>
          {historyOpen && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {board.history.map((order) => (
                <OrderCard key={order.id} order={order} canCancel={false} readOnly />
              ))}
            </div>
          )}
        </div>
      )}

      <PromptSheet request={cancelRequest} onSubmit={confirmCancel} onCancel={() => setCancelTarget(null)} />
    </div>
  )
}

const emptyStyle: CSSProperties = { color: 'var(--text-dim)', fontSize: '0.85rem', textAlign: 'center', padding: '24px 0', margin: 0 }

const historyToggleStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  minHeight: 'var(--tap-min)',
  padding: '0 14px',
  borderRadius: 12,
  border: '1px solid var(--line)',
  background: 'var(--bg-elev)',
  color: 'var(--text-dim)',
  fontSize: '0.82rem',
  fontWeight: 700,
  cursor: 'pointer',
}
