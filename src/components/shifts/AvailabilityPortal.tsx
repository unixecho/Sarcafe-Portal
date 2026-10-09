'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, CalendarPlus, Clock3 } from 'lucide-react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { InlineError, Notice } from '@/components/shifts/ui'
import { addDays, formatDateLabel, formatShiftRange, requestDeadline, requestsOpen, weekDates, weekdayLongLabel } from '@/lib/shifts/time'
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
  const [requestBusy, setRequestBusy] = useState<string | null>(null)

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
  const closed = !requestsOpen(target, db.now)
  const locked = isPast || closed
  const dates = weekDates(target)
  const choices = db.planningShifts.filter((s) => s.date >= target && s.date <= addDays(target, 6))
  const dirty = JSON.stringify(entries) !== JSON.stringify(existing?.entries ?? []) || note !== (existing?.note ?? '')

  function setKind(date: string, kind: AvailabilityKind | null) {
    setEntries((prev) => {
      const rest = prev.filter((e) => e.date !== date)
      return kind ? [...rest, { date, kind, ...(kind === 'partial' ? { from: db!.settings.openTime, to: db!.settings.closeTime } : {}) }] : rest
    })
  }

  function setTime(date: string, field: 'from' | 'to', value: string) {
    setEntries((prev) => prev.map((e) => e.date === date ? { ...e, [field]: value } : e))
  }

  async function request(shiftId: string) {
    setRequestBusy(shiftId)
    setError(null)
    const res = await dispatch({ type: 'requestShift', shiftId, note: note.trim() || null }, { quiet: true, success: 'הבקשה נשלחה למנהל/ת. השיבוץ ייקבע לאחר האישור ופרסום הלוח.' })
    if (!res.ok) setError(res.message)
    setRequestBusy(null)
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
          <span>הבקשות שלכם לשבוע הזה</span>
        </div>
        <button type="button" className="sch-iconbtn press" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="שבוע הבא">
          <span className="dir-flip" aria-hidden="true" style={{ fontSize: '1.3rem' }}>
            ›
          </span>
        </button>
      </div>

      <div className={`sch-card ${closed ? '' : 'sch-card--attention'}`}>
        <div className="sch-row"><Clock3 size={18} aria-hidden="true" /><strong>{closed ? 'הגשת הבקשות נסגרה' : `מגישים עד יום שלישי ${formatDateLabel(requestDeadline(target))}`}</strong></div>
        <p className="sch-sub">{closed ? 'המנהל/ת מכינים את הלוח. לשינוי מאוחר פנו אליהם. לאחר הפרסום אפשר לבקש החלפה.' : 'עד חצות, שעון ישראל. סמנו זמינות ובחרו משמרות מועדפות; המנהל/ת מחליטים על השיבוץ.'}</p>
      </div>
      <p className="sch-sub">סמנו ימים שבהם <strong>אי אפשר</strong> לכם לעבוד, שעות חלקיות או העדפה. יום שלא סימנתם — אתם זמינים.</p>

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
              {(['unavailable', 'prefer', 'partial'] as const).map((k) => {
                const active = entry?.kind === k
                return (
                  <button key={k} type="button" className="sch-chip press" aria-pressed={active} disabled={locked} onClick={() => setKind(date, active ? null : k)}>
                    {k === 'partial' ? 'שעות מסוימות' : KIND_LABELS[k]}
                  </button>
                )
              })}
              {entry?.kind === 'partial' && <div className="sch-row" style={{ width: '100%' }}>
                <label style={{ flex: 1 }}><span className="sch-label">משעה</span><input type="time" className="sch-input ltr-isolate" value={entry.from ?? ''} disabled={locked} onChange={(e) => setTime(date, 'from', e.target.value)} /></label>
                <label style={{ flex: 1 }}><span className="sch-label">עד שעה</span><input type="time" className="sch-input ltr-isolate" value={entry.to ?? ''} disabled={locked} onChange={(e) => setTime(date, 'to', e.target.value)} /></label>
              </div>}
            </div>
          )
        })}
      </div>

      <label>
        <span className="sch-label">הערה למנהל/ת (לא חובה)</span>
        <input className="sch-input" value={note} maxLength={300} disabled={locked} onChange={(e) => setNote(e.target.value)} placeholder="משהו שחשוב למנהל/ת לדעת" />
      </label>

      {error && <InlineError>{error}</InlineError>}

      <div className="sch-row">
        <button type="button" className="sch-btn press" style={{ flex: 1 }} disabled={!!saving || locked || !dirty} onClick={() => submit('draft')}>
          {saving === 'draft' ? 'שומר…' : 'שמירת טיוטה'}
        </button>
        <button type="button" className="sch-btn sch-btn--primary press" style={{ flex: 2 }} disabled={!!saving || locked || (!dirty && existing?.status === 'submitted')} onClick={() => submit('submitted')}>
          {saving === 'submitted' ? 'שולח…' : existing?.status === 'submitted' ? 'הגשה מחדש' : 'הגשה למנהל/ת'}
        </button>
      </div>

      <section className="sch-wrap" aria-label="בקשות למשמרות">
        <div className="sch-row"><CalendarPlus size={19} aria-hidden="true" /><h3 className="sch-h">משמרות שתרצו לעבוד בהן</h3></div>
        <p className="sch-sub">רק משמרות שהמנהל/ת פתחו לבקשות זמינות כאן. הבקשה נשלחת מיד, והשיבוץ הסופי מופיע אחרי אישור ופרסום.</p>
        {choices.length === 0 && <p className="sch-sub">עוד לא הוגדרו משמרות לשבוע הזה. אפשר להגיש זמינות בינתיים.</p>}
        {choices.map((s) => {
          const r = db.requests.find((r) => r.shiftId === s.id && r.staffId === db.viewerStaffId && (r.status === 'pending' || r.status === 'approved'))
          const preset = db.settings.presets.find((p) => p.id === s.presetId)
          return <div key={s.id} className="sch-card sch-choice-row">
            <div style={{ flex: 1 }}><strong>{weekdayLongLabel(new Date(`${s.date}T00:00:00Z`).getUTCDay())} {formatDateLabel(s.date)}</strong><p className="sch-sub"><span className="ltr-isolate">{formatShiftRange(s.startTime, s.endTime)}</span>{preset ? ` · ${preset.name}` : ''}</p></div>
            {r ? <span className={`sch-pill sch-pill--${r.status === 'approved' ? 'ok' : 'info'}`}>{r.status === 'approved' ? 'אושרה' : 'הבקשה נשלחה'}</span> : s.requestsOpen ? <button type="button" className="sch-btn sch-btn--sm press" disabled={locked || !!requestBusy} onClick={() => request(s.id)}>{requestBusy === s.id ? 'שולח…' : 'לבקש משמרת'}</button> : <span className="sch-pill sch-pill--neutral">לא פתוחה לבקשות</span>}
          </div>
        })}
      </section>
    </div>
  )
}
