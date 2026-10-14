import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import OwnerChecklistWorkspace from '@/components/checklists/OwnerChecklistWorkspace'
import { isChecklistId, ownerChecklistPath } from '@/lib/checklists/links'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'

// The owner's checklists, served at /owner/checklists and at /owner/checklists/<id>: the second is what an owner's
// "checklist not submitted" alert opens. It switches to the checklist's own branch, shows the shift tracker and
// scrolls to that row, where the checklist can be dismissed. An id that matches nothing is ignored.
export default async function OwnerChecklistsPageBody({ focusId = null }: { focusId?: string | null }) {
  const wanted = isChecklistId(focusId) ? focusId : null
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(wanted ? `/login?next=${ownerChecklistPath(wanted)}` : '/login')
  const service = createServiceRoleClient()
  const { data: me } = await service.from('staff').select('role, badge').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
  if (!isOp(me)) redirect('/no-access')
  const branches = await getBranches()

  let branchSlug = (await cookies()).get(BRANCH_COOKIE)?.value
  let focus: string | null = null
  if (wanted) {
    const { data: row } = await service.from('checklist_assignments').select('id, branch_id').eq('id', wanted).maybeSingle()
    const branch = row ? branches.find((candidate) => candidate.id === row.branch_id) : undefined
    if (branch) {
      branchSlug = branch.slug
      focus = wanted
    }
  }
  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 980, margin: '0 auto', padding: '0 16px 40px' }}>
      <OwnerHeader title="צ׳קליסטים" backHref="/owner/dashboard" />
      <OwnerChecklistWorkspace branches={branches} initialBranch={resolveCurrentBranchSlug(branches, branchSlug)} focusId={focus} />
    </main>
  )
}
