'use client'

import { useId, useMemo, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import Switch from '@/components/Switch'
import { TimeWheel } from '@/components/WheelPicker'
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
function allUids(draft: MenuDoc): string[] {
  return draft.categories.flatMap((c) => c.items.map((i) => i.uid).filter((u): u is string => !!u))
}

export default function VariantWizard({ open, onClose, branchSlug, draft, onCreated }: VariantWizardProps) {
  const titleId = useId()
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState({ he: '', en: '', ar: '' })
  // Starts with EVERYTHING excluded — the owner builds the variant up by
  // picking what to include, category by category, rather than starting
  // from "everything shown" and remembering to turn things off. This is a
  // UI-default choice only: the wizard still submits excludedUids the same
  // way either direction, so it doesn't touch the reason the underlying
  // variant STORAGE is itself subtractive (see the module doc above) — an
  // item added to the menu after this variant already exists still isn't
  // in this variant's excluded_uids either way, so it still appears.
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set(allUids(draft)))
  // Every category starts collapsed — expanding one only reveals it, it
  // never selects anything.
  const [openCategoryIds, setOpenCategoryIds] = useState<Set<string>>(new Set())
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
    setExcluded(new Set(allUids(draft)))
    setOpenCategoryIds(new Set())
    setScheduleEnabled(false)
    setDays(new Set())
    setStart('')
    setEnd('')
    setActivateNow(false)
    setError(null)
  }

  function toggleOpen(id: string) {
    setOpenCategoryIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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
      // allOff is the TARGET state ("make everything in this category
      // excluded"), so true adds to the excluded set and false removes —
      // this was inverted before, which made "הסתרת הכל" show everything
      // and "החזרת הכל" hide it.
      uids.forEach((uid) => (allOff ? next.add(uid) : next.delete(uid)))
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
                const selectedCount = uids.filter((uid) => !excluded.has(uid)).length
                const state: 'all' | 'none' | 'some' = selectedCount === 0 ? 'none' : selectedCount === uids.length ? 'all' : 'some'
                const isOpen = openCategoryIds.has(category.id)
                const catLabel = localized(category.title, 'he') || 'קטגוריה'
                return (
                  <div key={category.id} style={{ marginBottom: 8, borderRadius: 12, border: '1px solid var(--line)', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px' }}>
                      <TriStateCheckbox state={state} onClick={() => toggleCategory(uids, state === 'all')} label={`בחירת הכל — ${catLabel}`} />
                      <button
                        type="button"
                        className="press"
                        onClick={() => toggleOpen(category.id)}
                        aria-expanded={isOpen}
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          background: 'none',
                          border: 'none',
                          textAlign: 'start',
                          cursor: 'pointer',
                          padding: '4px 0',
                          color: 'var(--text)',
                        }}
                      >
                        <span style={{ flex: 1, fontWeight: 700, fontSize: '0.9rem' }}>
                          {category.icon} {catLabel}
                        </span>
                        <span style={{ fontSize: '0.76rem', color: 'var(--text-faint)' }}>
                          {selectedCount}/{uids.length}
                        </span>
                        <ChevronDown
                          size={16}
                          aria-hidden="true"
                          style={{ color: 'var(--text-faint)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s var(--ease)' }}
                        />
                      </button>
                    </div>
                    {isOpen && (
                      <div className="rise" style={{ padding: '0 12px 10px 44px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {category.items.map((item) => {
                          const uid = item.uid
                          if (!uid) return null
                          const checked = !excluded.has(uid)
                          return (
                            <button
                              key={uid}
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              className="press"
                              onClick={() => toggleItem(uid)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '7px 4px',
                                fontSize: '0.85rem',
                                background: 'none',
                                border: 'none',
                                textAlign: 'start',
                                color: 'var(--text)',
                                cursor: 'pointer',
                              }}
                            >
                              <ItemCheckbox checked={checked} />
                              {localized(item, 'he')}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}

              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: '0.85rem' }}>הפעלה אוטומטית לפי לוח זמנים שבועי</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={scheduleEnabled}
                    className="press"
                    onClick={() => setScheduleEnabled((v) => !v)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                  >
                    <Switch on={scheduleEnabled} />
                  </button>
                </div>
                {scheduleEnabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {DAY_LABELS.map((label, i) => (
                        <button
                          key={i}
                          type="button"
                          className="press"
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
                    <div className="ltr-isolate" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center' }}>
                      <TimeWheel value={start || '00:00'} onChange={setStart} label="שעת התחלה" />
                      <span aria-hidden="true" style={{ color: 'var(--text-faint)' }}>—</span>
                      <TimeWheel value={end || '00:00'} onChange={setEnd} label="שעת סיום" />
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.85rem' }}>הצגה ללקוחות מיד עם השמירה</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={activateNow}
                    className="press"
                    onClick={() => setActivateNow((v) => !v)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                  >
                    <Switch on={activateNow} />
                  </button>
                </div>
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

/** A category's "select all" control — tri-state (none/some/all), the
 * exact shape Switch's own doc comment reserves for "a category with
 * mixed items" (§5.4), but built as a checkbox rather than a switch since
 * this multi-selects a LIST, not a single on/off setting. Border uses
 * --line-interactive when unchecked — it's the control's entire graphical
 * identity in that state (WCAG 1.4.11, §3.2 pass 3), same rule Switch's
 * own off-track follows. */
function TriStateCheckbox({ state, onClick, label }: { state: 'all' | 'none' | 'some'; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'some' ? 'mixed' : state === 'all'}
      aria-label={label}
      className="press"
      onClick={onClick}
      style={{
        width: 24,
        height: 24,
        borderRadius: 7,
        border: `1.5px solid ${state === 'none' ? 'var(--line-interactive)' : 'var(--neon)'}`,
        background: state === 'none' ? 'transparent' : 'var(--neon)',
        display: 'grid',
        placeItems: 'center',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {state === 'all' && <Check size={15} strokeWidth={3} aria-hidden="true" style={{ color: 'var(--bg)' }} />}
      {state === 'some' && <span aria-hidden="true" style={{ width: 9, height: 2, borderRadius: 1, background: 'var(--bg)' }} />}
    </button>
  )
}

/** One item's checkbox inside an expanded category — decoration only; the
 * whole row is the actual button (see the item's onClick above), same
 * "the caller owns the semantics" split Switch itself uses. */
function ItemCheckbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        border: `1.5px solid ${checked ? 'var(--neon)' : 'var(--line-interactive)'}`,
        background: checked ? 'var(--neon)' : 'transparent',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}
    >
      {checked && <Check size={14} strokeWidth={3} style={{ color: 'var(--bg)' }} />}
    </span>
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
