import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import TabletWorkspace from '@/components/TabletWorkspace'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { hasAnyMenuEditAccess } from '@/lib/staff/access'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'

export const dynamic = 'force-dynamic'

// Same staff login as the editor (no separate PIN gate) — just a
// touch-optimized layout meant for a tablet mounted behind the counter.
// Access is the same coarse gate the editor uses (hasAnyMenuEditAccess);
// POST /api/owner/menu-availability re-checks per-branch access, same
// defense-in-depth pattern as every other owner route.
export default async function OwnerTabletPage() {
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
      <OwnerHeader title="זמינות בזמן אמת" backHref="/owner/dashboard" />
      <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', margin: '0 0 16px' }}>
        כל שינוי כאן משפיע מיד על התפריט שהלקוחות רואים — בלי צורך בפרסום.
      </p>
      <TabletWorkspace branches={visibleBranches} initialBranch={initialBranch} />
    </main>
  )
}
