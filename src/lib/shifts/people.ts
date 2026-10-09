import type { RoleRequirement, ScheduleStaffRow, ShiftPreset, ShiftRole } from './types'

const normalize = (value: string | null | undefined) =>
  (value ?? '').toLocaleLowerCase('he').replace(/[\s_\-/]+/g, '')

/**
 * Picks the role people expect when they add someone to a shift. A configured
 * personal default wins; legacy staff badges are then matched to the role
 * catalog, followed by the selected shift template and an unmet requirement.
 */
export function suggestedRoleId(
  person: ScheduleStaffRow | undefined,
  roles: ShiftRole[],
  preset: ShiftPreset | undefined,
  requirements: RoleRequirement[],
  assignedRoleIds: Array<string | null>
): string | null {
  const ids = new Set(roles.map((role) => role.id))
  if (person?.defaultRoleId && ids.has(person.defaultRoleId)) return person.defaultRoleId

  const badge = normalize(person?.badge)
  const badgeRole = badge ? roles.find((role) => normalize(role.id) === badge || normalize(role.name) === badge) : undefined
  if (badgeRole) return badgeRole.id
  if (preset?.roleId && ids.has(preset.roleId)) return preset.roleId

  const unmet = requirements.find((requirement) => assignedRoleIds.filter((id) => id === requirement.roleId).length < requirement.min)
  if (unmet && ids.has(unmet.roleId)) return unmet.roleId
  return roles[0]?.id ?? null
}

/** Stable, branch-local colors: adjacent staff get deliberately separated hues. */
export function staffColor(staffId: string | null | undefined, roster: ScheduleStaffRow[]): string | undefined {
  if (!staffId) return undefined
  const ids = [...new Set(roster.map((row) => row.staffId))].sort()
  const index = ids.indexOf(staffId)
  if (index < 0) return undefined
  const hue = Math.round((18 + index * 137.508) % 360)
  return `hsl(${hue} 72% 64%)`
}
