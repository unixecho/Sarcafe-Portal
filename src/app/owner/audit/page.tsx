import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import AuditWorkspace from '@/components/AuditWorkspace'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { hasAnyMenuEditAccess } from '@/lib/staff/access'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'

export const dynamic = 'force-dynamic'

export default async function OwnerAuditPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceRoleClient()
  const { data: me } = await service
    .from('staff')
    .select('role, badge, branch_id')
    .eq('auth_user_id', user.id)
    .eq('active', true)
    .maybeSingle()

  // Same coarse gate as the editor page: whoever can edit a branch's menu
  // can see that branch's change history. GET /api/owner/audit re-checks
  // per-branch access, same defense-in-depth pattern as menu-variants.
  if (!hasAnyMenuEditAccess(me)) redirect('/no-access')

  let allowedBranchSlug: string | null = null
  if (me?.branch_id) {
    const { data: branch } = await service.from('branches').select('slug').eq('id', me.branch_id).maybeSingle()
    allowedBranchSlug = branch?.slug ?? null
  }

  const branches = await getBranches()
  const visibleBranches = allowedBranchSlug ? branches.filter((b) => b.slug === allowedBranchSlug) : branches
  const cookieStore = await cookies()
  const initialBranch = resolveCurrentBranchSlug(visibleBranches, cookieStore.get(BRANCH_COOKIE)?.value)

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="יומן שינויים" backHref="/owner/dashboard" />
      <AuditWorkspace branches={visibleBranches} initialBranch={initialBranch} />
    </main>
  )
}
