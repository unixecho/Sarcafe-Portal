import { redirect } from 'next/navigation'
import OwnerHeader from '@/components/OwnerHeader'
import KioskContentEditor from '@/components/kiosk-admin/KioskContentEditor'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'
import { loadOwnerKioskContent } from '@/lib/kiosk/content'

export const dynamic = 'force-dynamic'

// The kiosk's cards, timings, hours exceptions and poll options. Full owner only: the page re-checks the role here
// (whatever the middleware decided), and the API behind its one Save checks it again.
export default async function OwnerKioskPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceRoleClient()
  const { data: me } = await service.from('staff').select('role, badge').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
  if (!isOp(me)) redirect('/no-access')

  const content = await loadOwnerKioskContent().catch(() => null)

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="תוכן הקיוסק" backHref="/owner/dashboard" />
      {content ? (
        <KioskContentEditor initial={content} />
      ) : (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>
          לא ניתן לטעון את תוכן הקיוסק. ייתכן שעדיין לא הוחל עדכון מסד הנתונים של התכונה.
        </p>
      )}
    </main>
  )
}
