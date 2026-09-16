'use client'

import { useState } from 'react'
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import Switch from '@/components/Switch'
import { randomId } from '@/lib/menu/id'
import type { PortalReview, PortalReviewsBlock, ReviewLang } from '@/lib/reviews'

// No AyekaBar UI to port here (confirmed: its reviews feature is
// backend-only — a working schema/PATCH endpoint with nothing ever wired
// up to call it) — built fresh, reusing BranchLinksEditor's dirty-tracking/
// save/notice chrome and the same add/reorder/delete interaction shape
// CategoryAccordion already uses for menu items.

export default function BranchReviewsEditor({ branchId, initial }: { branchId: string; initial: PortalReviewsBlock }) {
  const [block, setBlock] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  const dirty = JSON.stringify(block) !== JSON.stringify(saved)

  function updateItem(index: number, patch: Partial<PortalReview>) {
    setBlock((b) => ({ ...b, items: b.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }))
  }
  function addItem() {
    setBlock((b) => ({ ...b, items: [...b.items, { id: randomId('r'), stars: 5, lang: 'he', text: '', visible: true }] }))
  }
  function removeItem(index: number) {
    setBlock((b) => ({ ...b, items: b.items.filter((_, i) => i !== index) }))
  }
  function moveItem(index: number, dir: -1 | 1) {
    setBlock((b) => {
      const target = index + dir
      if (target < 0 || target >= b.items.length) return b
      const items = [...b.items]
      const tmp = items[index]!
      items[index] = items[target]!
      items[target] = tmp
      return { ...b, items }
    })
  }

  async function save() {
    // Drop rows the owner started but never typed into — sending an empty
    // review would just bounce off the server's own validation anyway.
    const cleanItems = block.items.filter((it) => it.text.trim())
    setSaving(true)
    setNotice(null)
    try {
      const res = await fetch('/api/owner/branches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, reviews: { ...block, items: cleanItems } }),
      })
      const payload = await res.json()
      if (!res.ok) {
        setNotice({ type: 'error', text: payload?.error?.message ?? 'שגיאה בשמירה' })
        return
      }
      setBlock(payload.reviews)
      setSaved(payload.reviews)
      setNotice({ type: 'ok', text: 'נשמר ✓' })
    } catch {
      setNotice({ type: 'error', text: 'שגיאה בשמירה' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>דירוג כללי</span>
          <input
            type="number"
            min={0}
            max={5}
            step={0.1}
            value={block.rating}
            onChange={(e) => setBlock((b) => ({ ...b, rating: Number(e.target.value) }))}
            className="ltr-isolate"
            style={inputStyle}
          />
        </label>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>מספר ביקורות (לתצוגה)</span>
          <input
            type="number"
            min={0}
            step={1}
            value={block.count}
            onChange={(e) => setBlock((b) => ({ ...b, count: Number(e.target.value) }))}
            className="ltr-isolate"
            style={inputStyle}
          />
        </label>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {block.items.map((item, index) => (
          <div key={item.id} style={cardStyle}>
            <textarea
              placeholder="תוכן הביקורת"
              value={item.text}
              onChange={(e) => updateItem(index, { text: e.target.value })}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={item.stars}
                onChange={(e) => updateItem(index, { stars: Number(e.target.value) })}
                style={smallControlStyle}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}★
                  </option>
                ))}
              </select>
              <select
                value={item.lang}
                onChange={(e) => updateItem(index, { lang: e.target.value as ReviewLang })}
                style={smallControlStyle}
              >
                <option value="he">עברית</option>
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </select>
              <input
                placeholder="הערה פנימית (לא מוצג באתר)"
                value={item.author ?? ''}
                onChange={(e) => updateItem(index, { author: e.target.value })}
                style={{ ...smallControlStyle, flex: 1, minWidth: 120 }}
              />
              <button
                type="button"
                role="switch"
                aria-checked={item.visible !== false}
                aria-label="מוצג באתר"
                title="מוצג באתר"
                className="press"
                onClick={() => updateItem(index, { visible: item.visible === false })}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}
              >
                <Switch on={item.visible !== false} />
              </button>
              <span style={{ flex: 1 }} />
              <IconBtn label="הזזה למעלה" disabled={index === 0} onClick={() => moveItem(index, -1)}>
                <ChevronUp size={14} />
              </IconBtn>
              <IconBtn label="הזזה למטה" disabled={index === block.items.length - 1} onClick={() => moveItem(index, 1)}>
                <ChevronDown size={14} />
              </IconBtn>
              <IconBtn label="מחיקת הביקורת" onClick={() => removeItem(index)}>
                <Trash2 size={14} />
              </IconBtn>
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="press" onClick={addItem} style={dashedButtonStyle}>
        <Plus size={15} aria-hidden="true" /> הוספת ביקורת
      </button>

      {notice && (
        <p
          role={notice.type === 'error' ? 'alert' : 'status'}
          style={{ margin: 0, fontSize: '0.8rem', color: notice.type === 'error' ? '#ff6b6b' : 'var(--neon-2)' }}
        >
          {notice.text}
        </p>
      )}

      <button
        type="button"
        className="press"
        onClick={save}
        disabled={!dirty || saving}
        style={{ ...saveButtonStyle, opacity: !dirty || saving ? 0.6 : 1 }}
      >
        {saving ? 'שומר…' : 'שמירת ביקורות'}
      </button>
    </div>
  )
}

function IconBtn({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className="press"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        border: '1px solid var(--line-strong)',
        background: 'var(--bg-elev-2)',
        color: 'var(--text)',
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? 'default' : 'pointer',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {children}
    </button>
  )
}

const labelStyle: React.CSSProperties = { fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-dim)' }

const inputStyle: React.CSSProperties = {
  minHeight: 'var(--tap-min)',
  borderRadius: 10,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '10px 12px',
  fontSize: '0.85rem',
  fontFamily: 'inherit',
}

const smallControlStyle: React.CSSProperties = {
  minHeight: 36,
  borderRadius: 8,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '0 8px',
  fontSize: '0.8rem',
}

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
}

const dashedButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  width: '100%',
  minHeight: 44,
  borderRadius: 10,
  border: '1px dashed var(--line-strong)',
  background: 'transparent',
  color: 'var(--text-dim)',
  fontSize: '0.85rem',
  cursor: 'pointer',
}

const saveButtonStyle: React.CSSProperties = {
  minHeight: 'var(--tap-min)',
  borderRadius: 999,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontWeight: 700,
  fontSize: '0.9rem',
  cursor: 'pointer',
}
