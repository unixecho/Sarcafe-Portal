'use client'

import { useId, useState } from 'react'
import { PartyPopper, Plus, Check } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import LogoMark from '@/components/LogoMark'
import IconPicker from '@/components/IconPicker'
import { randomId } from '@/lib/menu/id'
import type { CategoryIconKey } from '@/lib/menu/icons'
import type { MenuCategory } from '@/lib/menu/types'

type Step = 'welcome' | 'category' | 'items' | 'done'

type DraftItem = { uid: string; he: string; price: string }

type MenuOnboardingWizardProps = {
  open: boolean
  branchLabel: string
  onSkip: () => void
  /** Fires once, when the owner reaches the end — the caller folds this
   * straight into the real draft via its own edit()/addCategory() path,
   * this component never touches Supabase itself. */
  onComplete: (category: MenuCategory) => void
}

/**
 * First-run guided setup for an empty menu — same step-sheet pattern as
 * the existing VariantWizard.tsx (SheetShell, one concern per step, a
 * visible step count), aimed at an owner who has never used the editor
 * before rather than at someone comfortable configuring a "menu variant."
 * Auto-shown by MenuEditor when a branch's draft has zero categories;
 * replayable anytime via the editor's help button.
 */
export default function MenuOnboardingWizard({ open, branchLabel, onSkip, onComplete }: MenuOnboardingWizardProps) {
  const titleId = useId()
  const [step, setStep] = useState<Step>('welcome')
  const [icon, setIcon] = useState<CategoryIconKey>('coffee')
  const [categoryName, setCategoryName] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])
  const [itemName, setItemName] = useState('')
  const [itemPrice, setItemPrice] = useState('')

  function reset() {
    setStep('welcome')
    setIcon('coffee')
    setCategoryName('')
    setItems([])
    setItemName('')
    setItemPrice('')
  }

  function skip() {
    reset()
    onSkip()
  }

  function addCurrentItem() {
    if (!itemName.trim()) return
    setItems((prev) => [...prev, { uid: randomId('i'), he: itemName.trim(), price: itemPrice.trim() }])
    setItemName('')
    setItemPrice('')
  }

  function finish() {
    const pending = itemName.trim() ? [...items, { uid: randomId('i'), he: itemName.trim(), price: itemPrice.trim() }] : items
    onComplete({
      id: randomId('c'),
      icon,
      title: { he: categoryName.trim(), en: '', ar: '' },
      items: pending.map((it) => ({ uid: it.uid, he: it.he, en: '', ar: '', price: it.price })),
    })
    reset()
  }

  return (
    <SheetShell open={open} onClose={skip} labelledBy={titleId}>
      <div style={{ padding: '4px 4px 8px', maxHeight: '75dvh', display: 'flex', flexDirection: 'column' }}>
        {step !== 'welcome' && (
          <p style={{ margin: '0 0 4px', fontSize: '0.78rem', color: 'var(--text-faint)' }}>
            {step === 'category' && 'שלב 1 מתוך 2 — קטגוריה'}
            {step === 'items' && 'שלב 2 מתוך 2 — פריטים'}
            {step === 'done' && 'סיימנו!'}
          </p>
        )}

        {step === 'welcome' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12, padding: '8px 4px' }}>
            <LogoMark size={64} />
            <h2 id={titleId} style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>
              בואו נבנה את התפריט של {branchLabel}
            </h2>
            <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
              כמה שאלות קצרות ותוכלו להוסיף עוד קטגוריות ופריטים בכל שלב. שום דבר לא מתפרסם ללקוחות עד שתלחצו על
              &quot;פרסום&quot;.
            </p>
            <button type="button" className="press" onClick={() => setStep('category')} style={{ ...primaryButtonStyle, width: '100%', marginTop: 8 }}>
              בואו נתחיל
            </button>
            <button type="button" onClick={skip} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: '0.82rem', cursor: 'pointer' }}>
              אני אעשה את זה לבד
            </button>
          </div>
        )}

        {step === 'category' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 id={titleId} style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
              איך נקרא לקטגוריה הראשונה?
            </h2>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-faint)' }}>לדוגמה: קפה, מאפים, שתייה קרה.</p>
            <IconPicker value={icon} onChange={setIcon} label="בחירת סמל לקטגוריה" />
            <input
              autoFocus
              placeholder="שם הקטגוריה"
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              style={inputStyle}
            />
            <button
              type="button"
              className="press"
              disabled={!categoryName.trim()}
              onClick={() => setStep('items')}
              style={{ ...primaryButtonStyle, opacity: categoryName.trim() ? 1 : 0.5 }}
            >
              המשך
            </button>
          </div>
        )}

        {step === 'items' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 id={titleId} style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
              נוסיף פריט ראשון ל&quot;{categoryName.trim()}&quot;
            </h2>

            {items.length > 0 && (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map((it) => (
                  <li
                    key={it.uid}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: 'var(--bg-elev)',
                      fontSize: '0.86rem',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Check size={14} style={{ color: 'var(--neon-2)' }} aria-hidden="true" />
                      {it.he}
                    </span>
                    {it.price && <span className="ltr-isolate" style={{ color: 'var(--text-faint)' }}>{it.price} ₪</span>}
                  </li>
                ))}
              </ul>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <input
                autoFocus
                placeholder="שם הפריט"
                value={itemName}
                onChange={(event) => setItemName(event.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              />
              <input
                inputMode="decimal"
                placeholder="מחיר"
                value={itemPrice}
                onChange={(event) => setItemPrice(event.target.value)}
                className="ltr-isolate"
                style={{ ...inputStyle, width: 84, textAlign: 'center' }}
              />
            </div>
            <button
              type="button"
              className="press"
              disabled={!itemName.trim()}
              onClick={addCurrentItem}
              style={{ ...secondaryButtonStyle, opacity: itemName.trim() ? 1 : 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <Plus size={16} aria-hidden="true" /> הוספת עוד פריט
            </button>

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="button" className="press" onClick={() => setStep('category')} style={secondaryButtonStyle}>
                חזרה
              </button>
              <button
                type="button"
                className="press"
                disabled={items.length === 0 && !itemName.trim()}
                onClick={() => {
                  if (itemName.trim()) addCurrentItem()
                  setStep('done')
                }}
                style={{ ...primaryButtonStyle, flex: 1, opacity: items.length === 0 && !itemName.trim() ? 0.5 : 1 }}
              >
                סיום
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12, padding: '8px 4px' }}>
            <span
              aria-hidden="true"
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                background: 'rgba(255,122,69,0.14)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--neon)',
              }}
            >
              <PartyPopper size={26} strokeWidth={2} />
            </span>
            <h2 id={titleId} style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>
              מעולה, ההתחלה כאן
            </h2>
            <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
              אפשר להוסיף עוד קטגוריות ופריטים בכל רגע. הלקוחות יראו את זה רק אחרי שתלחצו על &quot;פרסום&quot; בתחתית
              המסך.
            </p>
            <button type="button" className="press" onClick={finish} style={{ ...primaryButtonStyle, width: '100%' }}>
              מעבר לעריכת התפריט
            </button>
          </div>
        )}
      </div>
    </SheetShell>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 'var(--tap-min)',
  borderRadius: 12,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '0 12px',
  fontSize: '0.9rem',
}

const primaryButtonStyle: React.CSSProperties = {
  minHeight: 'var(--tap-min)',
  borderRadius: 14,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontWeight: 700,
  cursor: 'pointer',
}

const secondaryButtonStyle: React.CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '0 16px',
  borderRadius: 14,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  fontWeight: 600,
  cursor: 'pointer',
}
