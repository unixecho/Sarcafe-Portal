'use client'

import type { CSSProperties } from 'react'
import { Clock, Check, Ban, QrCode } from 'lucide-react'
import type { Order, OrderStatus } from '@/lib/orders/types'

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: 'חדש',
  preparing: 'בהכנה',
  ready: 'מוכן לאיסוף',
  completed: 'נמסר',
  cancelled: 'בוטל',
}

const STATUS_COLOR: Record<OrderStatus, string> = {
  new: 'var(--neon)',
  preparing: 'var(--line-interactive)',
  ready: 'var(--neon-2)',
  completed: 'var(--text-faint)',
  cancelled: '#ff6b6b',
}

const NEXT_ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  new: 'התחלת הכנה',
  preparing: 'מוכן לאיסוף',
  ready: 'נמסר ללקוח',
}

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
}

function lineLabel(item: Order['items'][number]): string {
  const name = item.itemName.he || '—'
  const type = item.typeName?.he
  return type ? `${name} — ${type}` : name
}

export default function OrderCard({
  order,
  canCancel,
  busy,
  readOnly,
  onAdvance,
  onCancel,
  onTogglePayment,
  onReprint,
}: {
  order: Order
  canCancel: boolean
  busy?: boolean
  /** History rows: static, no actions. */
  readOnly?: boolean
  onAdvance?: () => void
  onCancel?: () => void
  onTogglePayment?: () => void
  /** Reissues a fresh QR + recovery code for a printer jam / lost
   *  receipt / second copy — see migration 018's issue_order_access(). */
  onReprint?: () => void
}) {
  const nextLabel = NEXT_ACTION_LABEL[order.status]

  return (
    <div style={{ ...cardStyle, borderInlineStartColor: STATUS_COLOR[order.status] }} aria-busy={busy}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '1.15rem', fontWeight: 800 }}>#{order.orderNumber}</span>
        <span style={{ ...badgeStyle, color: STATUS_COLOR[order.status], borderColor: STATUS_COLOR[order.status] }}>{STATUS_LABEL[order.status]}</span>
        {order.customerName && <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>· {order.customerName}</span>}
        <span style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.76rem', color: 'var(--text-faint)' }}>
          <Clock size={13} aria-hidden="true" />
          {minutesAgo(order.createdAt)} דק&apos;
        </span>
      </div>

      <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {order.items.map((item) => (
          <li key={item.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: '0.86rem' }}>
            <span style={{ fontWeight: 700, color: 'var(--neon-soft)', minWidth: 22 }}>{item.quantity}×</span>
            <span style={{ flex: 1 }}>
              {lineLabel(item)}
              {item.notes && <span style={{ color: 'var(--text-faint)' }}> · {item.notes}</span>}
            </span>
          </li>
        ))}
      </ul>

      {order.notes && <p style={{ margin: '8px 0 0', fontSize: '0.8rem', color: 'var(--text-dim)' }}>הערה: {order.notes}</p>}
      {order.status === 'cancelled' && order.cancelReason && (
        <p style={{ margin: '8px 0 0', fontSize: '0.8rem', color: '#ff6b6b' }}>סיבת ביטול: {order.cancelReason}</p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{order.total.toFixed(2)} ₪</span>

        {!readOnly && (
          <button
            type="button"
            className="press"
            onClick={onTogglePayment}
            disabled={busy}
            style={{ ...paymentChipStyle, color: order.paymentStatus === 'paid' ? 'var(--neon-2)' : 'var(--text-faint)', borderColor: order.paymentStatus === 'paid' ? 'var(--neon-2)' : 'var(--line-strong)' }}
          >
            {order.paymentStatus === 'paid' ? 'שולם' : 'לא שולם'}
          </button>
        )}

        {!readOnly && (nextLabel || canCancel) && <span style={{ flex: 1 }} />}

        {!readOnly && (
          <button type="button" className="press" onClick={onReprint} disabled={busy} aria-label="הדפסת קבלה מחדש" style={reprintBtnStyle}>
            <QrCode size={16} aria-hidden="true" />
          </button>
        )}

        {!readOnly && canCancel && (
          <button type="button" className="press" onClick={onCancel} disabled={busy} aria-label="ביטול הזמנה" style={cancelBtnStyle}>
            <Ban size={16} aria-hidden="true" />
          </button>
        )}

        {!readOnly && nextLabel && (
          <button type="button" className="press" onClick={onAdvance} disabled={busy} style={advanceBtnStyle}>
            <Check size={15} aria-hidden="true" /> {nextLabel}
          </button>
        )}
      </div>
    </div>
  )
}

const cardStyle: CSSProperties = {
  padding: '14px 14px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
  borderInlineStartWidth: 4,
  borderInlineStartStyle: 'solid',
}

const badgeStyle: CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 700,
  padding: '2px 8px',
  borderRadius: 999,
  border: '1px solid',
  background: 'transparent',
}

const paymentChipStyle: CSSProperties = {
  minHeight: 30,
  padding: '0 10px',
  borderRadius: 999,
  border: '1px solid',
  background: 'transparent',
  fontSize: '0.74rem',
  fontWeight: 700,
  cursor: 'pointer',
}

const advanceBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 38,
  padding: '0 14px',
  borderRadius: 12,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontSize: '0.82rem',
  fontWeight: 800,
  cursor: 'pointer',
}

const reprintBtnStyle: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: '50%',
  border: '1px solid var(--line-strong)',
  background: 'transparent',
  color: 'var(--text-dim)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
}

const cancelBtnStyle: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: '50%',
  border: '1px solid rgba(255,107,107,0.35)',
  background: 'transparent',
  color: '#ff6b6b',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
}
