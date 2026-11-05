import { isOp, type AccessRow } from '@/lib/staff/access'
import { isDeveloper } from '@/lib/checklists/developer'

// Which bottom dock a person gets, and on which pages (owner, 2026-11-05: "the bottom nav bar is constant"). The dock lives in the
// /owner and /staff LAYOUTS, so it stays mounted while the person moves between its tabs; it shows on the tab roots only (a task
// opened from a tab, a checklist being filled, an editor, has the screen to itself, as on a phone).
//
// Pure, so the QA unit stage checks it against the access rules: a tab must never point a person at a page they cannot open.

export type DockKind = 'manager' | 'employee'
export type DockPlan = { kind: DockKind; home: string; roots: string[] }
type Person = Pick<AccessRow, 'role' | 'badge'> & { email?: string | null; via?: string; quick?: boolean }

// /owner/kiosk/control is the second dashboard (the kiosk's): the bar stays there too, and its switch leads back.
const MANAGER_ROOTS = ['^/owner/dashboard$', '^/owner/schedule$', '^/owner/staff$', '^/owner/checklists$', '^/owner/kiosk/control$']
const EMPLOYEE_ROOTS = ['^/staff$', '^/staff/schedule$', '^/staff/checklists$', '^/staff/profile$']
const DEV_ROOTS = ['^/staff/dev$', '^/staff/dev/qa$']

/** `area`: the layout asking (/owner or /staff). Null: no dock (signed out, a six-digit-code sign-in, or not this person's area). */
export function dockPlanFor(me: Person | null | undefined, area: 'owner' | 'staff'): DockPlan | null {
  if (!me) return null
  const fullLogin = me.via === 'google' && !me.quick
  if (!fullLogin) return null
  const developer = isDeveloper(me)
  const owner = isOp(me)
  if (developer) {
    // the developer's home is their own dashboard; an owner-developer gets the manager tabs, otherwise the employee ones
    const kind: DockKind = owner ? 'manager' : 'employee'
    return { kind, home: '/staff/dev', roots: [...DEV_ROOTS, ...(kind === 'manager' ? MANAGER_ROOTS : EMPLOYEE_ROOTS.slice(1))] }
  }
  if (area === 'owner') return owner ? { kind: 'manager', home: '/owner/dashboard', roots: MANAGER_ROOTS } : null
  // an owner on a /staff page is visiting (their tabs are the /owner ones): no employee dock for them
  return owner ? null : { kind: 'employee', home: '/staff', roots: EMPLOYEE_ROOTS }
}

export const onDockRoot = (plan: DockPlan | null, pathname: string) => !!plan && plan.roots.some((re) => new RegExp(re).test(pathname))
