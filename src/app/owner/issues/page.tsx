import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import OwnerIssuesWorkspace from '@/components/checklists/OwnerIssuesWorkspace'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'

export const dynamic = 'force-dynamic'

// The owner's "missing or not working" list: what the checklists reported, by what it was about. It is also where the
// daily morning alert goes (/owner/issues?branch=<slug> opens that branch).
export default async function OwnerIssuesPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/owner/issues')
  const service = createServiceRoleClient()
  const { data: me } = await service.from('staff').select('role, badge').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
  if (!isOp(me)) redirect('/no-access')
  const branches = await getBranches()
  const wanted = (await searchParams).branch
  const slug = branches.some((branch) => branch.slug === wanted) ? wanted : (await cookies()).get(BRANCH_COOKIE)?.value
  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 980, margin: '0 auto', padding: '0 16px 40px' }}>
      <OwnerHeader title="חוסרים ותקלות" backHref="/owner/dashboard" />
      <OwnerIssuesWorkspace branches={branches} initialBranch={resolveCurrentBranchSlug(branches, slug)} />
    </main>
  )
}
