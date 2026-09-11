'use client'

import { useId, useMemo, useState } from 'react'
import SheetShell from '@/components/SheetShell'
import type { MenuDoc, MenuVariant } from '@/lib/menu/types'
import { localized } from '@/lib/menu/types'

const DAY_LABELS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'] // Sun..Sat, matches JS getDay()

type VariantWizardProps = {
  open: boolean
  onClose: () => void
  branchSlug: string
  draft: MenuDoc
  onCreated: (variant: MenuVariant) => void
}

/**
 * Creates a named, subtractive menu variant ("Friday menu"): everything
 * starts ON, the owner toggles OFF what's not served today. Subtractive by
 * design — a new item added to the menu later must appear in every
 * existing variant by default, never silently vanish from one nobody
 * re-checked. Ported concept from AyekaBar's VariantWizard.
 */
export default function VariantWizard({ open, onClose, branchSlug, draft, onCreated }: VariantWizardProps) {
  const titleId = useId()
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState({ he: '', en: '', ar: '' })
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [days, setDays] = useState<Set<number>>(new Set())
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [activateNow, setActivateNow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalItems = useMemo(() => draft.categories.reduce((n, c) => n + c.items.length, 0), [draft])

  function reset() {
    setStep(1)
    setName({ he: '', en: '', ar: '' })
    setExcluded(new Set())
    setScheduleEnabled(false)
    setDays(new Set())
    setStart('')
    setEnd('')
    setActivateNow(false)
    setError(null)
  }

  function close() {
    reset()
    onClose()
  }

  function toggleItem(uid: string) {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  function toggleCategory(uids: string[], allOff: boolean) {
    setExcluded((prev) => {
      const next = new Set(prev)
      uids.forEach((uid) => (allOff ? next.delete(uid) : next.add(uid)))
      return next
    })
  }

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/owner/menu-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: branchSlug,
          name,
          excludedUids: Array.from(excluded),
          scheduleEnabled,
          scheduleDays: Array.from(days),
          scheduleStart: scheduleEnabled && start ? start : null,
          scheduleEnd: scheduleEnabled && end ? end : null,
          activateNow,
        }),
      })
      const payload = await res.json()
      if (!res.ok) {
        setError(payload?.error?.message ?? 'שגיאה ביצירת הגרסה')
        return
      }
      onCreated(payload.variant)
      close()
    } catch {
      setError('שגיאה ביצירת הגרסה')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <SheetShell open={open} onClose={close} labelledBy={titleId} className="rise">
      <div style={{ padding: '4px 4px 8px', maxHeight: '75dvh', display: 'flex', flexDirection: 'column' }}>
        <h2 id={titleId} style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: 700 }}>
          גרסת תפריט חדשה
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: 'var(--text-faint)' }}>
          שלב {step} מתוך 2 — {step === 1 ? 'שם הגרסה' : `${totalItems - excluded.size} מתוך ${totalItems} פריטים יוצגו`}
        </p>

        {step === 1 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              autoFocus
              placeholder="שם הגרסה (למשל: תפריט שישי)"
              value={name.he}
              onChange={(event) => setName((n) => ({ ...n, he: event.target.value }))}
              style={inputStyle}
            />
            <input
              placeholder="English name (optional)"
              dir="ltr"
              value={name.en}
              onChange={(event) => setName((n) => ({ ...n, en: event.target.value }))}
              style={inputStyle}
            />
            <button
              type="button"
              className="press"
              disabled={!name.he.trim()}
              onClick={() => setStep(2)}
              style={{ ...primaryButtonStyle, opacity: name.he.trim() ? 1 : 0.5, marginTop: 8 }}
            >
              המשך
            </button>
          </div>
        ) : (
          <>
            <div className="sheet-scroll" style={{ flex: 1 }}>
              {draft.categories.map((category) => {
                const uids = category.items.map((i) => i.uid).filter((u): u is string => !!u)
                const allOff = uids.length > 0 && uids.every((uid) => excluded.has(uid))
                return (
                  <div key={category.id} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <strong style={{ fontSize: '0.88rem' }}>
                        {category.icon} {localized(category.title, 'he')}
                      </strong>
                      <button
                        type="button"
                        onClick={() => toggleCategory(uids, !allOff)}
                        style={{ background: 'none', border: 'none', color: 'var(--neon-2)', fontSize: '0.78rem', cursor: 'pointer' }}
                      >
                        {allOff ? 'החזרת הכל' : 'הסתרת הכל'}
                      </button>
                    </div>
                    {category.items.map((item) => {
                      const uid = item.uid
                      if (!uid) return null
                      const isOff = excluded.has(uid)
                      return (
                        <label
                          key={uid}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '8px 4px',
                            fontSize: '0.85rem',
                            opacity: isOff ? 0.5 : 1,
                            cursor: 'pointer',
                          }}
                        >
                          <input type="checkbox" checked={!isOff} onChange={() => toggleItem(uid)} style={{ width: 18, height: 18 }} />
                          {localized(item, 'he')}
                        </label>
                      )
                    })}
                  </div>
                )
              })}

              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.85rem', marginBottom: 10 }}>
                  <input type="checkbox" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} />
                  הפעלה אוטומטית לפי לוח זמנים שבועי
                </label>
                {scheduleEnabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {DAY_LABELS.map((label, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() =>
                            setDays((prev) => {
                              const next = new Set(prev)
                              if (next.has(i)) next.delete(i)
                              else next.add(i)
                              return next
                            })
                          }
                          aria-pressed={days.has(i)}
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            border: `1px solid ${days.has(i) ? 'var(--neon)' : 'var(--line-strong)'}`,
                            background: days.has(i) ? 'rgba(255,122,69,0.14)' : 'transparent',
                            color: 'var(--text)',
                            cursor: 'pointer',
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="ltr-isolate" style={{ display: 'flex', gap: 8 }}>
                      <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle} />
                      <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle} />
                    </div>
                  </div>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.85rem' }}>
                  <input type="checkbox" checked={activateNow} onChange={(e) => setActivateNow(e.target.checked)} />
                  הצגה ללקוחות מיד עם השמירה
                </label>
              </div>
            </div>

            {error && (
              <p role="alert" style={{ color: '#ff6b6b', fontSize: '0.8rem', margin: '8px 0 0' }}>
                {error}
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="press" onClick={() => setStep(1)} style={secondaryButtonStyle}>
                חזרה
              </button>
              <button
                type="button"
                className="press"
                onClick={submit}
                disabled={saving || excluded.size >= totalItems}
                style={{ ...primaryButtonStyle, flex: 1, opacity: saving ? 0.7 : 1 }}
              >
                {saving ? 'שומר…' : 'יצירת גרסה'}
              </button>
            </div>
          </>
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
