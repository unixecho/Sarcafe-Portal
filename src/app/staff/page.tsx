import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CalendarClock, ChevronLeft, ClipboardCheck, Receipt, ShoppingBag, UserRound } from 'lucide-react'
import OwnerHeader from '@/components/OwnerHeader'
import InstallAppButton from '@/components/app/InstallAppButton'
import DashboardSections, { type DashboardCategory } from '@/components/app/DashboardSections'
import DashboardNotifications, { type DashboardNotification } from '@/components/app/DashboardNotifications'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { hasAnyMenuEditAccess, isOp } from '@/lib/staff/access'

export const dynamic = 'force-dynamic'

export default async function StaffIndexPage() {
  const me = await resolveStaffIdentity()
  if (!me) redirect('/login?next=/staff&quick=1')
  const fullLogin = me.via === 'google' && !me.quick
  if (fullLogin && isOp(me)) redirect('/owner/dashboard')

  const scheduleHref = fullLogin ? '/staff/schedule' : '/login?next=/staff/schedule'
  const service = createServiceRoleClient()
  const [updates, count] = await Promise.all([
    service.from('schedule_notifications').select('id, title, body, created_at, read_at').eq('staff_id', me.id).order('created_at', { ascending: false }).limit(20),
    service.from('schedule_notifications').select('id', { count: 'exact', head: true }).eq('staff_id', me.id).is('read_at', null),
  ])
  const categories: DashboardCategory[] = [
    { title: 'המשמרת שלי', entries: [
      { href: '/staff/checklists', icon: ClipboardCheck, label: 'צ׳קליסטים למשמרת', description: 'פתיחה, החלפה וסגירה — הכל במקום אחד' },
      { href: scheduleHref, icon: CalendarClock, label: 'משמרות ובקשות', description: fullLogin ? 'הסידור שפורסם, העדפות והחלפת משמרת' : 'כניסה עם Google לצפייה בסידור ולהגשת בקשות' },
    ] },
    { title: 'במהלך השירות', entries: [
      ...(fullLogin ? [{ href: '/staff/pos', icon: ShoppingBag, label: 'הזמנות מהירות', description: 'קבלת הזמנות ומעקב בזמן אמת' }] : []),
      { href: '/pos', icon: Receipt, label: 'קופת אירועים ועמדות', description: 'הזמנות האירוע והעמדה שבה עובדים' },
    ] },
  ]
  if (fullLogin && hasAnyMenuEditAccess(me)) categories.push({ title: 'ניהול במשמרת', entries: [
    { href: '/owner/schedule', icon: CalendarClock, label: 'ניהול סידור העבודה', description: 'שיבוצים, בקשות ואישור החלפות בסניף שלך' },
    { href: '/owner/editor', icon: ShoppingBag, label: 'ניהול התפריט', description: 'עריכת התפריט והזמינות בסניף שלך' },
    { href: '/owner/pos', icon: Receipt, label: 'ניהול קופת אירועים', description: 'כלי ניהול לאירועים שבאחריותך' },
  ] })
  const name = me.first_name || me.display_name || 'צוות Sarcafe'
  const date = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

  return (
    <main id="main" tabIndex={-1} className="app-page">
      <OwnerHeader title="Sarcafe צוות" homeHref="/staff" />
      <div className="app-welcome"><div><h2>שלום, {name}</h2><p>{fullLogin ? 'המשמרות, המשימות והצוות שלך.' : 'צ׳קליסטים וקופת אירועים, מוכנים למשמרת שלך.'}</p></div><span className="app-date">{date}</span></div>
      <DashboardNotifications initialNotifications={(updates.data ?? []) as DashboardNotification[]} initialUnread={count.count ?? 0} initialError={!!updates.error || !!count.error} scheduleHref={scheduleHref} />
      <DashboardSections categories={categories} staff />
      <div className="app-group app-account"><Link href="/staff/profile" className="app-row app-row--quiet"><span className="app-row__icon"><UserRound size={22} aria-hidden="true" /></span><span className="app-row__copy"><strong>הפרופיל שלי</strong><small>פרטי חשבון, קוד כניסה והיסטוריה אישית</small></span><ChevronLeft size={18} className="app-row__chevron" aria-hidden="true" /></Link><InstallAppButton /></div>
    </main>
  )
}
