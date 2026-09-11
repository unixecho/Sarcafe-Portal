import { redirect } from 'next/navigation'
import OwnerHeader from '@/components/OwnerHeader'
import StaffManager from '@/components/StaffManager'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'

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

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="צוות" backHref="/owner/dashboard" />
      <StaffManager branches={branches ?? []} />
    </main>
  )
}
