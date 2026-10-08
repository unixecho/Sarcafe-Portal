import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import OwnerChecklistWorkspace from '@/components/checklists/OwnerChecklistWorkspace'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'

export const dynamic = 'force-dynamic'

export default async function OwnerChecklistsPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await createServiceRoleClient().from('staff').select('role, badge').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
  if (!isOp(me)) redirect('/no-access')
  const branches = await getBranches()
  const initialBranch = resolveCurrentBranchSlug(branches, (await cookies()).get(BRANCH_COOKIE)?.value)
  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 980, margin: '0 auto', padding: '0 16px 40px' }}>
      <OwnerHeader title="צ׳קליסטים" backHref="/owner/dashboard" />
      <OwnerChecklistWorkspace branches={branches} initialBranch={initialBranch} />
    </main>
  )
}
