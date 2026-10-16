'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Beaker, CalendarClock, CheckCircle2, ChevronLeft, ClipboardCheck, Lock, MapPin, Radio } from 'lucide-react'
import { advanceClock, clockAbs, dayLabel, isChecklistLocked, shiftEndAbs, shiftStartAbs, unlockText, type LockInput, type WallClock } from '@/lib/checklists/window'
import { staffChecklistPath } from '@/lib/checklists/links'
import { END_GRACE_MINUTES } from '@/lib/push/staff-rules'
import { formatCountdown } from '@/lib/shifts/time'
import type { ShiftBrief, ShiftChecklistBrief, ShiftStatus } from '@/lib/staff/shift-status'
import '@/components/app/app.css'

// The shift-status container on the staff home. It knows what time it is from the SERVER's clock (the branch's
// own wall clock at render), so a phone with the wrong time or zone cannot unlock a checklist early. When the
// person is on shift it offers the checklist button; before the shift the same button is there but locked and
// says when it opens. A developer with no real shift can "clock in" to a test shift and walk the test forms.

const SIM_KEY = 'sarcafe:dev-sim-shift:v1'
const KINDS = [
  { kind: 'opening', label: 'פתיחת משמרת' },
  { kind: 'handover', label: 'החלפת משמרת' },
  { kind: 'closing', label: 'סגירת משמרת' },
] as const

// Waiting = not sent and not dismissed by an owner.
const waiting = (item: ShiftChecklistBrief) => item.status !== 'submitted' && item.status !== 'covered' && !item.dismissed
/** "Dana sent it" / "Dana does the checklists": a colleague on the shift has this one, so it is not asked of this person. */
const coveredText = (item: ShiftChecklistBrief) => (item.coveredBy?.reason === 'lead' ? `${item.coveredBy.name} ממלא/ת את הצ׳קליסטים` : `נשלח על ידי ${item.coveredBy?.name ?? 'עמית/ה'}`)
const timesOf = (shift: ShiftBrief) => ({ date: shift.date, startTime: shift.startTime, endTime: shift.endTime })
// Each checklist opens at its own moment: the start of the shift for opening / an arriving handover, half an hour before
// the end for closing / a departing handover (the shift has an opening checklist).
const lockFor = (shift: ShiftBrief, item: ShiftChecklistBrief): LockInput => ({ ...timesOf(shift), kind: item.kind, shiftHasOpening: shift.checklists.some((other) => other.kind === 'opening') })

/** On a six-digit-code sign-in the schedule is not available: the card still points at it, and the tap lands on the sign-in that
 *  needs the app installed (`scheduleHref` is /login?next=/staff/schedule there). */
const CODE_NOTE = 'הסידור המלא זמין רק בכניסה דרך האפליקציה. לחיצה על הכרטיס תעביר לכניסה.'

export default function ShiftStatusCard({ status, scheduleHref, developer, codeMode = false }: { status: ShiftStatus; scheduleHref: string; developer: boolean; codeMode?: boolean }) {
  const loadedAt = useRef(Date.now())
  const [, setTick] = useState(0)
  const [sim, setSim] = useState(false)
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 20_000)
    try { setSim(localStorage.getItem(SIM_KEY) === 'on') } catch { /* The test shift is a convenience; it works without storage. */ }
    return () => window.clearInterval(timer)
  }, [])
  const now: WallClock = advanceClock(status.serverNow, Date.now() - loadedAt.current)
  // The server picked "current"/"next" at render time; keep that honest as the minutes pass.
  const known = [status.current, status.next].filter((shift): shift is ShiftBrief => shift !== null)
  const running = known.find((shift) => shiftStartAbs(timesOf(shift)) <= clockAbs(now) && clockAbs(now) < shiftEndAbs(timesOf(shift))) ?? null
  // Closing the place takes time after the shift ends: it stays "current" while a checklist is waiting and the grace lasts.
  const winding = known.find((shift) => shiftEndAbs(timesOf(shift)) <= clockAbs(now) && clockAbs(now) < shiftEndAbs(timesOf(shift)) + END_GRACE_MINUTES && shift.checklists.some(waiting)) ?? null
  const current = running ?? winding
  const next = known.find((shift) => shift !== current && shiftStartAbs(timesOf(shift)) > clockAbs(now)) ?? null

  function toggleSim(on: boolean) {
    setSim(on)
    try { localStorage.setItem(SIM_KEY, on ? 'on' : 'off') } catch { /* see above */ }
  }

  if (current) return <OnShift shift={current} now={now} scheduleHref={scheduleHref} codeMode={codeMode} />

  if (developer && sim) {
    return (
      <section className="app-shiftcard app-shiftcard--live app-shiftcard--dev" aria-label="משמרת בדיקה">
        <div className="app-shiftcard__head">
          <span className="app-shiftcard__badge"><Beaker size={15} aria-hidden="true" />משמרת בדיקה · מצב מפתח</span>
          <button type="button" className="app-shiftcard__quiet press" onClick={() => toggleSim(false)}>יציאה מהמשמרת</button>
        </div>
        <strong className="app-shiftcard__title">את/ה במשמרת בדיקה</strong>
        <p className="app-shiftcard__note">הצ׳קליסטים נפתחים כבדיקה בלבד: אין שיוך למשמרת, שום דבר לא נשמר ולא מגיע לדיווחי העסק.</p>
        <div className="app-shiftcard__actions">
          {KINDS.map((item, index) => <Link key={item.kind} href={`/staff/checklists?preview=${item.kind}`} className={`app-shiftcard__cta press${index === 0 ? ' app-shiftcard__cta--primary' : ''}`}><ClipboardCheck size={18} aria-hidden="true" />הגשת צ׳קליסט {item.label}</Link>)}
        </div>
      </section>
    )
  }

  if (next) return <Upcoming shift={next} now={now} scheduleHref={scheduleHref} developer={developer} codeMode={codeMode} onSim={() => toggleSim(true)} />

  return (
    <section className="app-shiftcard" aria-label="סטטוס משמרת">
      <Link href={scheduleHref} className="app-shiftcard__link press">
        <span className="app-shiftcard__icon"><CalendarClock size={24} aria-hidden="true" /></span>
        <span className="app-shiftcard__copy"><small>סטטוס משמרת</small><strong>אין משמרת קרובה בלוח שפורסם</strong><span>פתיחת לוח המשמרות והבקשות</span></span>
        <ChevronLeft size={19} aria-hidden="true" className="app-row__chevron" />
      </Link>
      <p className="app-shiftcard__note app-shiftcard__note--lock"><Lock size={14} aria-hidden="true" /><span>אין צ׳קליסט זמין: אין משמרת קרובה בלוח שפורסם.</span></p>
      {codeMode && <p className="app-shiftcard__note">{CODE_NOTE}</p>}
      {developer && <div className="app-shiftcard__actions"><button type="button" className="app-shiftcard__cta press" onClick={() => toggleSim(true)}><Beaker size={18} aria-hidden="true" />כניסה למשמרת בדיקה</button></div>}
    </section>
  )
}

function OnShift({ shift, now, scheduleHref, codeMode }: { shift: ShiftBrief; now: WallClock; scheduleHref: string; codeMode: boolean }) {
  const left = shiftEndAbs(timesOf(shift)) - clockAbs(now)
  const ended = left <= 0
  const pending = shift.checklists.filter(waiting)
  const firstOpen = pending.find((item) => !isChecklistLocked(lockFor(shift, item), now))
  return (
    <section className="app-shiftcard app-shiftcard--live" aria-label="המשמרת שלי עכשיו">
      <Link href={scheduleHref} className="app-shiftcard__link press">
        <span className="app-shiftcard__icon"><Radio size={24} aria-hidden="true" /></span>
        <span className="app-shiftcard__copy">
          <small>{ended ? 'המשמרת הסתיימה · נשאר להגיש צ׳קליסט' : <><span className="app-shiftcard__pulse" aria-hidden="true" />במשמרת עכשיו · מסתיימת בעוד {formatCountdown(left)}</>}</small>
          <strong><span dir="ltr">{shift.startTime}–{shift.endTime}</span></strong>
          <span className="app-shift-focus__zone"><MapPin size={15} aria-hidden="true" />{shift.place}</span>
        </span>
        <ChevronLeft size={19} aria-hidden="true" className="app-row__chevron" />
      </Link>
      {!shift.checklists.some((item) => !item.dismissed) && <p className="app-shiftcard__note app-shiftcard__note--lock"><Lock size={14} aria-hidden="true" /><span>אין צ׳קליסט זמין למשמרת הזו.</span></p>}
      {shift.checklists.some((item) => !item.dismissed) && (
        <div className="app-shiftcard__actions">
          {shift.checklists.filter((item) => !item.dismissed).map((item) => {
            if (item.status === 'submitted') return <span key={item.id} className="app-shiftcard__done"><CheckCircle2 size={18} aria-hidden="true" />צ׳קליסט {item.kindLabel} נשלח</span>
            if (item.status === 'covered') return <span key={item.id} className="app-shiftcard__done"><CheckCircle2 size={18} aria-hidden="true" />צ׳קליסט {item.kindLabel} · {coveredText(item)}</span>
            if (isChecklistLocked(lockFor(shift, item), now)) {
              return (
                <button key={item.id} type="button" className="app-shiftcard__cta app-shiftcard__cta--locked" disabled aria-disabled="true">
                  <Lock size={17} aria-hidden="true" />צ׳קליסט {item.kindLabel} · {unlockText(lockFor(shift, item), now)}
                </button>
              )
            }
            return (
              <Link key={item.id} href={staffChecklistPath(item.id)} className={`app-shiftcard__cta press${item.id === firstOpen?.id ? ' app-shiftcard__cta--primary' : ''}`}>
                <ClipboardCheck size={18} aria-hidden="true" />{item.status === 'in_progress' ? 'המשך צ׳קליסט' : 'הגשת צ׳קליסט'} {item.kindLabel}
              </Link>
            )
          })}
        </div>
      )}
      {codeMode && <p className="app-shiftcard__note">{CODE_NOTE}</p>}
    </section>
  )
}

function Upcoming({ shift, now, scheduleHref, developer, codeMode, onSim }: { shift: ShiftBrief; now: WallClock; scheduleHref: string; developer: boolean; codeMode: boolean; onSim: () => void }) {
  const times = timesOf(shift)
  const minutes = shiftStartAbs(times) - clockAbs(now)
  const soon = minutes <= 24 * 60
  const pending = shift.checklists.filter(waiting)
  return (
    <section className="app-shiftcard" aria-label="המשמרת הבאה שלי">
      <Link href={scheduleHref} className="app-shiftcard__link press">
        <span className="app-shiftcard__icon"><CalendarClock size={24} aria-hidden="true" /></span>
        <span className="app-shiftcard__copy">
          <small>{soon ? `המשמרת הבאה שלך · מתחילה בעוד ${formatCountdown(minutes)}` : 'המשמרת הבאה שלך'}</small>
          <strong>{shift.date === now.date ? 'היום' : dayLabel(shift.date)} · <span dir="ltr">{shift.startTime}–{shift.endTime}</span></strong>
          <span className="app-shift-focus__zone"><MapPin size={15} aria-hidden="true" />{shift.place}</span>
        </span>
        <ChevronLeft size={19} aria-hidden="true" className="app-row__chevron" />
      </Link>
      {soon && pending.length > 0 && (
        <div className="app-shiftcard__actions">
          {pending.map((item) => (
            <button key={item.id} type="button" className="app-shiftcard__cta app-shiftcard__cta--locked" disabled aria-disabled="true">
              <Lock size={17} aria-hidden="true" />צ׳קליסט {item.kindLabel} · {isChecklistLocked(lockFor(shift, item), now) ? unlockText(lockFor(shift, item), now) : 'פתוח'}
            </button>
          ))}
        </div>
      )}
      {!soon && <p className="app-shiftcard__note app-shiftcard__note--lock"><Lock size={14} aria-hidden="true" /><span>הצ׳קליסטים יהיו זמינים ביום המשמרת.</span></p>}
      {soon && pending.length === 0 && <p className="app-shiftcard__note app-shiftcard__note--lock"><Lock size={14} aria-hidden="true" /><span>אין צ׳קליסט שממתין למשמרת הזו.</span></p>}
      {codeMode && <p className="app-shiftcard__note">{CODE_NOTE}</p>}
      {developer && <div className="app-shiftcard__actions"><button type="button" className="app-shiftcard__cta press" onClick={onSim}><Beaker size={18} aria-hidden="true" />כניסה למשמרת בדיקה</button></div>}
    </section>
  )
}
