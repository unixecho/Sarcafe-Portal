'use client'

import { useId, useState, type CSSProperties } from 'react'
import { Trash2 } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { haptic } from '@/lib/haptics'
import { useCart } from '@/components/cart/CartProvider'
import { localized, type Lang } from '@/lib/menu/types'
import type { CartAction } from '@/lib/cart/store'
import type { CartLine } from '@/lib/cart/types'

type Mode = 'edit' | 'readout'
type Group = { categoryId: string; title: string; lines: CartLine[] }

function groupByCategory(lines: CartLine[], lang: Lang): Group[] {
  const byId = new Map<string, Group>()
  for (const line of lines) {
    const existing = byId.get(line.categoryId)
    if (existing) {
      existing.lines.push(line)
    } else {
      byId.set(line.categoryId, { categoryId: line.categoryId, title: localized(line.categoryTitle, lang) || '—', lines: [line] })
    }
  }
  return [...byId.values()]
}

function lineLabel(line: CartLine, lang: Lang): string {
  const name = localized(line.name, lang) || '—'
  const type = line.typeLabel ? localized(line.typeLabel, lang) : ''
  return type ? `${name} — ${type}` : name
}

// The two modes AyekaBar's own cart sheet uses: EDIT is what the customer
// manipulates (steppers, remove); READOUT is large static text grouped by
// category — what's actually shown to staff at the counter, the whole
// point of this feature.
export default function CartSheet({ open, onClose, lang }: { open: boolean; onClose: () => void; lang: Lang }) {
  const { cart, dispatch } = useCart()
  const ids = useId()
  const titleId = `${ids}-title`
  const [mode, setMode] = useState<Mode>('edit')

  const groups = groupByCategory(cart.lines, lang)

  return (
    <SheetShell open={open} onClose={onClose} labelledBy={titleId}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <h2 id={titleId} style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, flex: 1 }}>
          הרשימה שלי
        </h2>
        {cart.lines.length > 0 && (
          <div role="group" aria-label="תצוגה" style={{ display: 'flex', gap: 3, background: 'var(--bg-elev-2)', borderRadius: 999, padding: 3 }}>
            <button type="button" className="press" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')} style={toggleBtnStyle(mode === 'edit')}>
              עריכה
            </button>
            <button type="button" className="press" aria-pressed={mode === 'readout'} onClick={() => setMode('readout')} style={toggleBtnStyle(mode === 'readout')}>
              הצגה לצוות
            </button>
          </div>
        )}
      </div>

      {cart.lines.length === 0 ? (
        <p style={{ color: 'var(--text-dim)', fontSize: '0.88rem', padding: '28px 0', textAlign: 'center' }}>הרשימה ריקה.</p>
      ) : (
        <div className="sheet-scroll" style={{ paddingTop: 10 }}>
          {mode === 'readout' ? <ReadoutView groups={groups} lang={lang} /> : <EditView groups={groups} lang={lang} dispatch={dispatch} />}
        </div>
      )}

      {cart.lines.length > 0 && mode === 'edit' && (
        <button
          type="button"
          className="press"
          onClick={() => {
            haptic('impact')
            dispatch({ type: 'clear' })
          }}
          style={clearBtnStyle}
        >
          <Trash2 size={14} aria-hidden="true" /> ריקון הרשימה
        </button>
      )}
    </SheetShell>
  )
}

function EditView({ groups, lang, dispatch }: { groups: Group[]; lang: Lang; dispatch: (action: CartAction) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {groups.map((group) => (
        <section key={group.categoryId}>
          <h3 style={groupTitleStyle}>{group.title}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {group.lines.map((line) => (
              <div key={line.id} style={editRowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>{lineLabel(line, lang)}</p>
                  {line.note && <p style={{ margin: '2px 0 0', fontSize: '0.76rem', color: 'var(--text-faint)' }}>{line.note}</p>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={stepperStyle}>
                    <button
                      type="button"
                      className="press"
                      onClick={() => dispatch({ type: 'decrement', id: line.id })}
                      aria-label="הפחתה"
                      style={stepBtnStyle}
                    >
                      −
                    </button>
                    <span style={{ minWidth: 16, textAlign: 'center', fontSize: '0.85rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {line.qty}
                    </span>
                    <button
                      type="button"
                      className="press"
                      onClick={() => dispatch({ type: 'increment', id: line.id })}
                      aria-label="הוספה"
                      style={stepBtnStyle}
                    >
                      +
                    </button>
                  </div>
                  <button type="button" className="press" onClick={() => dispatch({ type: 'remove', id: line.id })} aria-label="הסרה מהרשימה" style={removeBtnStyle}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

// Large, static, unambiguous — this is what gets held up to the barista,
// so it favors legibility over any interactivity at all.
function ReadoutView({ groups, lang }: { groups: Group[]; lang: Lang }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {groups.map((group) => (
        <section key={group.categoryId}>
          <h3 style={groupTitleStyle}>{group.title}</h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {group.lines.map((line) => (
              <li key={line.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--neon-soft)', minWidth: 26 }}>{line.qty}×</span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: '1rem', fontWeight: 700 }}>{lineLabel(line, lang)}</span>
                  {line.note && <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-dim)' }}>{line.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function toggleBtnStyle(active: boolean): CSSProperties {
  return {
    minHeight: 30,
    padding: '0 12px',
    borderRadius: 999,
    border: 'none',
    background: active ? 'var(--neon)' : 'transparent',
    color: active ? 'var(--bg)' : 'var(--text-dim)',
    fontSize: '0.76rem',
    fontWeight: 700,
    cursor: 'pointer',
  }
}

const groupTitleStyle: CSSProperties = { margin: '0 0 8px', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-faint)' }

const editRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  borderRadius: 12,
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
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

const clearBtnStyle: CSSProperties = {
  marginTop: 14,
  width: '100%',
  minHeight: 'var(--tap-min)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  borderRadius: 14,
  border: '1px solid rgba(255,107,107,0.3)',
  background: 'transparent',
  color: '#ff6b6b',
  fontSize: '0.85rem',
  fontWeight: 600,
  cursor: 'pointer',
}
