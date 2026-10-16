import { redirect } from 'next/navigation'
import OwnerHeader from '@/components/OwnerHeader'
import EmployeeDashboardView from '@/components/dashboard/EmployeeDashboardView'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { isOp } from '@/lib/staff/access'
import { isDeveloper } from '@/lib/checklists/developer'
import { loadGateState } from '@/lib/staff/gate-state'

export const dynamic = 'force-dynamic'

// The employee home. The body is components/dashboard/EmployeeDashboardView.tsx, which the developer's dashboard also
// shows as its "employee" view. The developer has ONE dashboard with all three views (/staff/dev), so a developer who
// opens this page is sent there; owners who are not developers land on the owner dashboard.
export default async function StaffIndexPage() {
  const me = await resolveStaffIdentity()
  if (!me) redirect('/login?next=/staff&quick=1')
  if (isDeveloper(me)) redirect('/staff/dev?view=employee')
  // Set the personal code but never finished the walk (an app closed half-way, a new phone): back to it, at the right step.
  if ((await loadGateState(me.id)).onboardingPending) redirect('/staff/onboarding')
  const fullLogin = me.via === 'google' && !me.quick
  if (fullLogin && isOp(me)) redirect('/owner/dashboard')

  return (
    <main id="main" tabIndex={-1} className="app-page">
      <OwnerHeader title="Sarcafe צוות" homeHref="/staff" />
      <EmployeeDashboardView me={me} />
    </main>
  )
}
