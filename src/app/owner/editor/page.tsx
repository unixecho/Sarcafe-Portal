import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import EditorWorkspace from '@/components/EditorWorkspace'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { hasAnyMenuEditAccess, isOp } from '@/lib/staff/access'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'

export const dynamic = 'force-dynamic'

export default async function MenuEditorPage() {
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

  // Coarse gate here (any menu-edit access, branch-blind) — the API routes
  // resolve the fine-grained per-branch decision once a branch is chosen.
  if (!hasAnyMenuEditAccess(me)) redirect('/no-access')

  // A branch-scoped general_manager (branch_id set) only ever sees their
  // own branch and gets no switcher; null means all-branch access.
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
      <OwnerHeader title="עריכת תפריט" backHref="/owner/dashboard" />
      <EditorWorkspace
        branches={branches}
        allowedBranchSlug={allowedBranchSlug}
        isOwner={isOp(me)}
        initialBranch={initialBranch}
      />
    </main>
  )
}
