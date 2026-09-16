'use client'

import { formatDateLabel, weekDates, weekdayLabel } from '@/lib/shifts/time'
import type { Assignment, Shift, ShiftSettings, Warning } from '@/lib/shifts/types'

// Shared rendering primitive — used identically by the manager's builder,
// the staff read-only view, and the print view, so paper and screen can
// never diverge (same reasoning AyekaBar's own WeekGrid documents).
export default function WeekGrid({
  weekStart,
  shifts,
  assignments,
  settings,
  warnings,
  dayNotes,
  onShiftClick,
}: {
  weekStart: string
  shifts: Shift[]
  assignments: Assignment[]
  settings: ShiftSettings
  warnings?: Warning[]
  dayNotes?: Record<string, string>
  onShiftClick?: (shift: Shift) => void
}) {
  const dates = weekDates(weekStart)

  const shiftsByDate = new Map<string, Shift[]>()
  for (const s of shifts) {
    const list = shiftsByDate.get(s.date) ?? []
    list.push(s)
    shiftsByDate.set(s.date, list)
  }
  for (const list of shiftsByDate.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime))

  const assignmentsByShift = new Map<string, Assignment[]>()
  for (const a of assignments) {
    const list = assignmentsByShift.get(a.shiftId) ?? []
    list.push(a)
    assignmentsByShift.set(a.shiftId, list)
  }

  const roleById = new Map(settings.roles.map((r) => [r.id, r]))
  const warningsByShift = new Map<string, Warning[]>()
  for (const w of warnings ?? []) {
    if (!w.shiftId) continue
    const list = warningsByShift.get(w.shiftId) ?? []
    list.push(w)
    warningsByShift.set(w.shiftId, list)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {dates.map((date, dow) => {
        const dayShifts = shiftsByDate.get(date) ?? []
        const isWorkingDay = settings.workingDays.includes(dow)
        return (
          <section key={date} style={{ opacity: isWorkingDay ? 1 : 0.55 }}>
            <header style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>{weekdayLabel(dow)}</h3>
              <span className="ltr-isolate" style={{ fontSize: '0.76rem', color: 'var(--text-faint)' }}>
                {formatDateLabel(date)}
              </span>
              {!isWorkingDay && <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>סגור</span>}
              {dayNotes?.[date] && <span style={{ fontSize: '0.74rem', color: 'var(--neon-soft)' }}>· {dayNotes[date]}</span>}
            </header>

            {dayShifts.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-faint)' }}>אין משמרות</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dayShifts.map((shift) => {
                  const shiftAssignments = assignmentsByShift.get(shift.id) ?? []
                  const shiftWarnings = warningsByShift.get(shift.id) ?? []
                  const hasError = shiftWarnings.some((w) => w.severity === 'error')
                  const rowStyle: React.CSSProperties = {
                    textAlign: 'start',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: `1px solid ${hasError ? 'rgba(255,107,107,0.4)' : 'var(--line)'}`,
                    background: 'var(--bg-elev)',
                    cursor: onShiftClick ? 'pointer' : 'default',
                    width: '100%',
                    font: 'inherit',
                    color: 'inherit',
                  }
                  const rowContent = (
                    <>
                      <span className="ltr-isolate" style={{ fontWeight: 700, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                        {shift.startTime}–{shift.endTime}
                      </span>
                      <span style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {shiftAssignments.length === 0 ? (
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-faint)' }}>ללא שיבוץ</span>
                        ) : (
                          shiftAssignments.map((a) => {
                            const role = a.roleId ? roleById.get(a.roleId) : undefined
                            return (
                              <span
                                key={a.id}
                                style={{
                                  fontSize: '0.76rem',
                                  padding: '2px 8px',
                                  borderRadius: 999,
                                  background: role ? `${role.color}22` : 'var(--bg-elev-2)',
                                  color: role ? role.color : 'var(--text-dim)',
                                  opacity: a.status === 'swap_pending' ? 0.6 : 1,
                                }}
                              >
                                {a.staffName ?? '—'}
                                {a.status === 'swap_pending' && ' ⇄'}
                              </span>
                            )
                          })
                        )}
                      </span>
                      {shiftWarnings.length > 0 && (
                        <span aria-hidden="true" style={{ color: hasError ? '#ff6b6b' : '#ffb240', fontSize: '0.9rem' }}>
                          {hasError ? '⛔' : '⚠️'}
                        </span>
                      )}
                    </>
                  )
                  return onShiftClick ? (
                    <button key={shift.id} type="button" className="press" onClick={() => onShiftClick(shift)} style={rowStyle}>
                      {rowContent}
                    </button>
                  ) : (
                    <div key={shift.id} style={rowStyle}>
                      {rowContent}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
