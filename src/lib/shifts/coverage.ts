// "Is this shift staffed?" — pure, shared by the week board, the employee view
// (which shifts need someone) and the request form. The same rule is applied in
// SQL by sched_needed() / sched_request_shift() (migration 018): KEEP IN SYNC.
//
//   needed   = the sum of the per-role minimums the shift declares (0 = the
//              manager never said how many are needed);
//   assigned = people on it.
//
//   unassigned  nobody on it
//   partial     needs more people than it has            (missing > 0)
//   full        has at least as many as it needs         (needed > 0)
//   staffed     nobody was asked for, but someone is on it
//
// A shift that declares no need is never "occupied": anyone may ask to join it,
// and the manager is shown who is already on it when deciding.

import type { Assignment, RoleRequirement, Shift } from './types'

export type CoverageState = 'unassigned' | 'partial' | 'full' | 'staffed'

export type Coverage = {
  needed: number
  assigned: number
  missing: number
  state: CoverageState
  /** Per-role shortfall, for "חסר/ה בריסטה" chips. Only roles still short. */
  short: { roleId: string; missing: number }[]
}

export function neededFor(requirements: RoleRequirement[]): number {
  return requirements.reduce((sum, r) => sum + (Number.isInteger(r.min) && r.min > 0 ? r.min : 0), 0)
}

export function coverageOf(shift: Pick<Shift, 'requirements'>, assignments: Pick<Assignment, 'roleId'>[]): Coverage {
  const needed = neededFor(shift.requirements)
  const assigned = assignments.length
  const short = shift.requirements
    .map((r) => ({ roleId: r.roleId, missing: Math.max(0, r.min - assignments.filter((a) => a.roleId === r.roleId).length) }))
    .filter((r) => r.missing > 0)
  const missing = needed > 0 ? Math.max(0, needed - assigned) : 0
  let state: CoverageState
  if (assigned === 0) state = 'unassigned'
  else if (needed > 0) state = assigned >= needed ? 'full' : 'partial'
  else state = 'staffed'
  return { needed, assigned, missing, state, short }
}

/** A shift an employee may still ask to join: it declares a need and has not reached it, or declares none. */
export function isFull(coverage: Coverage): boolean {
  return coverage.needed > 0 && coverage.assigned >= coverage.needed
}
