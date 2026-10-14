import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import StaffChecklistWorkspace from '@/components/checklists/StaffChecklistWorkspace'
import { isChecklistId, staffChecklistPath } from '@/lib/checklists/links'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'

// The employee's checklists, served at /staff/checklists (the list) and at /staff/checklists/<id> (that exact
// checklist, opened straight away). The id is a path segment, not a query, because a signed-out visitor is sent
// through /login?next=… and that value cannot carry a query: a push tapped on a phone whose sign-in expired still
// lands on the checklist it named. An id that is not the signed-in person's own is ignored (the plain list shows,
// with nothing that confirms the id exists).
export default async function StaffChecklistsPageBody({ openId = null, requestedBranch }: { openId?: string | null; requestedBranch?: string }) {
  const wanted = isChecklistId(openId) ? openId : null
  const me = await resolveStaffIdentity()
  if (!me) redirect(`/login?next=${wanted ? staffChecklistPath(wanted) : '/staff/checklists'}&quick=1`)
  const allBranches = await getBranches()
  const visibleBranches = me.branch_id ? allBranches.filter((branch) => branch.id === me.branch_id) : allBranches

  let branchSlug = requestedBranch
  let open: string | null = null
  if (wanted) {
    const { data: row } = await createServiceRoleClient().from('checklist_assignments').select('id, staff_id, branch_id').eq('id', wanted).maybeSingle()
    const own = row && row.staff_id === me.id ? visibleBranches.find((branch) => branch.id === row.branch_id) : undefined
    if (own) {
      branchSlug = own.slug
      open = wanted
    }
  }
  // The checklist's own branch wins; otherwise a link from the home screen may name one; otherwise the remembered one.
  const initialBranch = resolveCurrentBranchSlug(visibleBranches, branchSlug && visibleBranches.some((branch) => branch.slug === branchSlug) ? branchSlug : (await cookies()).get(BRANCH_COOKIE)?.value)
  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 760, margin: '0 auto', padding: '0 16px 40px' }}>
      <OwnerHeader title="צ׳קליסט למשמרת" backHref="/staff" />
      <StaffChecklistWorkspace branches={visibleBranches} initialBranch={initialBranch} openId={open} />
    </main>
  )
}
