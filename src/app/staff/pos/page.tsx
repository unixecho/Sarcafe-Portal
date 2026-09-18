import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import OrdersWorkspace from '@/components/orders/OrdersWorkspace'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isStaff } from '@/lib/staff/access'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'

export const dynamic = 'force-dynamic'

// The register — any active staff member's landing page for taking orders
// and working the live board. Same branch-visibility rule as
// /staff/schedule: a branch-scoped staff row sees only their branch, an
// all-branch row sees every branch.
export default async function StaffPosPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceRoleClient()
  const { data: me } = await service
    .from('staff')
    .select('id, role, badge, branch_id')
    .eq('auth_user_id', user.id)
    .eq('active', true)
    .maybeSingle()
  if (!isStaff(me)) redirect('/no-access')

  const allBranches = await getBranches()
  const visibleBranches = me!.branch_id ? allBranches.filter((b) => b.id === me!.branch_id) : allBranches

  const cookieStore = await cookies()
  const initialBranch = resolveCurrentBranchSlug(visibleBranches, cookieStore.get(BRANCH_COOKIE)?.value)

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="קופה" backHref="/staff" />
      <OrdersWorkspace branches={visibleBranches} initialBranch={initialBranch} />
    </main>
  )
}
