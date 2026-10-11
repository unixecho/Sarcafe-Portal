// What the shareable schedule poster shows, as plain data — built from the same
// loaded schedule every other screen reads, so a shared picture can never
// disagree with the app. Pure: no canvas, no DOM (poster-render.ts draws it).
//
// Two scopes:
//   mine       the viewer's own shifts (with who else is on each), all seven days so days off are visible
//   everyone   the whole branch's week, as published (or as drafted, labelled so)

import { hoursFor, matchPreset } from './presets'
import { staffColor } from './people'
import { durationMinutes, formatDateLabel, formatHours, formatShiftRange, relativeDayLabel, weekDates, weekdayLongLabel } from './time'
import { indexByShift, nameOf, rosterRow } from './view'
import type { ShiftsDB } from './types'

export type PosterScope = 'mine' | 'everyone'

export type PosterPerson = { name: string; role: string; color: string; emoji: string | null; mine: boolean }
export type PosterRow = { time: string; label: string; place: string; note: string; mine: boolean; empty: boolean; people: PosterPerson[] }
export type PosterDay = { weekday: string; date: string; relative: string | null; today: boolean; closed: boolean; hours: string | null; note: string | null; rows: PosterRow[] }

export type PosterModel = {
  scope: PosterScope
  title: string
  branchName: string
  rangeLabel: string
  published: boolean
  /** One line under the title: what this poster adds up to. */
  summary: string
  days: PosterDay[]
  /** "נוצר ב־11.10 · 10:08" */
  madeAt: string
}

export function buildPosterModel(db: ShiftsDB, args: { weekStart: string; scope: PosterScope; branchName: string }): PosterModel {
  const { weekStart, scope, branchName } = args
  const week = db.weeks.find((w) => w.weekStart === weekStart)
  const shifts = week ? db.shifts.filter((s) => s.weekId === week.id) : []
  const ids = new Set(shifts.map((s) => s.id))
  const assignments = db.assignments.filter((a) => ids.has(a.shiftId))
  const byShift = indexByShift(assignments)
  const me = db.viewerStaffId
  const roleName = (id: string | null) => (id ? (db.settings.roles.find((r) => r.id === id)?.name ?? '') : '')
  const dates = weekDates(weekStart)

  let shiftCount = 0
  let minutes = 0
  const people = new Set<string>()

  const days: PosterDay[] = dates.map((date, dow) => {
    const isWorkingDay = db.settings.workingDays.includes(dow)
    const hours = hoursFor(date, db.settings)
    const dayShifts = shifts
      .filter((s) => s.date === date)
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime))
      .filter((s) => scope === 'everyone' || (byShift.get(s.id) ?? []).some((a) => a.staffId === me))
    const rows: PosterRow[] = dayShifts.map((s) => {
      const on = byShift.get(s.id) ?? []
      const mine = on.some((a) => a.staffId === me)
      shiftCount++
      if (mine) minutes += durationMinutes(s)
      for (const a of on) if (a.staffId) people.add(a.staffId)
      const preset = matchPreset(s, db.settings.presets) ?? (s.presetId ? db.settings.presets.find((p) => p.id === s.presetId) : undefined)
      const station = s.stationId ? db.settings.stations.find((st) => st.id === s.stationId) : undefined
      return {
        time: formatShiftRange(s.startTime, s.endTime),
        label: preset?.name ?? '',
        place: station ? `${station.emoji} ${station.name}` : '',
        note: s.note ?? '',
        mine,
        empty: on.length === 0,
        people: on.map((a) => ({
          name: a.staffId === me ? 'אתם' : nameOf(db, a.staffId, a.staffName),
          role: roleName(a.roleId),
          color: staffColor(a.staffId, db.roster) ?? '#c9b8a6',
          emoji: rosterRow(db, a.staffId)?.avatarEmoji ?? null,
          mine: a.staffId === me,
        })),
      }
    })
    return {
      weekday: weekdayLongLabel(dow),
      date: formatDateLabel(date),
      relative: relativeDayLabel(date, db.now),
      today: date === db.now.date,
      closed: !isWorkingDay,
      hours: isWorkingDay ? formatShiftRange(hours.open, hours.close) : null,
      note: week?.dayNotes[date] ?? null,
      rows,
    }
  })

  const summary =
    scope === 'mine'
      ? shiftCount === 0
        ? 'אין לכם משמרות השבוע'
        : `${shiftCount} משמרות · ${formatHours(minutes)}`
      : shiftCount === 0
        ? 'עוד אין משמרות בשבוע הזה'
        : `${shiftCount} משמרות · ${people.size} עובדים`

  return {
    scope,
    title: scope === 'mine' ? 'המשמרות שלי' : 'לוח משמרות',
    branchName,
    rangeLabel: `${formatDateLabel(dates[0]!)} – ${formatDateLabel(dates[6]!)}`,
    published: week?.status === 'published',
    summary,
    days,
    madeAt: `נוצר ב־${formatDateLabel(db.now.date)} · ${db.now.time}`,
  }
}
