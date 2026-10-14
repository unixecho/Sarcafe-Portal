import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Beaker, CalendarClock, ChevronLeft, ClipboardCheck, LayoutDashboard, Receipt, ShoppingBag, UserRound } from 'lucide-react'
import OwnerHeader from '@/components/OwnerHeader'
import InstallAppButton from '@/components/app/InstallAppButton'
import DashboardSections, { type DashboardCategory } from '@/components/app/DashboardSections'
import StaffPushCard from '@/components/staff/StaffPushCard'
import ShiftStatusCard from '@/components/staff/ShiftStatusCard'
import GoogleLinkPrompt from '@/components/staff/GoogleLinkPrompt'
import WorkshopCard from '@/components/workshop/WorkshopCard'
import DashboardNotifications, { type DashboardNotification } from '@/components/app/DashboardNotifications'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { loadShiftStatus } from '@/lib/staff/shift-status'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { hasAnyMenuEditAccess, isOp } from '@/lib/staff/access'
import { isDeveloper } from '@/lib/checklists/developer'

export const dynamic = 'force-dynamic'

export default async function StaffIndexPage() {
  const me = await resolveStaffIdentity()
  if (!me) redirect('/login?next=/staff&quick=1')
  const fullLogin = me.via === 'google' && !me.quick
  // The developer lives in the employee panel like anyone else (shift status, checklist button) and has a
  // dedicated place for the test tools; the owner dashboard is one tap away. Other owners land on the dashboard.
  const developer = isDeveloper(me)
  if (fullLogin && isOp(me) && !developer) redirect('/owner/dashboard')

  const scheduleHref = fullLogin ? '/staff/schedule' : '/login?next=/staff/schedule'
  const service = createServiceRoleClient()
  const [updates, count, shiftStatus] = await Promise.all([
    service.from('schedule_notifications').select('id, kind, title, body, link, created_at, read_at').eq('staff_id', me.id).order('created_at', { ascending: false }).limit(20),
    service.from('schedule_notifications').select('id', { count: 'exact', head: true }).eq('staff_id', me.id).is('read_at', null),
    loadShiftStatus(service, me.id),
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
  if (developer) categories.push({ title: 'מצב מפתח', entries: [
    { href: '/staff/dev', icon: Beaker, label: 'כלי מפתח', description: 'בדיקת התראות, צ׳קליסטים ומשמרת בדיקה' },
    ...(fullLogin && isOp(me) ? [{ href: '/owner/dashboard', icon: LayoutDashboard, label: 'לוח הבקרה לניהול', description: 'צוות, סידור, צ׳קליסטים ותפריט' }] : []),
  ] })
  const name = me.first_name || me.display_name || 'צוות Sarcafe'
  const unread = count.count ?? 0
  const alerts = <DashboardNotifications initialNotifications={(updates.data ?? []) as DashboardNotification[]} initialUnread={unread} initialError={!!updates.error || !!count.error} scheduleHref={scheduleHref} googleSignedIn={fullLogin} manager={fullLogin && hasAnyMenuEditAccess(me)} />
  const date = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

  return (
    <main id="main" tabIndex={-1} className="app-page">
      <OwnerHeader title="Sarcafe צוות" homeHref="/staff" />
      <div className="app-welcome"><div><h2>שלום, {name}</h2><p>{date}</p></div></div>
      <ShiftStatusCard status={shiftStatus} scheduleHref={scheduleHref} developer={developer} />
      {/* Something waiting for the person comes before the set-up prompts; with nothing new the prompts go first. */}
      {unread > 0 && alerts}
      {!me.auth_user_id && <GoogleLinkPrompt />}
      <StaffPushCard />
      {unread === 0 && alerts}
      {/* Findable but quiet: after what needs attention, before the tool list. */}
      <WorkshopCard />
      <DashboardSections categories={categories} staff />
      <div className="app-group app-account"><Link href="/staff/profile" className="app-row app-row--quiet"><span className="app-row__icon"><UserRound size={22} aria-hidden="true" /></span><span className="app-row__copy"><strong>הפרופיל שלי</strong><small>פרטי חשבון, קוד כניסה והיסטוריה אישית</small></span><ChevronLeft size={18} className="app-row__chevron" aria-hidden="true" /></Link><InstallAppButton /></div>
    </main>
  )
}
