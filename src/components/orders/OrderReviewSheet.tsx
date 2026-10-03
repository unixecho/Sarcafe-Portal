'use client'

import { useId, type CSSProperties } from 'react'
import { Check } from 'lucide-react'
import SheetShell from '@/components/SheetShell'

export type ReviewLine = { key: string; label: string; qty: number; unitPrice: number; notes?: string | null }

/**
 * The one screen staff actually check before an order goes to the
 * kitchen — a calm, read-only summary (no steppers, no "+"/edit buttons
 * to fat-finger by accident) instead of sending straight off the last
 * tap in the builder. Nested inside NewOrderSheet the same way
 * LineEditorSheet is (suspends the outer sheet while open).
 */
export default function OrderReviewSheet({
  open,
  onClose,
  onConfirm,
  lines,
  total,
  customerName,
  orderNote,
  submitting,
  error,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  lines: ReviewLine[]
  total: number
  customerName: string
  orderNote: string
  submitting: boolean
  error: string | null
}) {
  const titleId = useId()

  return (
    <SheetShell open={open} onClose={onClose} labelledBy={titleId}>
      <h2 id={titleId} style={{ margin: '0 0 4px', fontSize: '1.1rem', fontWeight: 800 }}>
        אישור הזמנה
      </h2>
      <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: 'var(--text-dim)' }}>בדקו שהכול נכון לפני שליחה למטבח.</p>

      <div className="sheet-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={cardStyle}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {lines.map((line) => (
              <li key={line.key} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: '0.92rem' }}>
                <span style={{ fontWeight: 700, color: 'var(--neon-soft)', minWidth: 26 }}>{line.qty}×</span>
                <span style={{ flex: 1 }}>
                  {line.label}
                  {line.notes && <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-faint)' }}>{line.notes}</span>}
                </span>
                <span style={{ fontWeight: 600, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
                  {(line.qty * line.unitPrice).toFixed(2)} ₪
                </span>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>סה״כ</span>
            <span style={{ fontWeight: 800, fontSize: '1.05rem' }}>{total.toFixed(2)} ₪</span>
          </div>
        </div>

        {(customerName || orderNote) && (
          <div style={cardStyle}>
            {customerName && (
              <p style={{ margin: 0, fontSize: '0.88rem' }}>
                <span style={{ color: 'var(--text-faint)' }}>ללקוח: </span>
                {customerName}
              </p>
            )}
            {orderNote && (
              <p style={{ margin: customerName ? '6px 0 0' : 0, fontSize: '0.88rem' }}>
                <span style={{ color: 'var(--text-faint)' }}>הערה: </span>
                {orderNote}
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" style={{ margin: '10px 0 0', color: '#ff6b6b', fontSize: '0.85rem' }}>
          {error}
        </p>
      )}

      <div style={{ paddingTop: 14, display: 'flex', gap: 8 }}>
        <button type="button" className="press" onClick={onClose} disabled={submitting} style={secondaryBtnStyle}>
          חזרה לעריכה
        </button>
        <button type="button" className="press" onClick={onConfirm} disabled={submitting} style={{ ...primaryBtnStyle, opacity: submitting ? 0.6 : 1 }}>
          <Check size={17} strokeWidth={2.5} aria-hidden="true" />
          {submitting ? 'שולח…' : 'אישור ושליחה למטבח'}
        </button>
      </div>
    </SheetShell>
  )
}

const cardStyle: CSSProperties = {
  padding: '14px 14px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
}

const primaryBtnStyle: CSSProperties = {
  flex: 2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  minHeight: 'var(--tap-min)',
  borderRadius: 14,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontSize: '0.92rem',
  fontWeight: 800,
  cursor: 'pointer',
}

const secondaryBtnStyle: CSSProperties = {
  flex: 1,
  minHeight: 'var(--tap-min)',
  borderRadius: 14,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  fontSize: '0.92rem',
  fontWeight: 700,
  cursor: 'pointer',
}
