'use client'

import { useId, useState, type CSSProperties } from 'react'
import SheetShell from '@/components/SheetShell'
import LineEditorSheet from './LineEditorSheet'
import { haptic } from '@/lib/haptics'
import { randomId } from '@/lib/menu/id'
import { useOrders } from './OrdersProvider'
import type { MenuItem } from '@/lib/menu/types'
import type { OrderLineInput } from '@/lib/orders/actions'

type CartLine = OrderLineInput & { key: string }

function lineLabel(line: CartLine): string {
  const name = line.itemName.he || '—'
  const type = line.typeName?.he
  return type ? `${name} — ${type}` : name
}

// The register itself: browse the branch's live published menu (same
// source of truth the customer's own menu view reads — /api/orders/catalog
// wraps the identical fetchMenu()), build up a cart, then send it as one
// real order. Cart lives in THIS component's own state (not the customer
// cart's lib/cart/store — that one is explicitly "never a real order",
// see its own header) and survives an accidental close, resetting only
// after a successful submit.
export default function NewOrderSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { catalog, dispatch, branchSlug } = useOrders()
  const ids = useId()
  const titleId = `${ids}-title`

  const [cart, setCart] = useState<CartLine[]>([])
  const [customerName, setCustomerName] = useState('')
  const [orderNote, setOrderNote] = useState('')
  const [pickingItem, setPickingItem] = useState<MenuItem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)

  function addLine(line: OrderLineInput) {
    setCart((prev) => {
      const existing = prev.find(
        (l) => l.itemUid === line.itemUid && l.typeUid === line.typeUid && l.unitPrice === line.unitPrice && (l.notes ?? '') === (line.notes ?? '')
      )
      if (existing) {
        return prev.map((l) => (l.key === existing.key ? { ...l, quantity: l.quantity + line.quantity } : l))
      }
      return [...prev, { ...line, key: randomId('ol') }]
    })
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key))
  }

  function changeQty(key: string, delta: number) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l)).filter((l) => l.quantity > 0))
  }

  async function submit() {
    if (cart.length === 0 || submitting) return
    setSubmitting(true)
    setFormError(null)
    const outcome = await dispatch({
      type: 'createOrder',
      branch: branchSlug,
      customerName: customerName.trim() || null,
      notes: orderNote.trim() || null,
      items: cart.map(({ key: _key, ...line }) => line),
    })
    setSubmitting(false)
    if (!outcome.ok) {
      setFormError(outcome.error)
      return
    }
    haptic('impact')
    setCart([])
    setCustomerName('')
    setOrderNote('')
    onClose()
  }

  return (
    <>
      <SheetShell open={open} onClose={onClose} labelledBy={titleId} suspended={!!pickingItem}>
        <h2 id={titleId} style={{ margin: '0 0 12px', fontSize: '1.1rem', fontWeight: 800 }}>
          הזמנה חדשה
        </h2>

        <div className="sheet-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {cart.length > 0 && (
            <section>
              <h3 style={sectionTitleStyle}>ההזמנה שלכם</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {cart.map((line) => (
                  <div key={line.key} style={cartRowStyle}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>{lineLabel(line)}</p>
                      <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-faint)' }}>
                        {line.unitPrice} ₪{line.notes ? ` · ${line.notes}` : ''}
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={stepperStyle}>
                        <button type="button" className="press" onClick={() => changeQty(line.key, -1)} aria-label="הפחתה" style={stepBtnStyle}>
                          −
                        </button>
                        <span style={{ minWidth: 16, textAlign: 'center', fontSize: '0.85rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {line.quantity}
                        </span>
                        <button type="button" className="press" onClick={() => changeQty(line.key, 1)} aria-label="הוספה" style={stepBtnStyle}>
                          +
                        </button>
                      </div>
                      <button type="button" className="press" onClick={() => removeLine(line.key)} aria-label="הסרה מההזמנה" style={removeBtnStyle}>
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 style={sectionTitleStyle}>תפריט</h3>
            {catalog.length === 0 && <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>טוען תפריט…</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {catalog.map((category) => (
                <div key={category.id}>
                  <p style={categoryTitleStyle}>{category.title.he || 'קטגוריה'}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {category.items.map((item) => {
                      const hasTypes = !!item.types?.length
                      const availableTypes = (item.types ?? []).filter((t) => t.available !== false)
                      const soldOut = item.available === false || (hasTypes && availableTypes.length === 0)
                      return (
                        <button
                          key={item.uid ?? item.he}
                          type="button"
                          className="press"
                          disabled={soldOut || !item.uid}
                          onClick={() => item.uid && setPickingItem(item)}
                          style={{ ...itemRowStyle, opacity: soldOut ? 0.5 : 1, cursor: soldOut ? 'default' : 'pointer' }}
                        >
                          <span style={{ flex: 1, textAlign: 'start' }}>{item.he || 'פריט'}</span>
                          {soldOut ? (
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#ff6b6b' }}>אזל</span>
                          ) : (
                            item.price != null && item.price !== '' && (
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>{String(item.price)} ₪</span>
                            )
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label htmlFor={`${ids}-customer`} style={legendStyle}>
                שם ללקוח (לא חובה)
              </label>
              <input
                id={`${ids}-customer`}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value.slice(0, 60))}
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor={`${ids}-note`} style={legendStyle}>
                הערה להזמנה (לא חובה)
              </label>
              <input id={`${ids}-note`} value={orderNote} onChange={(e) => setOrderNote(e.target.value.slice(0, 200))} style={inputStyle} />
            </div>
          </section>
        </div>

        {formError && (
          <p role="alert" style={{ margin: '10px 0 0', color: '#ff6b6b', fontSize: '0.85rem' }}>
            {formError}
          </p>
        )}

        <div style={{ paddingTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-faint)' }}>סה״כ</p>
            <p style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>{total.toFixed(2)} ₪</p>
          </div>
          <button
            type="button"
            className="press"
            disabled={cart.length === 0 || submitting}
            onClick={submit}
            style={{
              ...primaryBtnStyle,
              minWidth: 160,
              opacity: cart.length === 0 || submitting ? 0.5 : 1,
              cursor: cart.length === 0 || submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'שולח…' : 'שליחה למטבח'}
          </button>
        </div>
      </SheetShell>

      <LineEditorSheet open={!!pickingItem} onClose={() => setPickingItem(null)} item={pickingItem} onAdd={addLine} />
    </>
  )
}

const sectionTitleStyle: CSSProperties = { margin: '0 0 8px', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-faint)' }
const categoryTitleStyle: CSSProperties = { margin: '0 0 6px', fontSize: '0.9rem', fontWeight: 800, color: 'var(--neon-soft)' }
const legendStyle: CSSProperties = { display: 'block', marginBottom: 6, fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-dim)' }

const cartRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  borderRadius: 12,
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
}

const itemRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  minHeight: 'var(--tap-min)',
  padding: '0 12px',
  borderRadius: 12,
  border: '1px solid var(--line)',
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  fontSize: '0.9rem',
  fontWeight: 600,
  textAlign: 'start',
}

const stepperStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  borderRadius: 999,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev-2)',
  padding: '2px 4px',
}
const stepBtnStyle: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: '50%',
  border: 'none',
  background: 'transparent',
  color: 'var(--text)',
  fontWeight: 700,
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
}
const removeBtnStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: '50%',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-faint)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
}
const inputStyle: CSSProperties = {
  width: '100%',
  minHeight: 'var(--tap-min)',
  padding: '0 13px',
  borderRadius: 12,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: '0.9rem',
  fontFamily: 'inherit',
}
const primaryBtnStyle: CSSProperties = {
  minHeight: 'var(--tap-min)',
  borderRadius: 14,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontSize: '0.92rem',
  fontWeight: 800,
  cursor: 'pointer',
}
