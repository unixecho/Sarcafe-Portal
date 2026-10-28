import { redirect } from 'next/navigation'
import OwnerHeader from '@/components/OwnerHeader'
import WaitlistInbox from '@/components/WaitlistInbox'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'

export const dynamic = 'force-dynamic'

// Full owner only. These are customers' names and phone numbers; the page, the API behind it and the export each
// re-check the role on the server, and the tables themselves have no browser grants.
export default async function OwnerWaitlistPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceRoleClient()
  const { data: me } = await service.from('staff').select('role, badge').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
  if (!isOp(me)) redirect('/no-access')

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="נרשמים למועדון" backHref="/owner/dashboard" />
      <WaitlistInbox />
    </main>
  )
}
