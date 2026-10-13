'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Beaker, CalendarClock, CheckCircle2, ChevronLeft, ClipboardCheck, Lock, MapPin, Radio } from 'lucide-react'
import { advanceClock, clockAbs, dayLabel, isChecklistLocked, shiftEndAbs, shiftStartAbs, unlockText, type WallClock } from '@/lib/checklists/window'
import { formatCountdown } from '@/lib/shifts/time'
import type { ShiftBrief, ShiftStatus } from '@/lib/staff/shift-status'
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

const openHref = (shift: ShiftBrief, checklistId: string) => `/staff/checklists?open=${checklistId}${shift.branchSlug ? `&branch=${encodeURIComponent(shift.branchSlug)}` : ''}`
const timesOf = (shift: ShiftBrief) => ({ date: shift.date, startTime: shift.startTime, endTime: shift.endTime })

export default function ShiftStatusCard({ status, scheduleHref, developer }: { status: ShiftStatus; scheduleHref: string; developer: boolean }) {
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
  const current = known.find((shift) => shiftStartAbs(timesOf(shift)) <= clockAbs(now) && clockAbs(now) < shiftEndAbs(timesOf(shift))) ?? null
  const next = known.find((shift) => shift !== current && shiftStartAbs(timesOf(shift)) > clockAbs(now)) ?? null

  function toggleSim(on: boolean) {
    setSim(on)
    try { localStorage.setItem(SIM_KEY, on ? 'on' : 'off') } catch { /* see above */ }
  }

  if (current) return <OnShift shift={current} now={now} scheduleHref={scheduleHref} />

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

  if (next) return <Upcoming shift={next} now={now} scheduleHref={scheduleHref} developer={developer} onSim={() => toggleSim(true)} />

  return (
    <section className="app-shiftcard" aria-label="סטטוס משמרת">
      <Link href={scheduleHref} className="app-shiftcard__link press">
        <span className="app-shiftcard__icon"><CalendarClock size={24} aria-hidden="true" /></span>
        <span className="app-shiftcard__copy"><small>סטטוס משמרת</small><strong>אין משמרת קרובה בלוח שפורסם</strong><span>פתיחת לוח המשמרות והבקשות</span></span>
        <ChevronLeft size={19} aria-hidden="true" className="app-row__chevron" />
      </Link>
      {developer && <div className="app-shiftcard__actions"><button type="button" className="app-shiftcard__cta press" onClick={() => toggleSim(true)}><Beaker size={18} aria-hidden="true" />כניסה למשמרת בדיקה</button></div>}
    </section>
  )
}

function OnShift({ shift, now, scheduleHref }: { shift: ShiftBrief; now: WallClock; scheduleHref: string }) {
  const left = shiftEndAbs(timesOf(shift)) - clockAbs(now)
  const pending = shift.checklists.filter((item) => item.status !== 'submitted')
  return (
    <section className="app-shiftcard app-shiftcard--live" aria-label="המשמרת שלי עכשיו">
      <Link href={scheduleHref} className="app-shiftcard__link press">
        <span className="app-shiftcard__icon"><Radio size={24} aria-hidden="true" /></span>
        <span className="app-shiftcard__copy">
          <small><span className="app-shiftcard__pulse" aria-hidden="true" />במשמרת עכשיו · מסתיימת בעוד {formatCountdown(left)}</small>
          <strong><span dir="ltr">{shift.startTime}–{shift.endTime}</span></strong>
          <span className="app-shift-focus__zone"><MapPin size={15} aria-hidden="true" />{shift.place}</span>
        </span>
        <ChevronLeft size={19} aria-hidden="true" className="app-row__chevron" />
      </Link>
      {shift.checklists.length > 0 && (
        <div className="app-shiftcard__actions">
          {shift.checklists.map((item) => {
            if (item.status === 'submitted') return <span key={item.id} className="app-shiftcard__done"><CheckCircle2 size={18} aria-hidden="true" />צ׳קליסט {item.kindLabel} נשלח</span>
            return (
              <Link key={item.id} href={openHref(shift, item.id)} className={`app-shiftcard__cta press${item.id === pending[0]?.id ? ' app-shiftcard__cta--primary' : ''}`}>
                <ClipboardCheck size={18} aria-hidden="true" />{item.status === 'in_progress' ? 'המשך צ׳קליסט' : 'הגשת צ׳קליסט'} {item.kindLabel}
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Upcoming({ shift, now, scheduleHref, developer, onSim }: { shift: ShiftBrief; now: WallClock; scheduleHref: string; developer: boolean; onSim: () => void }) {
  const times = timesOf(shift)
  const minutes = shiftStartAbs(times) - clockAbs(now)
  const soon = minutes <= 24 * 60
  const pending = shift.checklists.filter((item) => item.status !== 'submitted')
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
              <Lock size={17} aria-hidden="true" />צ׳קליסט {item.kindLabel} · {isChecklistLocked(times, now) ? unlockText(times, now) : 'פתוח'}
            </button>
          ))}
        </div>
      )}
      {developer && <div className="app-shiftcard__actions"><button type="button" className="app-shiftcard__cta press" onClick={onSim}><Beaker size={18} aria-hidden="true" />כניסה למשמרת בדיקה</button></div>}
    </section>
  )
}
