'use client'

import { useState } from 'react'
import { CalendarPlus, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { InlineError } from '@/components/shifts/ui'
import TimeOffPortal from '@/components/shifts/TimeOffPortal'
import { addDays, formatDateLabel, formatShiftRange, hasStarted, requestDeadline, requestsOpen, weekDates, weekdayLongLabel } from '@/lib/shifts/time'

// "מה לא מתאים לי בשבוע הבא?" — the constraints (אילוצים) for the week after the one on the schedule tab, plus the
// shifts the manager opened for requests. The constraints themselves are TimeOffPortal: per day "cannot do the morning",
// "cannot do the evening" or "a whole day off", the manager's limits, a note, one send button. Before 2026-10-16 this
// screen also offered "only some hours" and "I would like to work", which employees no longer see; a submission that
// still carries them is shown to the manager as before (PlanningPanel) and left untouched when a note is sent.
export default function AvailabilityPortal() {
  const { db, dispatch, weekStart, setWeekStart } = useShifts()
  const target = addDays(weekStart, 7)
  const [error, setError] = useState<string | null>(null)
  const [requestBusy, setRequestBusy] = useState<string | null>(null)

  if (!db || !db.settings.features.availability) return null
  const closed = !requestsOpen(target, db.now)
  const targetWeek = db.weeks.find((week) => week.weekStart === target)
  const shiftRequestsLocked = targetWeek?.status !== 'published' && closed
  const requestChoices = [...(targetWeek?.status === 'published' ? db.shifts : db.planningShifts)]
  const choices = requestChoices.filter(
    (shift) =>
      shift.date >= target &&
      shift.date <= addDays(target, 6) &&
      shift.requestsOpen &&
      !hasStarted(shift, db.now) &&
      !db.assignments.some((assignment) => assignment.shiftId === shift.id && assignment.staffId === db.viewerStaffId)
  )

  async function request(shiftId: string) {
    setRequestBusy(shiftId)
    setError(null)
    const res = await dispatch({ type: 'requestShift', shiftId, note: null }, { quiet: true, success: 'הבקשה נשלחה למנהל/ת. השיבוץ ייקבע לאחר האישור ופרסום הלוח.' })
    if (!res.ok) setError(res.message)
    setRequestBusy(null)
  }

  return (
    <div className="sch-wrap">
      <div className="sch-weeknav">
        <button type="button" className="sch-iconbtn press" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="שבוע קודם">
          <ChevronRight size={20} aria-hidden="true" />
        </button>
        <div className="sch-weeknav__label">
          <strong className="ltr-isolate">
            {formatDateLabel(target)} – {formatDateLabel(weekDates(target)[6]!)}
          </strong>
          <span>האילוצים שלכם לשבוע הזה</span>
        </div>
        <button type="button" className="sch-iconbtn press" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="שבוע הבא">
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
      </div>

      <div className={`sch-card ${closed ? '' : 'sch-card--attention'}`}>
        <div className="sch-row"><Clock3 size={18} aria-hidden="true" /><strong>{closed ? 'הגשת האילוצים נסגרה' : `מגישים עד יום שלישי ${formatDateLabel(requestDeadline(target))}`}</strong></div>
        <p className="sch-sub">{closed ? 'המנהל/ת מכינים את הסידור. לשינוי מאוחר פנו אליהם. משמרת שפורסמה ונפתחה לבקשות עדיין אפשר לבקש.' : 'עד חצות, שעון ישראל. סמנו מה לא מתאים לכם; המנהל/ת מחליטים על השיבוץ.'}</p>
      </div>
      <TimeOffPortal target={target} />

      {error && <InlineError>{error}</InlineError>}

      <section className="sch-wrap" aria-label="בקשות למשמרות">
        <div className="sch-row"><CalendarPlus size={19} aria-hidden="true" /><h3 className="sch-h">משמרות שתרצו לעבוד בהן</h3></div>
        <p className="sch-sub">רק משמרות שהמנהל/ת פתחו לבקשות זמינות כאן. הבקשה נשלחת מיד, והשיבוץ הסופי מופיע אחרי אישור ופרסום.</p>
        {choices.length === 0 && <p className="sch-sub">אין כרגע משמרות פתוחות שדורשות עובדים.</p>}
        {choices.map((s) => {
          const r = db.requests.find((r) => r.shiftId === s.id && r.staffId === db.viewerStaffId && (r.status === 'pending' || r.status === 'approved'))
          const preset = db.settings.presets.find((p) => p.id === s.presetId)
          return <div key={s.id} className="sch-card sch-choice-row">
            <div style={{ flex: 1 }}><strong>{weekdayLongLabel(new Date(`${s.date}T00:00:00Z`).getUTCDay())} {formatDateLabel(s.date)}</strong><p className="sch-sub"><span className="ltr-isolate">{formatShiftRange(s.startTime, s.endTime)}</span>{preset ? ` · ${preset.name}` : ''}</p></div>
            {r ? <span className={`sch-pill sch-pill--${r.status === 'approved' ? 'ok' : 'info'}`}>{r.status === 'approved' ? 'אושרה' : 'הבקשה נשלחה'}</span> : <button type="button" className="sch-btn sch-btn--sm press" disabled={shiftRequestsLocked || !!requestBusy} onClick={() => request(s.id)}>{requestBusy === s.id ? 'שולח…' : shiftRequestsLocked ? 'הבקשות נסגרו' : 'לבקש משמרת'}</button>}
          </div>
        })}
      </section>
    </div>
  )
}
