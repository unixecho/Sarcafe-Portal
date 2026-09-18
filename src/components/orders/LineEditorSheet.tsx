'use client'

import { useEffect, useId, useState, type CSSProperties } from 'react'
import SheetShell from '@/components/SheetShell'
import { haptic } from '@/lib/haptics'
import type { MenuItem } from '@/lib/menu/types'
import type { OrderLineInput } from '@/lib/orders/actions'

// Staff confirms (or types) the price here, always — see migration 017's
// header for why: MenuItem.price/MenuItemType.priceDelta can be free-text
// ranges ("20/24"), so there's no reliable auto-charge. This only ever
// pre-fills a *suggestion* when the menu happens to carry a clean number.
function parsePrice(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim())
  return null
}

function suggestPrice(item: MenuItem, typeUid: string | null): number | null {
  const type = item.types?.find((t) => t.uid === typeUid) ?? null
  const base = parsePrice(item.price)
  const delta = type ? parsePrice(type.priceDelta) : null
  if (!type) return base
  if (base !== null && delta !== null) return base + delta
  return delta ?? base
}

// Opened from inside NewOrderSheet (nested SheetShell, which suspends the
// outer one while this is open — the exact scenario SheetShell.tsx's own
// `suspended` prop documents). Picks a type (if any, sold-out ones
// excluded, same as the customer cart's ItemChoiceSheet), confirms a
// price, a quantity, and an optional note, then hands one line back.
export default function LineEditorSheet({
  open,
  onClose,
  item,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  item: MenuItem | null
  onAdd: (line: OrderLineInput) => void
}) {
  const ids = useId()
  const titleId = `${ids}-title`

  const availableTypes = (item?.types ?? []).filter((t) => t.available !== false)
  const [typeUid, setTypeUid] = useState<string | null>(null)
  const [qty, setQty] = useState(1)
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open || !item) return
    const firstTypeUid = availableTypes[0]?.uid ?? null
    setTypeUid(firstTypeUid)
    setQty(1)
    setNote('')
    const suggested = suggestPrice(item, firstTypeUid)
    setPrice(suggested !== null ? String(suggested) : '')
    // Re-run only when the sheet opens for a (possibly new) item — not on
    // every keystroke of price/qty/note, which live only in local state
    // from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.uid])

  if (!item) return null

  const hasTypes = availableTypes.length > 0 || !!item.types?.length
  const soldOut = item.available === false || (!!item.types?.length && availableTypes.length === 0)

  function selectType(uid: string) {
    setTypeUid(uid)
    const suggested = suggestPrice(item!, uid)
    setPrice(suggested !== null ? String(suggested) : '')
  }

  const numericPrice = Number(price)
  const canAdd = !soldOut && price.trim() !== '' && Number.isFinite(numericPrice) && numericPrice >= 0 && qty >= 1

  function add() {
    if (!canAdd || !item?.uid) return
    const selectedType = availableTypes.find((t) => t.uid === typeUid) ?? null
    haptic('select')
    onAdd({
      itemUid: item.uid,
      itemName: { he: item.he, en: item.en, ar: item.ar },
      typeUid: selectedType?.uid ?? null,
      typeName: selectedType ? { he: selectedType.he, en: selectedType.en, ar: selectedType.ar } : null,
      unitPrice: numericPrice,
      quantity: qty,
      notes: note.trim() || null,
    })
    onClose()
  }

  return (
    <SheetShell open={open} onClose={onClose} labelledBy={titleId}>
      <h2 id={titleId} style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: 800 }}>
        {item.he || 'פריט'}
      </h2>
      {soldOut && <p style={{ margin: '4px 0 0', color: '#ff6b6b', fontSize: '0.82rem', fontWeight: 700 }}>אזל המלאי — לא ניתן להוסיף</p>}

      <div className="sheet-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 10 }}>
        {hasTypes && availableTypes.length > 0 && (
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend style={legendStyle}>בחירת סוג</legend>
            <div role="radiogroup" aria-label="בחירת סוג" style={{ display: 'grid', gap: 8 }}>
              {availableTypes.map((t) => {
                const active = t.uid === typeUid
                return (
                  <button
                    key={t.uid}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className="press"
                    onClick={() => selectType(t.uid)}
                    style={{
                      ...choiceStyle,
                      borderColor: active ? 'var(--neon)' : 'var(--line-strong)',
                      background: active ? 'rgba(255,122,69,0.12)' : 'var(--bg-elev)',
                    }}
                  >
                    {t.he || 'סוג'}
                  </button>
                )
              })}
            </div>
          </fieldset>
        )}

        <div>
          <label htmlFor={`${ids}-price`} style={legendStyle}>
            מחיר (₪)
          </label>
          <input
            id={`${ids}-price`}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder="0"
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={legendStyle}>כמות</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" className="press" onClick={() => setQty((q) => Math.max(1, q - 1))} style={qtyBtnStyle} aria-label="הפחתת כמות">
              −
            </button>
            <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{qty}</span>
            <button type="button" className="press" onClick={() => setQty((q) => Math.min(50, q + 1))} style={qtyBtnStyle} aria-label="הוספת כמות">
              +
            </button>
          </div>
        </div>

        <div>
          <label htmlFor={`${ids}-note`} style={legendStyle}>
            הערה (לא חובה)
          </label>
          <input
            id={`${ids}-note`}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 120))}
            placeholder="לדוגמה: בלי סוכר"
            style={inputStyle}
          />
        </div>
      </div>

      <div style={{ paddingTop: 14, display: 'flex', gap: 8 }}>
        <button type="button" className="press" onClick={onClose} style={{ ...secondaryBtnStyle, flex: 1 }}>
          ביטול
        </button>
        <button
          type="button"
          className="press"
          disabled={!canAdd}
          onClick={add}
          style={{ ...primaryBtnStyle, flex: 2, opacity: canAdd ? 1 : 0.5, cursor: canAdd ? 'pointer' : 'not-allowed' }}
        >
          הוספה להזמנה
        </button>
      </div>
    </SheetShell>
  )
}

const legendStyle: CSSProperties = { display: 'block', marginBottom: 6, fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-dim)' }
const choiceStyle: CSSProperties = {
  width: '100%',
  minHeight: 'var(--tap-min)',
  padding: '10px 13px',
  borderRadius: 12,
  border: '1px solid var(--line-strong)',
  color: 'var(--text)',
  fontSize: '0.9rem',
  fontWeight: 600,
  textAlign: 'start',
  cursor: 'pointer',
}
const qtyBtnStyle: CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: '50%',
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev-2)',
  color: 'var(--text)',
  fontSize: '1.1rem',
  fontWeight: 700,
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
const secondaryBtnStyle: CSSProperties = {
  minHeight: 'var(--tap-min)',
  borderRadius: 14,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  fontSize: '0.92rem',
  fontWeight: 700,
  cursor: 'pointer',
}
