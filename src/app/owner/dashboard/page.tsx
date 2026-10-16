import { redirect } from 'next/navigation'
import { ClipboardCheck, Users, ShieldCheck, Receipt } from 'lucide-react'
import OwnerHeader from '@/components/OwnerHeader'
import DashboardSections from '@/components/app/DashboardSections'
import StaffPushCard from '@/components/staff/StaffPushCard'
import WorkshopCard from '@/components/workshop/WorkshopCard'
import DashboardNotifications from '@/components/app/DashboardNotifications'
import OwnerDashboardView from '@/components/dashboard/OwnerDashboardView'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'
import { isQuickSessionId, validatedSessionId } from '@/lib/pos/server/quick-login'
import { isDeveloper } from '@/lib/checklists/developer'

export const dynamic = 'force-dynamic'

// The owner's dashboard. The body is components/dashboard/OwnerDashboardView.tsx, which the developer's dashboard also
// shows as its "manager" view; a developer who opens this page is sent to that one (/staff/dev?view=manager).
export default async function OwnerDashboardPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const service = createServiceRoleClient()
  const { data: me } = await service.from('staff').select('id, role, badge, branch_id, email, first_name').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
  if (!isOp(me)) redirect('/no-access')

  const quick = await validatedSessionId(supabase).then(isQuickSessionId).catch(() => true)
  if (quick) {
    return (
      <main id="main" tabIndex={-1} className="app-page">
        <OwnerHeader title="Sarcafe צוות" homeHref="/staff" />
        <section className="app-hero"><h2>שלום, {me?.first_name || 'צוות Sarcafe'}</h2><p>הכניסה עם הקוד מאפשרת לעבוד בצ׳קליסטים ובקופת האירועים. אפשר להיכנס עם Google כדי לפתוח את כלי הניהול.</p></section>
        <StaffPushCard />
        <DashboardNotifications scheduleHref="/login?next=/staff/schedule" googleSignedIn={false} />
        <WorkshopCard />
        <DashboardSections staff categories={[
          { title: 'במשמרת', entries: [{ href: '/staff/checklists', icon: ClipboardCheck, label: 'צ׳קליסטים למשמרת', description: 'פתיחה, החלפה וסגירה' }, { href: '/pos', icon: Receipt, label: 'קופת אירועים', description: 'הזמנות ועמדות הכנה' }] },
          { title: 'החשבון שלי', entries: [{ href: '/staff/profile', icon: Users, label: 'הפרופיל שלי', description: 'פרטי חשבון וקוד כניסה' }, { href: '/login?next=/owner/dashboard', icon: ShieldCheck, label: 'כניסה לניהול עם Google', description: 'צוות, סידור עבודה ודיווחים' }] },
        ]} />
      </main>
    )
  }
  if (isDeveloper(me)) redirect('/staff/dev?view=manager')

  return (
    <main id="main" tabIndex={-1} className="app-page">
      <OwnerHeader title="לוח הבקרה" homeHref="/owner/dashboard" />
      <OwnerDashboardView me={{ id: me!.id as string, role: me!.role as string | null, badge: me!.badge as string | null, branch_id: me!.branch_id as string | null, email: me!.email as string | null, first_name: me!.first_name as string | null }} />
    </main>
  )
}
