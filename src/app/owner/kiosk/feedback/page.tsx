import { redirect } from 'next/navigation'
import OwnerHeader from '@/components/OwnerHeader'
import KioskPollResults from '@/components/kiosk-admin/KioskPollResults'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'

export const dynamic = 'force-dynamic'

// The results of the poll the kiosk's QR opens. Full owner only, re-checked here and by the API behind it.
export default async function OwnerKioskFeedbackPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceRoleClient()
  const { data: me } = await service.from('staff').select('role, badge').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
  if (!isOp(me)) redirect('/no-access')

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="תוצאות ההצבעה" backHref="/owner/kiosk" />
      <KioskPollResults />
    </main>
  )
}
