import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import StaffManager from '@/components/StaffManager'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'
import { BRANCH_COOKIE } from '@/lib/branches/current'

export const dynamic = 'force-dynamic'

export default async function OwnerStaffPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceRoleClient()
  const { data: me } = await service
    .from('staff')
    .select('role, badge')
    .eq('auth_user_id', user.id)
    .eq('active', true)
    .maybeSingle()
  if (!isOp(me)) redirect('/no-access')

  const { data: branches } = await service.from('branches').select('id, slug, name').order('slug')

  // Unlike the editor/dashboard, staff is legitimately cross-branch — so an
  // unset cookie defaults to "all branches" (today's behavior), not the
  // first branch. A branch the owner DID pick elsewhere still carries over,
  // per the shared sarcafe_branch cookie (lib/branches/current.ts).
  const cookieStore = await cookies()
  const cookieSlug = cookieStore.get(BRANCH_COOKIE)?.value
  const initialBranchSlug = cookieSlug && (branches ?? []).some((b) => b.slug === cookieSlug) ? cookieSlug : ''

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 560, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="צוות" backHref="/owner/dashboard" />
      <StaffManager branches={branches ?? []} initialBranchSlug={initialBranchSlug} />
    </main>
  )
}
