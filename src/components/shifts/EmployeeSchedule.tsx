'use client'

import { ArrowLeftRight, BellRing, CalendarClock, CalendarHeart, ChevronLeft, Share } from 'lucide-react'
import { Avatar, Pill } from '@/components/shifts/ui'
import { coverageOf } from '@/lib/shifts/coverage'
import { hoursFor, matchPreset } from '@/lib/shifts/presets'
import { staffColor } from '@/lib/shifts/people'
import { formatCountdown, formatDateLabel, formatDayLabel, formatShiftLabel, hasEnded, hasStarted, minutesUntilEnd, minutesUntilStart, relativeDayLabel, weekDates, weekdayLongLabel } from '@/lib/shifts/time'
import { indexByShift, nameOf, rosterRow, swapPendingAssignmentIds } from '@/lib/shifts/view'
import type { Assignment, Shift, ShiftsDB } from '@/lib/shifts/types'

// The employee's own view of the schedule, built to read like an iPhone app:
//   NextShiftHero   the one thing most people open this for — their next shift (or the one they are in)
//   WeekStrip       the seven days at a glance; tap a day to jump to it
//   EmployeeWeek    the days as grouped lists, one row per shift
// Everything is read-only here: tapping a row opens the shift sheet (ShiftActionSheet),
// which is where a swap, hand-over or request is made.

const DAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']

export type WeekDay = { date: string; dow: number; shifts: Shift[]; mine: Shift[] }

/** The week as the employee needs it: every day, its shifts in clock order, and which of them are theirs. */
export function buildWeek(db: Pick<ShiftsDB, 'viewerStaffId'>, weekStart: string, shifts: Shift[], assignments: Assignment[]): WeekDay[] {
  const byShift = indexByShift(assignments)
  return weekDates(weekStart).map((date, dow) => {
    const day = shifts.filter((s) => s.date === date).sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime))
    const mine = day.filter((s) => (byShift.get(s.id) ?? []).some((a) => a.staffId === db.viewerStaffId))
    return { date, dow, shifts: day, mine }
  })
}

export function NextShiftHero({ db, onOpen, onBrowse, onShare }: { db: ShiftsDB; onOpen: (shiftId: string) => void; onBrowse: () => void; onShare: (date: string) => void }) {
  const me = db.viewerStaffId
  const byShift = indexByShift(db.assignments)
  const mine = db.shifts.filter((s) => (byShift.get(s.id) ?? []).some((a) => a.staffId === me))
  const ongoing = mine.find((s) => hasStarted(s, db.now) && !hasEnded(s, db.now))
  const upcoming = mine.filter((s) => !hasStarted(s, db.now)).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))[0]
  const shift = ongoing ?? upcoming

  if (!shift) {
    return (
      <section className="ew-hero ew-hero--empty" aria-label="אין משמרות קרובות">
        <CalendarHeart size={30} aria-hidden="true" />
        <strong>אין לכם משמרות קרובות</strong>
        <span className="ew-hero__sub">כשהמנהל/ת יפרסמו לוח חדש תקבלו הודעה, והמשמרות שלכם יופיעו כאן.</span>
        <button type="button" className="sch-btn sch-btn--sm press" onClick={onBrowse}>
          לצפות בכל הלוח
        </button>
      </section>
    )
  }

  const on = byShift.get(shift.id) ?? []
  const mineHere = on.find((a) => a.staffId === me)
  const role = mineHere?.roleId ? db.settings.roles.find((r) => r.id === mineHere.roleId) : undefined
  const preset = matchPreset(shift, db.settings.presets) ?? (shift.presetId ? db.settings.presets.find((p) => p.id === shift.presetId) : undefined)
  const station = shift.stationId ? db.settings.stations.find((s) => s.id === shift.stationId) : undefined
  const mates = on.filter((a) => a.staffId && a.staffId !== me)
  const swapPending = !!mineHere && swapPendingAssignmentIds(db.swaps).has(mineHere.id)
  const minutes = ongoing ? minutesUntilEnd(shift, db.now) : minutesUntilStart(shift, db.now)
  const when = ongoing ? `מסתיימת בעוד ${formatCountdown(minutes)}` : minutes < 1 ? 'מתחילה ממש עכשיו' : `מתחילה בעוד ${formatCountdown(minutes)}`
  const relative = relativeDayLabel(shift.date, db.now)

  return (
    <section className={`ew-hero${ongoing ? ' ew-hero--now' : ''}`} aria-label={ongoing ? 'המשמרת הנוכחית שלכם' : 'המשמרת הבאה שלכם'}>
      <button type="button" className="ew-hero__main press" onClick={() => onOpen(shift.id)}>
        <span className="ew-hero__cap">
          <CalendarClock size={16} aria-hidden="true" />
          {ongoing ? 'אתם במשמרת עכשיו' : 'המשמרת הבאה שלכם'}
          {ongoing ? <Pill tone="ok">עכשיו</Pill> : relative && <Pill tone="mine">{relative}</Pill>}
          {swapPending && (
            <Pill tone="swap" icon={<ArrowLeftRight size={13} aria-hidden="true" />}>
              החלפה ממתינה
            </Pill>
          )}
        </span>
        <span className="ew-hero__time ltr-isolate">
          {shift.startTime}–{shift.endTime}
        </span>
        <span className="ew-hero__day">{formatDayLabel(shift.date)}</span>
        {(preset || station || role) && (
          <span className="ew-hero__chips">
            {preset && <span className="ew-chip">{preset.name}</span>}
            {station && (
              <span className="ew-chip">
                {station.emoji} {station.name}
              </span>
            )}
            {role && <span className="ew-chip">{role.name}</span>}
          </span>
        )}
        <span className="ew-hero__when">{when}</span>
        {mates.length > 0 && (
          <span className="ew-hero__mates">
            <span className="ew-stack" aria-hidden="true">
              {mates.slice(0, 4).map((a) => (
                <Avatar key={a.id} name={nameOf(db, a.staffId, a.staffName)} color={staffColor(a.staffId, db.roster)} emoji={rosterRow(db, a.staffId)?.avatarEmoji} />
              ))}
            </span>
            <span>עובדים איתכם: {mates.map((a) => nameOf(db, a.staffId, a.staffName)).join(', ')}</span>
          </span>
        )}
      </button>
      <div className="ew-hero__actions">
        <button type="button" className="sch-btn sch-btn--sm press" onClick={() => onOpen(shift.id)}>
          <ArrowLeftRight size={16} aria-hidden="true" /> החלפה או מסירה
        </button>
        <button type="button" className="sch-btn sch-btn--sm press" onClick={() => onShare(shift.date)}>
          <Share size={16} aria-hidden="true" /> שיתוף
        </button>
      </div>
    </section>
  )
}

export function WeekStrip({ db, days, selected, onSelect }: { db: ShiftsDB; days: WeekDay[]; selected: string | null; onSelect: (date: string) => void }) {
  return (
    <nav className="ew-strip" aria-label="ימות השבוע">
      {days.map((day) => {
        const today = day.date === db.now.date
        const past = day.date < db.now.date
        const state = day.mine.length > 0 ? ', יש לכם משמרת' : day.shifts.length > 0 ? ', יש משמרות לאחרים' : ''
        return (
          <button
            key={day.date}
            type="button"
            className="ew-strip__day press"
            aria-pressed={selected === day.date}
            aria-current={today ? 'date' : undefined}
            data-today={today}
            data-past={past}
            aria-label={`${weekdayLongLabel(day.dow)} ${formatDateLabel(day.date)}${state}`}
            onClick={() => onSelect(day.date)}
          >
            <span className="ew-strip__letter">{DAY_LETTERS[day.dow]}</span>
            <span className="ew-strip__num">{Number(day.date.slice(8))}</span>
            <span className="ew-strip__dots" aria-hidden="true">
              {day.mine.length > 0 ? <i className="ew-dot ew-dot--mine" /> : day.shifts.length > 0 ? <i className="ew-dot" /> : null}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

export function EmployeeWeek({
  db,
  days,
  assignments,
  view,
  dayNotes,
  selected,
  onOpenShift,
}: {
  db: ShiftsDB
  days: WeekDay[]
  assignments: Assignment[]
  view: 'mine' | 'everyone'
  dayNotes?: Record<string, string>
  selected: string | null
  onOpenShift: (shiftId: string) => void
}) {
  const byShift = indexByShift(assignments)
  const swapIds = swapPendingAssignmentIds(db.swaps)
  const me = db.viewerStaffId

  return (
    <div className="ew-week">
      {days.map((day) => {
        const isWorkingDay = db.settings.workingDays.includes(day.dow)
        const rows = view === 'mine' ? day.mine : day.shifts
        const today = day.date === db.now.date
        const relative = relativeDayLabel(day.date, db.now)
        const hours = hoursFor(day.date, db.settings)
        const note = dayNotes?.[day.date]
        return (
          <section key={day.date} id={`ew-day-${day.date}`} className="ew-day" data-today={today} data-selected={selected === day.date} aria-label={`${weekdayLongLabel(day.dow)} ${formatDateLabel(day.date)}`}>
            <header className="ew-day__head">
              <h3 className="ew-day__title">{weekdayLongLabel(day.dow)}</h3>
              <span className="ew-day__date ltr-isolate">{formatDateLabel(day.date)}</span>
              {relative && <Pill tone="mine">{relative}</Pill>}
              {!isWorkingDay && <Pill tone="neutral">יום סגור</Pill>}
              {day.dow === 6 && isWorkingDay && <Pill tone="info">שבת · 150%</Pill>}
            </header>
            {(isWorkingDay || note) && (
              <p className="ew-day__meta">
                {isWorkingDay && (
                  <span>
                    שעות פעילות <bdi dir="ltr">{hours.open}–{hours.close}</bdi>
                  </span>
                )}
                {note && <span className="ew-day__note">· {note}</span>}
              </p>
            )}

            {rows.length === 0 ? (
              <p className="ew-day__empty">{view === 'mine' ? (isWorkingDay ? 'יום חופשי' : 'הסניף סגור') : 'אין משמרות'}</p>
            ) : (
              <ul className="ew-list">
                {rows.map((shift) => {
                  const on = byShift.get(shift.id) ?? []
                  const mineHere = on.find((a) => a.staffId === me)
                  const started = hasStarted(shift, db.now)
                  const cov = coverageOf(shift, on)
                  const preset = matchPreset(shift, db.settings.presets) ?? (shift.presetId ? db.settings.presets.find((p) => p.id === shift.presetId) : undefined)
                  const station = shift.stationId ? db.settings.stations.find((s) => s.id === shift.stationId) : undefined
                  const role = mineHere?.roleId ? db.settings.roles.find((r) => r.id === mineHere.roleId) : undefined
                  const swapPending = on.some((a) => swapIds.has(a.id))
                  const askedToJoin = db.requests.some((r) => r.shiftId === shift.id && r.staffId === me && r.status === 'pending')
                  const names = on.map((a) => (a.staffId === me ? 'אתם' : nameOf(db, a.staffId, a.staffName)))
                  return (
                    <li key={shift.id}>
                      <button
                        type="button"
                        className={`ew-shift press${mineHere ? ' ew-shift--mine' : ''}${started ? ' ew-shift--past' : ''}`}
                        onClick={() => onOpenShift(shift.id)}
                        aria-label={`${formatShiftLabel(shift.date, shift.startTime, shift.endTime)}. ${names.length ? `משובצים: ${names.join(', ')}` : 'ללא שיבוץ'}. לחצו לפרטים`}
                      >
                        <span className="ew-shift__time ltr-isolate">
                          <b>{shift.startTime}</b>
                          <i>{shift.endTime}</i>
                        </span>
                        <span className="ew-shift__bar" aria-hidden="true" />
                        <span className="ew-shift__body">
                          <span className="ew-shift__title">
                            {preset?.name ?? 'משמרת'}
                            {station && <small>{station.emoji} {station.name}</small>}
                            {role && <small>{role.name}</small>}
                          </span>
                          <span className="ew-shift__who">
                            {on.length === 0 ? (
                              <span className="ew-faint">אף אחד עוד לא משובץ</span>
                            ) : (
                              <>
                                <span className="ew-stack" aria-hidden="true">
                                  {on.slice(0, 4).map((a) => (
                                    <Avatar key={a.id} name={nameOf(db, a.staffId, a.staffName)} color={staffColor(a.staffId, db.roster)} emoji={rosterRow(db, a.staffId)?.avatarEmoji} />
                                  ))}
                                </span>
                                <span className="ew-shift__names">{names.join(', ')}</span>
                              </>
                            )}
                          </span>
                          <span className="ew-shift__tags">
                            {mineHere && <Pill tone="mine">המשמרת שלך</Pill>}
                            {swapPending && (
                              <Pill tone="swap" icon={<ArrowLeftRight size={13} aria-hidden="true" />}>
                                החלפה ממתינה
                              </Pill>
                            )}
                            {askedToJoin && (
                              <Pill tone="info" icon={<BellRing size={13} aria-hidden="true" />}>
                                ביקשת להצטרף
                              </Pill>
                            )}
                            {!mineHere && shift.requestsOpen && cov.state !== 'full' && !started && !askedToJoin && <Pill tone="info">פתוחה לבקשות</Pill>}
                            {!mineHere && cov.state === 'partial' && !started && <Pill tone="warn">חסרים {cov.missing}</Pill>}
                            {shift.note && <span className="ew-faint">{shift.note}</span>}
                          </span>
                        </span>
                        <ChevronLeft size={18} aria-hidden="true" className="dir-flip ew-shift__chev" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
