'use client'

import { useId, useState, type CSSProperties } from 'react'
import { ChevronDown, Pencil, Plus } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import LineEditorSheet from './LineEditorSheet'
import type { ReceiptData } from './ReceiptSheet'
import { haptic } from '@/lib/haptics'
import { randomId } from '@/lib/menu/id'
import { parsePrice } from '@/lib/menu/price'
import { useOrders } from './OrdersProvider'
import type { MenuCategory, MenuItem } from '@/lib/menu/types'
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
export default function NewOrderSheet({
  open,
  onClose,
  onReceipt,
}: {
  open: boolean
  onClose: () => void
  /** Handed the fresh QR/code the instant an order is created — the
   *  caller (OrdersWorkspace) owns actually showing ReceiptSheet, since
   *  a staff-requested reprint (OrderCard) needs to reach the same sheet
   *  without this builder being open at all. */
  onReceipt: (receipt: ReceiptData) => void
}) {
  const { catalog, dispatch, branchSlug } = useOrders()
  const ids = useId()
  const titleId = `${ids}-title`

  const [cart, setCart] = useState<CartLine[]>([])
  const [customerName, setCustomerName] = useState('')
  const [orderNote, setOrderNote] = useState('')
  const [pickingItem, setPickingItem] = useState<MenuItem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  // Every category starts collapsed — with a full menu on screen, opening
  // one at a time (not "tap an item, get a modal, every time") is what
  // actually makes the register fast to use.
  const [openCategories, setOpenCategories] = useState<Set<string>>(() => new Set())

  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)

  function toggleCategory(categoryId: string) {
    haptic('tick')
    setOpenCategories((prev) => {
      const next = new Set(prev)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

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

  // Quick-add: a plain-priced, type-free item (the common case) skips the
  // modal entirely — tapping "+" adds it straight to the cart at its own
  // price, and once it's in the cart the same row turns into a stepper.
  // Anything that needs a real decision (a type to pick, no clean numeric
  // price to default to) still opens LineEditorSheet, same as before.
  function findQuickAddLine(itemUid: string, price: number): CartLine | undefined {
    return cart.find((l) => l.itemUid === itemUid && l.typeUid === null && l.unitPrice === price && !l.notes)
  }

  function quickAdd(item: MenuItem, price: number) {
    const existing = findQuickAddLine(item.uid!, price)
    if (existing) {
      changeQty(existing.key, 1)
      return
    }
    haptic('select')
    addLine({ itemUid: item.uid!, itemName: { he: item.he, en: item.en, ar: item.ar }, typeUid: null, typeName: null, unitPrice: price, quantity: 1, notes: null })
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
    if (outcome.access && outcome.orderNumber !== undefined) {
      onReceipt({
        orderNumber: outcome.orderNumber,
        access: outcome.access,
        lines: cart.map((line) => ({ label: lineLabel(line), qty: line.quantity, unitPrice: line.unitPrice })),
        total,
      })
    }
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {catalog.map((category) => (
                <CategorySection
                  key={category.id}
                  category={category}
                  open={openCategories.has(category.id)}
                  onToggle={() => toggleCategory(category.id)}
                  findQuickAddLine={findQuickAddLine}
                  onQuickAdd={quickAdd}
                  onChangeQty={changeQty}
                  onOpenEditor={setPickingItem}
                />
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

// Collapsed by default (see NewOrderSheet's openCategories) — a header
// button toggles it, showing how many items are already in the cart from
// this category even while closed, so staff don't need to open every
// category just to check what they've already added.
function CategorySection({
  category,
  open,
  onToggle,
  findQuickAddLine,
  onQuickAdd,
  onChangeQty,
  onOpenEditor,
}: {
  category: MenuCategory
  open: boolean
  onToggle: () => void
  findQuickAddLine: (itemUid: string, price: number) => CartLine | undefined
  onQuickAdd: (item: MenuItem, price: number) => void
  onChangeQty: (key: string, delta: number) => void
  onOpenEditor: (item: MenuItem) => void
}) {
  return (
    <div>
      <button type="button" className="press" onClick={onToggle} aria-expanded={open} style={categoryHeaderStyle}>
        <ChevronDown
          size={16}
          aria-hidden="true"
          style={{ color: 'var(--text-faint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s var(--ease)', flexShrink: 0 }}
        />
        <span style={{ flex: 1, textAlign: 'start' }}>{category.title.he || 'קטגוריה'}</span>
        <span style={{ fontSize: '0.76rem', color: 'var(--text-faint)', fontWeight: 600 }}>{category.items.length}</span>
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          {category.items.map((item) => (
            <CatalogItemRow
              key={item.uid ?? item.he}
              item={item}
              findQuickAddLine={findQuickAddLine}
              onQuickAdd={onQuickAdd}
              onChangeQty={onChangeQty}
              onOpenEditor={onOpenEditor}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CatalogItemRow({
  item,
  findQuickAddLine,
  onQuickAdd,
  onChangeQty,
  onOpenEditor,
}: {
  item: MenuItem
  findQuickAddLine: (itemUid: string, price: number) => CartLine | undefined
  onQuickAdd: (item: MenuItem, price: number) => void
  onChangeQty: (key: string, delta: number) => void
  onOpenEditor: (item: MenuItem) => void
}) {
  const hasTypes = !!item.types?.length
  const availableTypes = (item.types ?? []).filter((t) => t.available !== false)
  const soldOut = item.available === false || (hasTypes && availableTypes.length === 0)
  const cleanPrice = parsePrice(item.price)
  // Only a plain, type-free, cleanly-priced item can skip straight to a
  // quantity stepper — anything else (a type to pick, a range price like
  // "20/24") still needs the modal's actual decision, not a guess.
  const quickAddEligible = !soldOut && !hasTypes && cleanPrice !== null && !!item.uid
  const existing = quickAddEligible ? findQuickAddLine(item.uid!, cleanPrice!) : undefined
  const qty = existing?.quantity ?? 0

  return (
    <div style={{ ...itemRowStyle, opacity: soldOut ? 0.5 : 1 }}>
      <span style={{ flex: 1, textAlign: 'start' }}>{item.he || 'פריט'}</span>

      {soldOut ? (
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#ff6b6b' }}>אזל</span>
      ) : (
        <>
          {!quickAddEligible && item.price != null && item.price !== '' && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>{String(item.price)} ₪</span>
          )}

          {quickAddEligible &&
            (qty > 0 ? (
              <div style={stepperStyle}>
                <button type="button" className="press" onClick={() => onChangeQty(existing!.key, -1)} aria-label="הפחתה" style={stepBtnStyle}>
                  −
                </button>
                <span style={{ minWidth: 16, textAlign: 'center', fontSize: '0.85rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{qty}</span>
                <button type="button" className="press" onClick={() => onQuickAdd(item, cleanPrice!)} aria-label="הוספה" style={stepBtnStyle}>
                  +
                </button>
              </div>
            ) : (
              <button type="button" className="press" onClick={() => onQuickAdd(item, cleanPrice!)} aria-label={`הוספת ${item.he || 'פריט'}`} style={quickAddBtnStyle}>
                <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
              </button>
            ))}

          <button
            type="button"
            className="press"
            onClick={() => onOpenEditor(item)}
            aria-label={quickAddEligible ? `עריכת מחיר/הערה עבור ${item.he || 'פריט'}` : `הוספת ${item.he || 'פריט'}`}
            // When there's no quick-add stepper at all (a type to pick, no
            // clean price), this pencil IS the row's only way to add it —
            // solid/prominent rather than the subdued secondary style it
            // gets when a stepper already covers the common case.
            style={quickAddEligible ? editBtnStyle : quickAddBtnStyle}
          >
            <Pencil size={14} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  )
}

const sectionTitleStyle: CSSProperties = { margin: '0 0 8px', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-faint)' }
const categoryHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minHeight: 'var(--tap-min)',
  padding: '0 12px',
  borderRadius: 12,
  border: '1px solid var(--line)',
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  fontSize: '0.9rem',
  fontWeight: 800,
  cursor: 'pointer',
}
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

const quickAddBtnStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: '50%',
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  flexShrink: 0,
}

const editBtnStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: '50%',
  border: '1px solid var(--line-strong)',
  background: 'transparent',
  color: 'var(--text-faint)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  flexShrink: 0,
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
