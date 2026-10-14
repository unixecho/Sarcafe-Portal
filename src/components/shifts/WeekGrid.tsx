'use client'

import { AlertTriangle, ArrowLeftRight, BellRing, Check, Plus, UserX } from 'lucide-react'
import { Person, Pill } from '@/components/shifts/ui'
import { hoursFor, matchPreset } from '@/lib/shifts/presets'
import { nameOf, indexByShift, pendingRequestsByShift, swapPendingAssignmentIds, shiftFacts } from '@/lib/shifts/view'
import { formatDateLabel, formatShiftLabel, hasStarted, relativeDayLabel, weekDates, weekdayLongLabel } from '@/lib/shifts/time'
import { staffColor } from '@/lib/shifts/people'
import { avoidText, fitFor } from '@/lib/shifts/time-off'
import type { Assignment, Shift, ShiftsDB, Warning } from '@/lib/shifts/types'

// The manager's week board. (The employee's own view is EmployeeSchedule.tsx.)
// Every state is a word + an icon + a colour (never colour alone):
//   ללא שיבוץ      nobody is on it
//   חסר/ה …        it needs more people than it has
//   מאוישת         it has everyone it asked for
//   החלפה ממתינה   a swap involving it is waiting (the schedule itself is unchanged)
//   N בקשות        employees asked to join
//   שימו לב        a rule is bent (rest, hours, availability, a person who left)

type Props = {
  weekStart: string
  db: ShiftsDB
  shifts: Shift[]
  assignments: Assignment[]
  warnings?: Warning[]
  onShiftClick?: (shift: Shift) => void
  /** Add a shift on this date. */
  onAdd?: (date: string) => void
  /** Edit the note of this date. */
  onEditNote?: (date: string) => void
  dayNotes?: Record<string, string>
}

// Warnings the coverage pills already say in their own words.
const COVERED_BY_PILLS = new Set(['understaffed', 'overstaffed', 'unassigned_shift'])

export default function WeekGrid({ weekStart, db, shifts, assignments, warnings, onShiftClick, onAdd, onEditNote, dayNotes }: Props) {
  const dates = weekDates(weekStart)
  const viewer = db.viewerStaffId
  const byShift = indexByShift(assignments)
  const swapIds = swapPendingAssignmentIds(db.swaps)
  const requestsByShift = pendingRequestsByShift(db.requests)
  const roleById = new Map(db.settings.roles.map((r) => [r.id, r]))

  const warningsByShift = new Map<string, Warning[]>()
  for (const w of warnings ?? []) {
    if (!w.shiftId) continue
    const list = warningsByShift.get(w.shiftId) ?? []
    list.push(w)
    warningsByShift.set(w.shiftId, list)
  }

  const shiftsByDate = new Map<string, Shift[]>()
  for (const s of shifts) {
    const list = shiftsByDate.get(s.date) ?? []
    list.push(s)
    shiftsByDate.set(s.date, list)
  }
  for (const list of shiftsByDate.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime))

  return (
    <div className="sch-week sch-week--manager">
      {dates.map((date, dow) => {
        const dayShifts = shiftsByDate.get(date) ?? []
        const isWorkingDay = db.settings.workingDays.includes(dow)
        const isToday = date === db.now.date
        const hours = hoursFor(date, db.settings)
        const relative = relativeDayLabel(date, db.now)
        const note = dayNotes?.[date]
        return (
          <section key={date} className={`sch-day${isToday ? ' sch-day--today' : ''}${isWorkingDay ? '' : ' sch-day--closed'}`} aria-label={`${weekdayLongLabel(dow)} ${formatDateLabel(date)}`}>
            <header className="sch-day__head">
              <h3 className="sch-day__title">
                {weekdayLongLabel(dow)}
                <small className="ltr-isolate">{formatDateLabel(date)}</small>
              </h3>
              {relative && <Pill tone="mine">{relative}</Pill>}
              {!isWorkingDay && <Pill tone="neutral">יום סגור</Pill>}
              {dow === 6 && isWorkingDay && <Pill tone="info">שבת · 150%</Pill>}
              {onAdd && (
                <button type="button" className="sch-add press" onClick={() => onAdd(date)} aria-label={`הוספת משמרת ל${weekdayLongLabel(dow)} ${formatDateLabel(date)}`}>
                  <Plus size={16} aria-hidden="true" /> משמרת
                </button>
              )}
            </header>

            {(isWorkingDay || note || onEditNote) && (
              <p className="sch-day__meta">
                {isWorkingDay && (
                  <span>
                    שעות פעילות <span className="ltr-isolate">{hours.open}–{hours.close}</span>
                  </span>
                )}
                {note && <span style={{ color: 'var(--neon-soft)', fontWeight: 600 }}>· {note}</span>}
                {onEditNote && (
                  <button type="button" className="sch-note" onClick={() => onEditNote(date)}>
                    {note ? 'עריכת הערה' : 'הערה ליום'}
                  </button>
                )}
              </p>
            )}

            {dayShifts.length === 0 ? (
              onAdd ? (
                <button type="button" className="sch-add sch-add--block press" onClick={() => onAdd(date)}>
                  <Plus size={16} aria-hidden="true" /> הוספת משמרת
                </button>
              ) : (
                <p className="sch-sub sch-faint">אין משמרות</p>
              )
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dayShifts.map((shift) => (
                  <ShiftCard
                    key={shift.id}
                    shift={shift}
                    db={db}
                    assignments={byShift.get(shift.id) ?? []}
                    warnings={warningsByShift.get(shift.id) ?? []}
                    swapIds={swapIds}
                    requestCount={(requestsByShift.get(shift.id) ?? []).length}
                    roleById={roleById}
                    viewer={viewer}
                    onClick={onShiftClick}
                  />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function ShiftCard({
  shift,
  db,
  assignments,
  warnings,
  swapIds,
  requestCount,
  roleById,
  viewer,
  onClick,
}: {
  shift: Shift
  db: ShiftsDB
  assignments: Assignment[]
  warnings: Warning[]
  swapIds: Set<string>
  requestCount: number
  roleById: Map<string, ShiftsDB['settings']['roles'][number]>
  viewer: string | null
  onClick?: (shift: Shift) => void
}) {
  const { coverage } = shiftFacts(shift, assignments)
  const mine = !!viewer && assignments.some((a) => a.staffId === viewer)
  const past = hasStarted(shift, db.now)
  const swapPending = assignments.some((a) => swapIds.has(a.id))
  const preset = matchPreset(shift, db.settings.presets) ?? (shift.presetId ? db.settings.presets.find((p) => p.id === shift.presetId) : undefined)
  const station = shift.stationId ? db.settings.stations.find((s) => s.id === shift.stationId) : undefined
  const otherWarnings = warnings.filter((w) => !COVERED_BY_PILLS.has(w.code))
  const hasError = otherWarnings.some((w) => w.severity === 'error')

  const classes = ['sch-shift']
  if (coverage.state === 'unassigned') classes.push('sch-shift--empty')
  if (hasError) classes.push('sch-shift--problem')
  if (mine) classes.push('sch-shift--mine')
  if (past) classes.push('sch-shift--past')

  const peopleNames = assignments.map((a) => nameOf(db, a.staffId, a.staffName))
  const label = `${formatShiftLabel(shift.date, shift.startTime, shift.endTime)}. ${
    peopleNames.length ? `משובצים: ${peopleNames.join(', ')}` : 'ללא שיבוץ'
  }${onClick ? '. לחצו לפרטים' : ''}`

  const content = (
    <>
      <div className="sch-shift__top">
        <span className="sch-time">
          {shift.startTime}–{shift.endTime}
        </span>
        {preset && <span className="sch-shift__label">{preset.name}</span>}
        {station && (
          <span className="sch-shift__label">
            · {station.emoji} {station.name}
          </span>
        )}
      </div>

      <div className="sch-shift__chips">
        {assignments.length === 0 ? (
          <Pill tone="warn" icon={<UserX size={13} aria-hidden="true" />}>
            ללא שיבוץ — לחצו לשיבוץ
          </Pill>
        ) : (
          assignments.map((a) => {
            const row = a.staffId ? db.roster.find((r) => r.staffId === a.staffId) : undefined
            // What this person asked for on this day, shown while the owner is still building the week (not after the shift began).
            const fit = a.staffId && !past ? fitFor(db.timeOff, a.staffId, shift) : null
            const flag = fit?.kind === 'day_off' ? 'dayoff' : fit?.kind === 'day_off_pending' ? 'pending' : fit?.kind === 'avoids' ? 'avoid' : undefined
            const tag = fit?.kind === 'day_off' ? 'חופש מאושר' : fit?.kind === 'day_off_pending' ? 'ביקש/ה חופש' : fit?.kind === 'avoids' ? avoidText(fit.avoids) : undefined
            return (
              <Person
                flag={flag}
                tag={tag}
                lead={a.checklistLead && assignments.length > 1}
                key={a.id}
                name={nameOf(db, a.staffId, a.staffName)}
                role={a.roleId ? roleById.get(a.roleId) : null}
                color={staffColor(a.staffId, db.roster)}
                emoji={row?.avatarEmoji}
                faded={swapIds.has(a.id) || (!!row && !row.active)}
                note={row && !row.active ? 'לא פעיל/ה' : undefined}
              />
            )
          })
        )}
      </div>

      <div className="sch-shift__chips">
        {coverage.state === 'partial' && (
          <Pill tone="warn" icon={<UserX size={13} aria-hidden="true" />}>
            {coverage.short.length > 0
              ? `חסר/ה ${coverage.short.map((s) => `${s.missing > 1 ? `${s.missing} ` : ''}${roleById.get(s.roleId)?.name ?? 'עובד/ת'}`).join(', ')}`
              : `חסרים ${coverage.missing}`}
          </Pill>
        )}
        {coverage.state === 'full' && (
          <Pill tone="ok" icon={<Check size={13} aria-hidden="true" />}>
            מאוישת ({coverage.assigned}/{coverage.needed})
          </Pill>
        )}
        {swapPending && (
          <Pill tone="swap" icon={<ArrowLeftRight size={13} aria-hidden="true" />}>
            החלפה ממתינה
          </Pill>
        )}
        {requestCount > 0 && (
          <Pill tone="info" icon={<BellRing size={13} aria-hidden="true" />}>
            {requestCount === 1 ? 'בקשה להצטרף' : `${requestCount} בקשות להצטרף`}
          </Pill>
        )}
        {otherWarnings.length > 0 && (
          <Pill tone={hasError ? 'danger' : 'warn'} icon={<AlertTriangle size={13} aria-hidden="true" />}>
            {otherWarnings[0]!.message}
            {otherWarnings[0]!.staffId ? ` · ${nameOf(db, otherWarnings[0]!.staffId)}` : ''}
            {otherWarnings.length > 1 ? ` (+${otherWarnings.length - 1})` : ''}
          </Pill>
        )}
        {shift.note && <span className="sch-sub">{shift.note}</span>}
      </div>
    </>
  )

  return onClick ? (
    <button type="button" className={`${classes.join(' ')} press`} onClick={() => onClick(shift)} aria-label={label}>
      {content}
    </button>
  ) : (
    <div className={classes.join(' ')}>{content}</div>
  )
}
