'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { InlineError, Notice } from '@/components/shifts/ui'
import { addDays, formatDateLabel, weekDates, weekdayLongLabel } from '@/lib/shifts/time'
import type { AvailabilityEntry, AvailabilityKind } from '@/lib/shifts/types'

const KIND_LABELS: Record<Exclude<AvailabilityKind, 'partial'>, string> = { unavailable: 'לא זמין/ה', prefer: 'מעדיף/ה לעבוד' }

// "Which days can I NOT work?" — for the week after the one on the schedule tab.
// Only exceptions are stored: a day with nothing marked means "available". The
// manager sees what is submitted, and the scheduler warns before putting someone
// on a day they said they cannot do. Saving and submitting both say so, in words.
export default function AvailabilityPortal() {
  const { db, dispatch, weekStart, setWeekStart } = useShifts()
  const target = addDays(weekStart, 7)
  const existing = db?.availability.find((a) => a.weekStart === target && a.staffId === db.viewerStaffId)

  const [entries, setEntries] = useState<AvailabilityEntry[]>(existing?.entries ?? [])
  const [note, setNote] = useState(existing?.note ?? '')
  const [saving, setSaving] = useState<'draft' | 'submitted' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setEntries(existing?.entries ?? [])
    setNote(existing?.note ?? '')
    setError(null)
    // Re-syncs only when the target week changes, deliberately not on every `existing`
    // identity change (a background refresh would otherwise stomp an unsaved edit).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  if (!db || !db.settings.features.availability) return null
  const isPast = addDays(target, 6) < db.now.date
  const dates = weekDates(target)
  const dirty = JSON.stringify(entries) !== JSON.stringify(existing?.entries ?? []) || note !== (existing?.note ?? '')

  function setKind(date: string, kind: AvailabilityKind | null) {
    setEntries((prev) => {
      const rest = prev.filter((e) => e.date !== date)
      return kind ? [...rest, { date, kind }] : rest
    })
  }

  async function submit(status: 'draft' | 'submitted') {
    setSaving(status)
    setError(null)
    const res = await dispatch(
      { type: 'submitAvailability', branchId: db!.branchId, weekStart: target, entries, note: note.trim() || null, status },
      {
        quiet: true,
        success: status === 'submitted' ? 'הזמינות הוגשה ✓ המנהל/ת יראו אותה, והיא תילקח בחשבון בשיבוץ.' : 'נשמר כטיוטה ✓ (עוד לא הוגש למנהל/ת)',
      }
    )
    setSaving(null)
    if (!res.ok) setError(res.message)
  }

  return (
    <div className="sch-wrap">
      <div className="sch-weeknav">
        <button type="button" className="sch-iconbtn press" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="שבוע קודם">
          <span className="dir-flip" aria-hidden="true" style={{ fontSize: '1.3rem' }}>
            ‹
          </span>
        </button>
        <div className="sch-weeknav__label">
          <strong className="ltr-isolate">
            {formatDateLabel(target)} – {formatDateLabel(weekDates(target)[6]!)}
          </strong>
          <span>הזמינות שלכם לשבוע הזה</span>
        </div>
        <button type="button" className="sch-iconbtn press" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="שבוע הבא">
          <span className="dir-flip" aria-hidden="true" style={{ fontSize: '1.3rem' }}>
            ›
          </span>
        </button>
      </div>

      <p className="sch-sub">סמנו רק את הימים שבהם <strong>אי אפשר</strong> לכם לעבוד (או שאתם מעדיפים לעבוד). יום שלא סימנתם — אתם זמינים.</p>

      {existing?.status === 'submitted' && !dirty && (
        <p className="sch-pill sch-pill--ok" style={{ alignSelf: 'flex-start' }}>
          <CheckCircle2 size={14} aria-hidden="true" /> הוגש למנהל/ת
        </p>
      )}
      {isPast && <Notice tone="info">השבוע הזה כבר עבר — אי אפשר לשנות בו זמינות.</Notice>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {dates.map((date, dow) => {
          const entry = entries.find((e) => e.date === date)
          return (
            <div key={date} className="sch-card" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px' }}>
              <span style={{ flex: '1 1 110px', fontWeight: 700 }}>
                {weekdayLongLabel(dow)} <span className="sch-faint ltr-isolate" style={{ fontSize: '0.8rem', fontWeight: 600 }}>{formatDateLabel(date)}</span>
              </span>
              {(['unavailable', 'prefer'] as const).map((k) => {
                const active = entry?.kind === k
                return (
                  <button key={k} type="button" className="sch-chip press" aria-pressed={active} disabled={isPast} onClick={() => setKind(date, active ? null : k)}>
                    {KIND_LABELS[k]}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      <label>
        <span className="sch-label">הערה למנהל/ת (לא חובה)</span>
        <input className="sch-input" value={note} maxLength={300} disabled={isPast} onChange={(e) => setNote(e.target.value)} placeholder="למשל: אני יכול/ה רק אחרי 10:00" />
      </label>

      {error && <InlineError>{error}</InlineError>}

      <div className="sch-row">
        <button type="button" className="sch-btn press" style={{ flex: 1 }} disabled={!!saving || isPast || !dirty} onClick={() => submit('draft')}>
          {saving === 'draft' ? 'שומר…' : 'שמירת טיוטה'}
        </button>
        <button type="button" className="sch-btn sch-btn--primary press" style={{ flex: 2 }} disabled={!!saving || isPast || (!dirty && existing?.status === 'submitted')} onClick={() => submit('submitted')}>
          {saving === 'submitted' ? 'שולח…' : existing?.status === 'submitted' ? 'הגשה מחדש' : 'הגשה למנהל/ת'}
        </button>
      </div>
    </div>
  )
}
