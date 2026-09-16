// The warnings engine — pure, no React/DOM/database. Reports, never
// blocks: publish asks for confirmation on errors but never refuses
// outright. Adapted from AyekaBar's lib/shifts/rules.ts, trimmed of the
// mock-only checks; the cross-week rest/consecutive-day checks need
// shifts from outside the target week, which is why callers pass the
// whole loaded window (ShiftsProvider's 3-week range) rather than just
// one week's shifts.

import type { Assignment, AvailabilitySubmission, ScheduleStaffRow, Shift, ShiftSettings, Warning } from './types'
import { daysBetween, durationMinutes, intervalOf } from './time'

type EvalInput = {
  weekStart: string
  settings: ShiftSettings
  roster: ScheduleStaffRow[]
  /** Every shift in the loaded window (requested week ± 1), not just the
   *  target week — needed for rest/consecutive-day checks that span a
   *  week boundary. */
  shifts: Shift[]
  assignments: Assignment[]
  availability: AvailabilitySubmission[]
}

function severity(settings: ShiftSettings, code: string, fallback: 'error' | 'warning'): 'error' | 'warning' | null {
  const override = settings.ruleSeverity[code]
  if (override === 'off') return null
  if (override === 'error' || override === 'warning') return override
  return fallback
}

function push(out: Warning[], settings: ShiftSettings, code: string, fallback: 'error' | 'warning', message: string, extra?: Partial<Warning>) {
  const sev = severity(settings, code, fallback)
  if (!sev) return
  out.push({ code, severity: sev, message, ...extra })
}

export function evaluate(input: EvalInput): Warning[] {
  const { settings, roster, shifts, assignments, availability } = input
  const out: Warning[] = []

  const rosterById = new Map(roster.map((r) => [r.staffId, r]))
  const roleIds = new Set(settings.roles.map((r) => r.id))
  const shiftById = new Map(shifts.map((s) => [s.id, s]))
  const assignmentsByShift = new Map<string, Assignment[]>()
  for (const a of assignments) {
    const list = assignmentsByShift.get(a.shiftId) ?? []
    list.push(a)
    assignmentsByShift.set(a.shiftId, list)
  }

  // ---- Per-shift checks: coverage, working day/hours, unknown role -----
  for (const shift of shifts) {
    const shiftAssignments = assignmentsByShift.get(shift.id) ?? []
    const dow = new Date(`${shift.date}T00:00:00Z`).getUTCDay()

    if (!settings.workingDays.includes(dow)) {
      push(out, settings, 'non_working_day', 'warning', 'משמרת ביום שאינו יום עבודה', { shiftId: shift.id })
    }

    for (const req of shift.requirements) {
      if (!roleIds.has(req.roleId)) {
        push(out, settings, 'unknown_role', 'warning', 'משמרת דורשת תפקיד שאינו קיים יותר', { shiftId: shift.id })
        continue
      }
      const count = shiftAssignments.filter((a) => a.roleId === req.roleId).length
      if (count < req.min) {
        push(out, settings, 'understaffed', 'error', `חסר איוש (${count}/${req.min})`, { shiftId: shift.id })
      } else if (req.max !== undefined && count > req.max) {
        push(out, settings, 'overstaffed', 'warning', `איוש עודף (${count}/${req.max})`, { shiftId: shift.id })
      }
    }

    if (shift.requirements.length === 0 && shiftAssignments.length === 0) {
      push(out, settings, 'unassigned_shift', 'warning', 'משמרת ללא שיבוץ', { shiftId: shift.id })
    }

    // Duplicate assignment: same staff+role assigned twice on one shift.
    const seen = new Set<string>()
    for (const a of shiftAssignments) {
      if (!a.staffId) continue
      const key = `${a.staffId}:${a.roleId ?? ''}`
      if (seen.has(key)) {
        push(out, settings, 'duplicate_assignment', 'error', 'שיבוץ כפול לאותו תפקיד', { shiftId: shift.id, staffId: a.staffId })
      }
      seen.add(key)

      const staffRow = rosterById.get(a.staffId)
      if (staffRow && (!staffRow.active || !staffRow.schedulable)) {
        push(out, settings, 'inactive_staff', 'error', 'שובץ/ה איש/אשת צוות לא פעיל/ה', { shiftId: shift.id, staffId: a.staffId })
      }

      if (a.roleId && !roleIds.has(a.roleId)) {
        push(out, settings, 'unknown_role', 'warning', 'שיבוץ לתפקיד שאינו קיים יותר', { shiftId: shift.id, staffId: a.staffId })
      }

      if (settings.features.availability) {
        const sub = availability.find((av) => av.staffId === a.staffId && av.weekStart === input.weekStart)
        const entry = sub?.entries.find((e) => e.date === shift.date)
        if (entry?.kind === 'unavailable') {
          push(out, settings, 'availability_conflict', 'warning', 'שובץ/ה ביום שסומן כלא זמין', { shiftId: shift.id, staffId: a.staffId })
        }
      }
    }
  }

  // ---- Per-staff checks: overlap, rest, weekly/daily hours, consecutive days ----
  const byStaff = new Map<string, { shift: Shift; assignment: Assignment }[]>()
  for (const a of assignments) {
    if (!a.staffId) continue
    const shift = shiftById.get(a.shiftId)
    if (!shift) continue
    const list = byStaff.get(a.staffId) ?? []
    list.push({ shift, assignment: a })
    byStaff.set(a.staffId, list)
  }

  for (const [staffId, entries] of byStaff) {
    const intervals = entries
      .map((e) => ({ ...intervalOf(input.weekStart, e.shift), shiftId: e.shift.id }))
      .sort((a, b) => a.start - b.start)

    // Overlap + rest, adjacent pairs on the sorted timeline.
    for (let i = 0; i < intervals.length - 1; i++) {
      const cur = intervals[i]!
      const next = intervals[i + 1]!
      if (next.start < cur.end) {
        push(out, settings, 'overlap', 'error', 'משמרות חופפות לאותו איש/אשת צוות', { shiftId: next.shiftId, staffId })
      } else {
        const restMinutes = next.start - cur.end
        if (restMinutes < settings.safety.minRestHours * 60) {
          push(out, settings, 'min_rest', 'warning', `פחות מ-${settings.safety.minRestHours} שעות מנוחה בין משמרות`, {
            shiftId: next.shiftId,
            staffId,
          })
        }
      }
    }

    // Weekly hours — only shifts actually starting within the target week
    // count toward it (a spillover shift from last week's window counts
    // toward THAT week, not this one).
    const weeklyMinutes = entries
      .filter((e) => e.shift.date >= input.weekStart && daysBetween(input.weekStart, e.shift.date) < 7)
      .reduce((sum, e) => sum + durationMinutes(e.shift), 0)
    const cap = rosterById.get(staffId)?.maxWeeklyHours ?? settings.safety.maxWeeklyHours
    if (weeklyMinutes > cap * 60) {
      push(out, settings, 'max_weekly_hours', 'warning', `מעל ${cap} שעות שבועיות`, { staffId })
    }

    // Daily hours — sum per calendar date (a shift crossing midnight
    // counts fully on its start date, matching how a schedule reads it).
    const perDay = new Map<string, number>()
    for (const e of entries) {
      perDay.set(e.shift.date, (perDay.get(e.shift.date) ?? 0) + durationMinutes(e.shift))
    }
    for (const [date, mins] of perDay) {
      if (mins > settings.safety.maxDailyHours * 60) {
        const shiftId = entries.find((e) => e.shift.date === date)?.shift.id
        push(out, settings, 'max_daily_hours', 'warning', `מעל ${settings.safety.maxDailyHours} שעות ביום אחד`, { shiftId, staffId })
      }
    }

    // Consecutive working days.
    const workDates = [...new Set(entries.map((e) => e.shift.date))].sort()
    let streak = 1
    let maxStreak = workDates.length ? 1 : 0
    for (let i = 1; i < workDates.length; i++) {
      streak = daysBetween(workDates[i - 1]!, workDates[i]!) === 1 ? streak + 1 : 1
      maxStreak = Math.max(maxStreak, streak)
    }
    if (maxStreak > settings.safety.maxConsecutiveDays) {
      push(out, settings, 'max_consecutive_days', 'warning', `מעל ${settings.safety.maxConsecutiveDays} ימים רצופים`, { staffId })
    }
  }

  return out
}

/** Groups by code for WarningsPanel's list, most severe first. */
export function groupWarnings(warnings: Warning[]): Map<string, Warning[]> {
  const sorted = [...warnings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
  const grouped = new Map<string, Warning[]>()
  for (const w of sorted) {
    const list = grouped.get(w.code) ?? []
    list.push(w)
    grouped.set(w.code, list)
  }
  return grouped
}
