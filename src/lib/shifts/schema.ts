// The request-body schema for POST /api/shifts/dispatch — one strict zod variant
// per action. Strict on purpose: a field the server did not expect (an actor id,
// a status, a price) is a 400, never something silently passed along. Server only;
// the shapes the client may send are the ScheduleAction union in actions.ts.

import { z } from 'zod'
import { HM_PATTERN, ISO_DATE_PATTERN } from './time'
import type { ScheduleAction } from './actions'

const uuid = z.string().uuid()
const isoDate = z.string().regex(ISO_DATE_PATTERN)
const hm = z.string().regex(HM_PATTERN)
const slug = z.string().trim().min(1).max(64)
const note = z.string().trim().max(300).nullish()

const requirement = z
  .object({ roleId: slug, min: z.number().int().min(0).max(50), max: z.number().int().min(0).max(50).optional() })
  .strict()

const assignee = z
  .object({ staffId: uuid, roleId: slug.nullable().optional(), assignmentId: uuid.optional() })
  .strict()

const availabilityEntry = z
  .object({ date: isoDate, kind: z.enum(['unavailable', 'partial', 'prefer']), from: hm.optional(), to: hm.optional() })
  .strict()

// ---- Settings: every key optional, every value bounded ----------------------------
const role = z.object({ id: slug, name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict()
const station = z.object({ id: slug, name: z.string().trim().min(1).max(40), emoji: z.string().max(8) }).strict()
const preset = z
  .object({ id: slug, name: z.string().trim().min(1).max(40), startTime: hm, endTime: hm, roleId: slug.optional(), stationId: slug.optional() })
  .strict()
  .refine((p) => p.startTime !== p.endTime, { message: 'start and end must differ' })

const unique = <T extends { id: string }>(list: T[]) => new Set(list.map((i) => i.id)).size === list.length

export const settingsPatchSchema = z
  .object({
    workingDays: z.array(z.number().int().min(0).max(6)).max(7),
    openTime: hm,
    closeTime: hm,
    dayHours: z.record(z.string().regex(/^[0-6]$/), z.object({ open: hm, close: hm }).strict()),
    roles: z.array(role).max(30).refine(unique, 'duplicate role id'),
    stations: z.array(station).max(30).refine(unique, 'duplicate station id'),
    presets: z.array(preset).max(20).refine(unique, 'duplicate template id'),
    safety: z
      .object({
        maxWeeklyHours: z.number().min(1).max(168),
        minRestHours: z.number().min(0).max(24),
        maxDailyHours: z.number().min(1).max(24),
        maxConsecutiveDays: z.number().int().min(1).max(14),
      })
      .strict(),
    ruleSeverity: z.record(z.string().max(40), z.enum(['error', 'warning', 'off'])),
    features: z.object({ availability: z.boolean(), swaps: z.boolean() }).strict(),
    scheduleManagers: z.array(uuid).max(30),
  })
  .partial()
  .strict()

export type SettingsPatch = z.infer<typeof settingsPatchSchema>

const memberPatch = z
  .object({
    schedulable: z.boolean(),
    defaultRoleId: slug.nullable(),
    maxWeeklyHours: z.number().int().min(0).max(168).nullable(),
    employmentType: z.string().trim().max(40).nullable(),
    sortOrder: z.number().int().min(0).max(10000).nullable(),
    note: z.string().trim().max(300).nullable(),
  })
  .partial()
  .strict()

export const actionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('saveShift'),
      weekId: uuid,
      shiftId: uuid.nullish(),
      date: isoDate,
      startTime: hm,
      endTime: hm,
      presetId: slug.nullish(),
      stationId: slug.nullish(),
      requirements: z.array(requirement).max(30),
      note,
      assignees: z.array(assignee).max(60),
      expectedUpdatedAt: z.string().max(40).nullish(),
    })
    .strict(),
  z.object({ type: z.literal('deleteShift'), shiftId: uuid }).strict(),
  z.object({ type: z.literal('moveAssignment'), assignmentId: uuid, toShiftId: uuid }).strict(),
  z.object({ type: z.literal('publishWeek'), weekId: uuid }).strict(),
  z.object({ type: z.literal('unpublishWeek'), weekId: uuid }).strict(),
  z.object({ type: z.literal('clearWeek'), weekId: uuid }).strict(),
  z.object({ type: z.literal('copyWeek'), branchId: uuid, fromWeekStart: isoDate, toWeekStart: isoDate }).strict(),
  z.object({ type: z.literal('setDayNote'), weekId: uuid, date: isoDate, note: z.string().trim().max(120) }).strict(),
  z.object({ type: z.literal('updateSettings'), branchId: uuid, patch: settingsPatchSchema }).strict(),
  z.object({ type: z.literal('setMember'), branchId: uuid, staffId: uuid, patch: memberPatch }).strict(),
  z
    .object({
      type: z.literal('submitAvailability'),
      branchId: uuid,
      weekStart: isoDate,
      entries: z.array(availabilityEntry).max(7),
      note,
      status: z.enum(['draft', 'submitted']),
    })
    .strict(),
  z.object({ type: z.literal('requestShift'), shiftId: uuid, note }).strict(),
  z.object({ type: z.literal('cancelRequest'), requestId: uuid }).strict(),
  z
    .object({ type: z.literal('requestSwap'), assignmentId: uuid, targetStaffId: uuid.nullish(), returnAssignmentId: uuid.nullish(), reason: note })
    .strict(),
  z.object({ type: z.literal('respondSwap'), swapId: uuid, accept: z.boolean() }).strict(),
  z.object({ type: z.literal('cancelSwap'), swapId: uuid }).strict(),
  z.object({ type: z.literal('decideRequest'), requestId: uuid, approve: z.boolean(), note, force: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('decideSwap'), swapId: uuid, approve: z.boolean(), note }).strict(),
  z.object({ type: z.literal('markNotificationsRead'), ids: z.array(uuid).max(100).optional() }).strict(),
])

export function parseAction(body: unknown): ScheduleAction {
  return actionSchema.parse(body) as ScheduleAction
}
