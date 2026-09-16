'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { addDays, formatDateLabel, weekDates, weekdayLabel } from '@/lib/shifts/time'
import type { AvailabilityEntry, AvailabilityKind } from '@/lib/shifts/types'

const KIND_LABELS: Record<AvailabilityKind, string> = { unavailable: 'לא זמין/ה', partial: 'חלקי', prefer: 'מעדיף/ה' }

// Staff-side per-day availability for NEXT week (this week is already
// being built/published). "Available" is the absence of an entry — only
// exceptions are stored, matching shift_availability's own design.
export default function AvailabilityPortal() {
  const { db, dispatch, weekStart } = useShifts()
  const nextWeekStart = addDays(weekStart, 7)
  const existing = db?.availability.find((a) => a.weekStart === nextWeekStart && a.staffId === db.viewerStaffId)

  const [entries, setEntries] = useState<AvailabilityEntry[]>(existing?.entries ?? [])
  const [note, setNote] = useState(existing?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setEntries(existing?.entries ?? [])
    setNote(existing?.note ?? '')
    // Re-syncs only when the target week changes, deliberately not on
    // every `existing` identity change (a fresh dispatch reload would
    // otherwise stomp an in-progress, unsaved edit).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextWeekStart])

  if (!db || !db.settings.features.availability) return null

  const dates = weekDates(nextWeekStart)

  function setKind(date: string, kind: AvailabilityKind | null) {
    setEntries((prev) => {
      const rest = prev.filter((e) => e.date !== date)
      return kind ? [...rest, { date, kind }] : rest
    })
  }

  async function submit(status: 'draft' | 'submitted') {
    setSaving(true)
    setNotice(null)
    const ok = await dispatch({ type: 'submitAvailability', branchId: db!.branchId, weekStart: nextWeekStart, entries, note: note || null, status })
    setSaving(false)
    setNotice(ok ? (status === 'submitted' ? 'הזמינות הוגשה ✓' : 'נשמר כטיוטה ✓') : null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-dim)' }}>
        זמינות לשבוע {formatDateLabel(nextWeekStart)}
        {existing?.status === 'submitted' && ' · הוגש'}
      </p>

      {dates.map((date, dow) => {
        const entry = entries.find((e) => e.date === date)
        return (
          <div key={date} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ width: 64, fontSize: '0.82rem', fontWeight: 600 }}>{weekdayLabel(dow)}</span>
            {(['unavailable', 'prefer'] as AvailabilityKind[]).map((k) => {
              const active = entry?.kind === k
              return (
                <button
                  key={k}
                  type="button"
                  className="press"
                  aria-pressed={active}
                  onClick={() => setKind(date, active ? null : k)}
                  style={chipStyle(active)}
                >
                  {KIND_LABELS[k]}
                </button>
              )
            })}
          </div>
        )
      })}

      <label>
        <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: 4 }}>הערה</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} />
      </label>

      {notice && (
        <p role="status" style={{ margin: 0, fontSize: '0.8rem', color: 'var(--neon-2)' }}>
          {notice}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="press" disabled={saving} onClick={() => submit('draft')} style={secondaryBtnStyle}>
          שמירת טיוטה
        </button>
        <button type="button" className="press" disabled={saving} onClick={() => submit('submitted')} style={primaryBtnStyle}>
          {saving ? 'שולח…' : 'הגשה'}
        </button>
      </div>
    </div>
  )
}

function chipStyle(active: boolean): CSSProperties {
  return {
    minHeight: 32,
    padding: '0 12px',
    borderRadius: 999,
    border: `1px solid ${active ? 'var(--neon)' : 'var(--line-strong)'}`,
    background: active ? 'rgba(255,122,69,0.14)' : 'var(--bg-elev)',
    color: active ? 'var(--neon-soft)' : 'var(--text-dim)',
    fontSize: '0.78rem',
    fontWeight: 600,
    cursor: 'pointer',
  }
}

const inputStyle: CSSProperties = {
  width: '100%',
  minHeight: 'var(--tap-min)',
  borderRadius: 10,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  padding: '0 10px',
  fontSize: '0.85rem',
}
const primaryBtnStyle: CSSProperties = {
  flex: 2,
  minHeight: 'var(--tap-min)',
  borderRadius: 999,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontWeight: 700,
  fontSize: '0.85rem',
  cursor: 'pointer',
}
const secondaryBtnStyle: CSSProperties = {
  flex: 1,
  minHeight: 'var(--tap-min)',
  borderRadius: 999,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  fontWeight: 600,
  fontSize: '0.85rem',
  cursor: 'pointer',
}
