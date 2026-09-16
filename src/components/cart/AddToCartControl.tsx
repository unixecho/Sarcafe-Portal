'use client'

import { useState } from 'react'
import { Plus, Minus } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { useCart } from '@/components/cart/CartProvider'
import ItemChoiceSheet from '@/components/cart/ItemChoiceSheet'
import type { Lang, Localized, MenuItem } from '@/lib/menu/types'

// Mounted per menu-item row on the public menu. An item with types (a
// pastry's fillings, a shake's flavors) always opens ItemChoiceSheet — a
// bare "+"/"−" wouldn't know which type to touch. A plain item adds
// directly and becomes an inline stepper once it's in the list, undoing
// the most recent tap on "−" (the same "no precise editing, just undo the
// last add" semantic AyekaBar's own AddToCartControl uses).
export default function AddToCartControl({
  item,
  categoryId,
  categoryTitle,
  lang,
}: {
  item: MenuItem
  categoryId: string
  categoryTitle: Localized
  lang: Lang
}) {
  const { cart, dispatch } = useCart()
  const [choiceOpen, setChoiceOpen] = useState(false)

  if (!item.uid) return null

  const needsChoice = (item.types?.length ?? 0) > 0
  const simpleLine = !needsChoice ? cart.lines.find((l) => l.itemUid === item.uid && l.typeUid === null) : null

  function addSimple() {
    if (!item.uid) return
    haptic('select')
    dispatch({
      type: 'add',
      line: {
        itemUid: item.uid,
        typeUid: null,
        name: { he: item.he, en: item.en, ar: item.ar },
        typeLabel: null,
        priceText: String(item.price ?? ''),
        categoryId,
        categoryTitle,
      },
    })
  }

  if (needsChoice) {
    return (
      <>
        <button type="button" className="press" onClick={() => setChoiceOpen(true)} aria-haspopup="dialog" aria-label="הוספה לרשימה" style={addBtnStyle}>
          <Plus size={16} aria-hidden="true" />
        </button>
        <ItemChoiceSheet open={choiceOpen} onClose={() => setChoiceOpen(false)} item={item} categoryId={categoryId} categoryTitle={categoryTitle} lang={lang} />
      </>
    )
  }

  if (!simpleLine) {
    return (
      <button type="button" className="press" onClick={addSimple} aria-label="הוספה לרשימה" style={addBtnStyle}>
        <Plus size={16} aria-hidden="true" />
      </button>
    )
  }

  return (
    <div style={stepperStyle}>
      <button
        type="button"
        className="press"
        onClick={() => {
          haptic()
          dispatch({ type: 'decrement', id: simpleLine.id })
        }}
        aria-label="הפחתה מהרשימה"
        style={stepBtnStyle}
      >
        <Minus size={13} aria-hidden="true" />
      </button>
      <span style={{ minWidth: 16, textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontSize: '0.82rem', fontWeight: 700 }}>
        {simpleLine.qty}
      </span>
      <button
        type="button"
        className="press"
        onClick={() => {
          haptic()
          dispatch({ type: 'increment', id: simpleLine.id })
        }}
        aria-label="הוספה לרשימה"
        style={stepBtnStyle}
      >
        <Plus size={13} aria-hidden="true" />
      </button>
    </div>
  )
}

const addBtnStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  flexShrink: 0,
  borderRadius: '50%',
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev-2)',
  color: 'var(--neon-soft)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
}

const stepperStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
  borderRadius: 999,
  border: '1px solid var(--neon)',
  background: 'rgba(255,122,69,0.12)',
  padding: '2px 4px',
}

const stepBtnStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: '50%',
  border: 'none',
  background: 'transparent',
  color: 'var(--neon-soft)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
}
