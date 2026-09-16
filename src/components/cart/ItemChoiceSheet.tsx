'use client'

import { useEffect, useId, useState, type CSSProperties } from 'react'
import SheetShell from '@/components/SheetShell'
import { haptic } from '@/lib/haptics'
import { useCart } from '@/components/cart/CartProvider'
import { localized, type Lang, type Localized, type MenuItem } from '@/lib/menu/types'
import { MAX_NOTE_LEN, MAX_QTY } from '@/lib/cart/types'

// Opened when an item has types — picks one (sold-out types are excluded,
// same as the tablet editor's own availability check), a quantity, and an
// optional note, then adds one line.
export default function ItemChoiceSheet({
  open,
  onClose,
  item,
  categoryId,
  categoryTitle,
  lang,
}: {
  open: boolean
  onClose: () => void
  item: MenuItem
  categoryId: string
  categoryTitle: Localized
  lang: Lang
}) {
  const { dispatch } = useCart()
  const ids = useId()
  const titleId = `${ids}-title`

  const availableTypes = (item.types ?? []).filter((t) => t.available !== false)
  const [typeUid, setTypeUid] = useState<string | null>(availableTypes[0]?.uid ?? null)
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) return
    setTypeUid(availableTypes[0]?.uid ?? null)
    setQty(1)
    setNote('')
    // availableTypes is derived from `item`, stable for the sheet's life —
    // re-running this only on open/item-change avoids resetting mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item.uid])

  function add() {
    if (!item.uid) return
    const type = availableTypes.find((t) => t.uid === typeUid) ?? null
    haptic('select')
    dispatch({
      type: 'add',
      qty,
      line: {
        itemUid: item.uid,
        typeUid: type?.uid ?? null,
        name: { he: item.he, en: item.en, ar: item.ar },
        typeLabel: type ? { he: type.he, en: type.en, ar: type.ar } : null,
        priceText: String(item.price ?? ''),
        categoryId,
        categoryTitle,
        note: note.trim() || undefined,
      },
    })
    onClose()
  }

  return (
    <SheetShell open={open} onClose={onClose} labelledBy={titleId}>
      <h2 id={titleId} style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: 800 }}>
        {localized(item, lang)}
      </h2>

      <div className="sheet-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 10 }}>
        {availableTypes.length > 0 && (
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
                    onClick={() => setTypeUid(t.uid)}
                    style={{
                      ...choiceStyle,
                      borderColor: active ? 'var(--neon)' : 'var(--line-strong)',
                      background: active ? 'rgba(255,122,69,0.12)' : 'var(--bg-elev)',
                    }}
                  >
                    {localized(t, lang)}
                  </button>
                )
              })}
            </div>
          </fieldset>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={legendStyle}>כמות</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" className="press" onClick={() => setQty((q) => Math.max(1, q - 1))} style={qtyBtnStyle} aria-label="הפחתת כמות">
              −
            </button>
            <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{qty}</span>
            <button type="button" className="press" onClick={() => setQty((q) => Math.min(MAX_QTY, q + 1))} style={qtyBtnStyle} aria-label="הוספת כמות">
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
            onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE_LEN))}
            placeholder="לדוגמה: בלי סוכר"
            style={inputStyle}
          />
        </div>
      </div>

      <div style={{ paddingTop: 14, display: 'flex', gap: 8 }}>
        <button type="button" className="press" onClick={onClose} style={{ ...secondaryBtnStyle, flex: 1 }}>
          ביטול
        </button>
        <button type="button" className="press" onClick={add} style={{ ...primaryBtnStyle, flex: 2 }}>
          הוספה לרשימה
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
