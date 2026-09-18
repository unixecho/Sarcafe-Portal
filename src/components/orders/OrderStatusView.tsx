'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Check } from 'lucide-react'
import NotificationPrimer from './NotificationPrimer'
import { useOrderStatusRealtime } from '@/lib/orders/useOrderStatusRealtime'
import type { CustomerOrder, OrderStatus } from '@/lib/orders/types'

const POLL_MS = 10_000

const STEPS: { status: OrderStatus; label: string }[] = [
  { status: 'new', label: 'התקבלה' },
  { status: 'preparing', label: 'בהכנה' },
  { status: 'ready', label: 'מוכנה' },
  { status: 'completed', label: 'נמסרה' },
]

function lineLabel(item: CustomerOrder['items'][number]): string {
  const name = item.itemName.he || '—'
  const type = item.typeName?.he
  return type ? `${name} — ${type}` : name
}

export default function OrderStatusView({ token, initialOrder }: { token: string; initialOrder: CustomerOrder }) {
  const [order, setOrder] = useState<CustomerOrder>(initialOrder)
  const [gone, setGone] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/order/${token}`, { cache: 'no-store' })
      if (res.status === 404) {
        setGone(true)
        return
      }
      if (!res.ok) return
      const payload = await res.json()
      setOrder(payload.order as CustomerOrder)
    } catch {
      // Network hiccup — keep showing the last-good state.
    }
  }, [token])

  useEffect(() => {
    const interval = window.setInterval(refresh, POLL_MS)
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [refresh])

  useOrderStatusRealtime(order.id, refresh)

  if (gone) {
    return (
      <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', textAlign: 'center', padding: '32px 16px' }}>
        לא ניתן היה למצוא את ההזמנה הזו — יכול להיות שהקישור פג תוקף. אפשר לנסות שוב עם קוד השחזור שקיבלתם בקבלה.
      </p>
    )
  }

  const cancelled = order.status === 'cancelled'
  const currentStepIndex = STEPS.findIndex((s) => s.status === order.status)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ margin: '0 0 4px', fontSize: '0.8rem', color: 'var(--text-faint)' }}>הזמנה מספר</p>
        <p style={{ margin: 0, fontSize: '2.4rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>#{order.orderNumber}</p>
      </div>

      {cancelled ? (
        <div style={{ ...cardStyle, borderColor: 'rgba(255,107,107,0.35)', textAlign: 'center' }}>
          <p style={{ margin: 0, fontWeight: 800, color: '#ff6b6b' }}>ההזמנה בוטלה</p>
          {order.cancelReason && <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--text-dim)' }}>{order.cancelReason}</p>}
        </div>
      ) : (
        <>
          <Stepper currentIndex={currentStepIndex} />
          {order.status === 'ready' && (
            <div style={{ ...cardStyle, borderColor: 'rgba(87,217,192,0.4)', background: 'rgba(87,217,192,0.08)', textAlign: 'center' }}>
              <p style={{ margin: 0, fontWeight: 800, color: 'var(--neon-2)', fontSize: '1.05rem' }}>ההזמנה מוכנה לאיסוף! ☕</p>
            </div>
          )}
        </>
      )}

      {!cancelled && order.status !== 'completed' && <NotificationPrimer token={token} />}

      <section>
        <h2 style={sectionTitleStyle}>פירוט ההזמנה</h2>
        <div style={cardStyle}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {order.items.map((item) => (
              <li key={item.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: '0.9rem' }}>
                <span style={{ fontWeight: 700, color: 'var(--neon-soft)', minWidth: 24 }}>{item.quantity}×</span>
                <span style={{ flex: 1 }}>
                  {lineLabel(item)}
                  {item.notes && <span style={{ color: 'var(--text-faint)' }}> · {item.notes}</span>}
                </span>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>סה״כ</span>
            <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>{order.total.toFixed(2)} ₪</span>
          </div>
        </div>
      </section>
    </div>
  )
}

function Stepper({ currentIndex }: { currentIndex: number }) {
  return (
    <div role="list" aria-label="סטטוס ההזמנה" style={{ display: 'flex', alignItems: 'flex-start' }}>
      {STEPS.map((step, i) => {
        const done = i < currentIndex
        const active = i === currentIndex
        const color = done || active ? 'var(--neon)' : 'var(--line-strong)'
        return (
          <div key={step.status} role="listitem" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <div style={{ flex: i === 0 ? 0 : 1, height: 2, background: done ? 'var(--neon)' : 'var(--line-strong)' }} />
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  border: `2px solid ${color}`,
                  background: done ? 'var(--neon)' : active ? 'rgba(255,122,69,0.18)' : 'transparent',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                }}
              >
                {done && <Check size={14} color="var(--bg)" strokeWidth={3} aria-hidden="true" />}
              </div>
              <div style={{ flex: i === STEPS.length - 1 ? 0 : 1, height: 2, background: done ? 'var(--neon)' : 'var(--line-strong)' }} />
            </div>
            <span style={{ fontSize: '0.72rem', fontWeight: active ? 800 : 600, color: active ? 'var(--text)' : 'var(--text-faint)' }}>{step.label}</span>
          </div>
        )
      })}
    </div>
  )
}

const cardStyle: CSSProperties = {
  padding: '14px 14px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
}
const sectionTitleStyle: CSSProperties = { margin: '0 0 8px', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-faint)' }
