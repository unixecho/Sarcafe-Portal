import Link from 'next/link'
import { Beaker, CalendarClock, ChevronLeft, ClipboardCheck, ClipboardList, Receipt, ShoppingBag, UserRound, UsersRound } from 'lucide-react'
import DashboardSections, { type DashboardCategory } from '@/components/app/DashboardSections'
import StaffPushCard from '@/components/staff/StaffPushCard'
import ShiftStatusCard from '@/components/staff/ShiftStatusCard'
import GoogleLinkPrompt from '@/components/staff/GoogleLinkPrompt'
import WorkshopCard from '@/components/workshop/WorkshopCard'
import DashboardNotifications, { type DashboardNotification } from '@/components/app/DashboardNotifications'
import { loadShiftStatus } from '@/lib/staff/shift-status'
import { loadStaffTheme } from '@/lib/staff/theme-server'
import ThemeNudge from '@/components/staff/ThemeNudge'
import ThemeRow from '@/components/staff/ThemeRow'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { hasAnyMenuEditAccess, isOp } from '@/lib/staff/access'
import { getBranches } from '@/lib/branches/server'
import { branchChecklistBuilderPath } from '@/lib/checklists/links'
import { isDeveloper } from '@/lib/checklists/developer'
import { alertTitle } from '@/lib/push/staff-rules'
import type { StaffIdentity } from '@/lib/staff/session'

// The employee's dashboard BODY — everything under the header. Two pages show it: the employee home (/staff) and the
// developer's single dashboard (/staff/dev) as its "employee" view, so the developer sees exactly what staff see.
//
// Order (owner, 2026-10-17): updates and notifications → the shift card (the one door to the schedule and to the checklists,
// so there is no separate "my shift" list under it) → the coffee workshop → the rest → the person's own area. This is the
// APP sign-in (Google); a six-digit-code sign-in gets CodeDashboardView instead. No "add to Home Screen" row here: the
// notifications gate already makes the app live on the Home Screen before this page opens.
export default async function EmployeeDashboardView({ me }: { me: StaffIdentity }) {
  const fullLogin = me.via === 'google' && !me.quick
  const developer = isDeveloper(me)
  const scheduleHref = fullLogin ? '/staff/schedule' : '/login?next=/staff/schedule'
  const service = createServiceRoleClient()
  const [updates, count, shiftStatus, look] = await Promise.all([
    service.from('schedule_notifications').select('id, kind, title, body, link, created_at, read_at').eq('staff_id', me.id).order('created_at', { ascending: false }).limit(20),
    service.from('schedule_notifications').select('id', { count: 'exact', head: true }).eq('staff_id', me.id).is('read_at', null),
    loadShiftStatus(service, me.id),
    loadStaffTheme(me.id),
  ])
  // A general manager edits their own branch's checklists from here (the builder is per branch); an owner is sent to the branches.
  const ownBranch = fullLogin && me.branch_id ? (await getBranches()).find((branch) => branch.id === me.branch_id) ?? null : null
  const categories: DashboardCategory[] = [
    // Owner, 2026-10-16: for employees these two stay on the page but are not open yet. Managers keep their own (open) entries
    // under "ניהול במשמרת" and on the owner dashboard.
    { title: 'במהלך השירות', entries: [
      { icon: ShoppingBag, label: 'הזמנות מהירות', description: 'קבלת הזמנות ומעקב בזמן אמת', soon: 'בקרוב · בפיתוח' },
      { icon: Receipt, label: 'קופת אירועים ועמדות', description: 'הזמנות האירוע והעמדה שבה עובדים', soon: 'בפסטיבל הבא :)' },
    ] },
  ]
  if (fullLogin && hasAnyMenuEditAccess(me)) categories.push({ title: 'ניהול במשמרת', entries: [
    { href: '/owner/schedule', icon: CalendarClock, label: 'ניהול סידור העבודה', description: 'שיבוצים, אילוצים ואישור החלפות בסניף שלך' },
    { href: '/owner/issues', icon: ClipboardCheck, label: 'חוסרים ופערים', description: 'מה חסר, מה לא עובד ומה לא הוגש בסניף שלך' },
    ...(ownBranch
      ? [{ href: branchChecklistBuilderPath(ownBranch.slug, 'opening'), icon: ClipboardList, label: 'עריכת הצ׳קליסטים', description: `הטפסים של ${ownBranch.name.he}: שמות, קטגוריות ובדיקות` }]
      : isOp(me) ? [{ href: '/owner/branches', icon: ClipboardList, label: 'ניהול סניפים וצ׳קליסטים', description: 'לכל סניף הטפסים והצוות שלו' }] : []),
    { href: '/owner/editor', icon: ShoppingBag, label: 'ניהול התפריט', description: 'עריכת התפריט והזמינות בסניף שלך' },
    { href: '/owner/pos', icon: Receipt, label: 'ניהול קופת אירועים', description: 'כלי ניהול לאירועים שבאחריותך' },
  ] })
  const name = me.first_name || me.display_name || 'צוות Sarcafe'
  const unread = count.count ?? 0
  const notifications = ((updates.data ?? []) as DashboardNotification[]).map((row) => ({ ...row, title: alertTitle(row.kind ?? '', row.title, { developer }) }))
  const alerts = <DashboardNotifications initialNotifications={notifications} initialUnread={unread} initialError={!!updates.error || !!count.error} scheduleHref={scheduleHref} googleSignedIn={fullLogin} manager={fullLogin && hasAnyMenuEditAccess(me)} />
  const date = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

  return (
    <>
      <div className="app-welcome"><div><h2>שלום, <span className="app-welcome__name">{name}</span></h2><p>{date}</p></div></div>
      {/* The main door (owner, 2026-10-28): who is on shift right now at each branch, and the whole schedule behind it. */}
      <Link href={scheduleHref} className="app-main-link press">
        <span className="app-main-link__icon"><UsersRound size={26} aria-hidden="true" /></span>
        <span className="app-main-link__copy"><strong>מי במשמרת & משמרות</strong><small>מי עובד עכשיו בכל סניף, והלוח והאילוצים שלכם</small></span>
        <ChevronLeft size={20} className="app-main-link__chevron" aria-hidden="true" />
      </Link>
      {!me.auth_user_id && <GoogleLinkPrompt />}
      <StaffPushCard />
      {alerts}
      <ShiftStatusCard status={shiftStatus} scheduleHref={scheduleHref} developer={developer} />
      <WorkshopCard />
      <DashboardSections categories={categories} staff />
      <div className="app-group app-account">
        <ThemeRow theme={look.theme} chosen={look.chosen} />
        <Link href="/staff/profile" className="app-row app-row--quiet"><span className="app-row__icon"><UserRound size={22} aria-hidden="true" /></span><span className="app-row__copy"><strong>הפרופיל שלי</strong><small>פרטי חשבון, קוד כניסה והיסטוריה אישית</small></span><ChevronLeft size={18} className="app-row__chevron" aria-hidden="true" /></Link>
      </div>
      {developer && (
        <div className="app-group app-account">
          <Link href="/staff/dev" className="app-row app-row--quiet"><span className="app-row__icon"><Beaker size={21} aria-hidden="true" /></span><span className="app-row__copy"><strong>מצב מפתח</strong><small>בדיקות, בריאות המערכת וכלי מפתח</small></span><ChevronLeft size={18} className="app-row__chevron" aria-hidden="true" /></Link>
        </div>
      )}
      {/* First login without a look: told until they read it (ThemeNudge). */}
      {!look.chosen && !look.nudgeSeen && <ThemeNudge />}
    </>
  )
}
