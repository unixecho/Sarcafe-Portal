import Link from 'next/link'
import { Beaker, CalendarClock, ChevronLeft, ClipboardCheck, ClipboardList, Receipt, ShoppingBag, UserRound, UsersRound } from 'lucide-react'
import DashboardSections, { type DashboardCategory } from '@/components/app/DashboardSections'
import StaffPushCard from '@/components/staff/StaffPushCard'
import ShiftStatusCard from '@/components/staff/ShiftStatusCard'
import GoogleLinkPrompt from '@/components/staff/GoogleLinkPrompt'
import WorkshopCard from '@/components/workshop/WorkshopCard'
import ThemeNudge from '@/components/staff/ThemeNudge'
import ThemeRow from '@/components/staff/ThemeRow'
import TeamMessage from '@/components/glass/TeamMessage'
import ToolFinder from '@/components/glass/tools/ToolFinder'
import { ToolShortcuts } from '@/components/glass/tools/ToolLists'
import { ToolsProvider } from '@/components/glass/tools/ToolsProvider'
import { loadShiftStatus } from '@/lib/staff/shift-status'
import { loadStaffTheme } from '@/lib/staff/theme-server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { hasAnyMenuEditAccess, isOp } from '@/lib/staff/access'
import { getBranches } from '@/lib/branches/server'
import { branchChecklistBuilderPath } from '@/lib/checklists/links'
import { isDeveloper } from '@/lib/checklists/developer'
import { wallClockNow } from '@/lib/shifts/time'
import { toolRolesFor } from '@/lib/tools'
import { messageableBranches } from '@/lib/team-message/server'
import type { StaffIdentity } from '@/lib/staff/session'

// The employee's dashboard BODY on glass (docs/SARCAFE_GLASS_UI.md). Two pages show it: the employee home (/staff) and the developer's
// /staff/dev ("employee" view). The page around it draws the glass top bar (notifications live in its bell now) and the dock.
//
// Order (owner, 2026-10-17, kept): the main door to the schedule → phone alerts → the shift card (the one door to the schedule and the
// checklists) → the person's shortcuts → the coffee workshop → the rest → the person's own area. A general manager also gets the
// team message for their branch. This is the APP sign-in (Google); a six-digit-code sign-in gets CodeDashboardView instead.
export default async function EmployeeDashboardView({ me }: { me: StaffIdentity }) {
  const fullLogin = me.via === 'google' && !me.quick
  const developer = isDeveloper(me)
  const manager = fullLogin && hasAnyMenuEditAccess(me)
  const scheduleHref = fullLogin ? '/staff/schedule' : '/login?next=/staff/schedule'
  const service = createServiceRoleClient()
  const [shiftStatus, look, messageable, branches] = await Promise.all([
    loadShiftStatus(service, me.id),
    loadStaffTheme(me.id),
    manager ? messageableBranches(service, me).catch(() => []) : Promise.resolve([]),
    fullLogin && me.branch_id ? getBranches() : Promise.resolve([]),
  ])
  // A general manager edits their own branch's checklists from here (the builder is per branch); an owner is sent to the branches.
  const ownBranch = fullLogin && me.branch_id ? branches.find((branch) => branch.id === me.branch_id) ?? null : null
  // The lists below are the owner's decisions (2026-10-16/17): no separate "my shift" list (the shift card is the one door to the
  // schedule and the checklists); the two service tools stay on the page but are not open yet; managers keep their own tools.
  const categories: DashboardCategory[] = [
    { title: 'במהלך השירות', entries: [
      { icon: ShoppingBag, label: 'הזמנות מהירות', description: 'קבלת הזמנות ומעקב בזמן אמת', soon: 'בקרוב · בפיתוח' },
      { icon: Receipt, label: 'קופת אירועים ועמדות', description: 'הזמנות האירוע והעמדה שבה עובדים', soon: 'בפסטיבל הבא :)' },
    ] },
  ]
  if (manager) categories.push({ title: 'ניהול במשמרת', entries: [
    { href: '/owner/schedule', icon: CalendarClock, label: 'ניהול סידור העבודה', description: 'שיבוצים, אילוצים ואישור החלפות בסניף שלך' },
    { href: '/owner/issues', icon: ClipboardCheck, label: 'חוסרים ופערים', description: 'מה חסר, מה לא עובד ומה לא הוגש בסניף שלך' },
    ...(ownBranch
      ? [{ href: branchChecklistBuilderPath(ownBranch.slug, 'opening'), icon: ClipboardList, label: 'עריכת הצ׳קליסטים', description: `הטפסים של ${ownBranch.name.he}: שמות, קטגוריות ובדיקות` }]
      : isOp(me) ? [{ href: '/owner/branches', icon: ClipboardList, label: 'ניהול סניפים וצ׳קליסטים', description: 'לכל סניף הטפסים והצוות שלו' }] : []),
    { href: '/owner/editor', icon: ShoppingBag, label: 'ניהול התפריט', description: 'עריכת התפריט והזמינות בסניף שלך' },
    { href: '/owner/pos', icon: Receipt, label: 'ניהול קופת אירועים', description: 'כלי ניהול לאירועים שבאחריותך' },
  ] })
  const name = me.first_name || me.display_name || 'צוות Sarcafe'
  const date = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  const hour = Number(wallClockNow('Asia/Jerusalem').time.slice(0, 2))
  const roles = toolRolesFor({ op: false, manager, developer })

  return (
    <ToolsProvider staffId={me.id} roles={roles} hour={hour} home="/staff">
      <section className="gl-welcome"><div><h2>שלום, <span className="app-welcome__name">{name}</span></h2><p>{date}</p></div></section>
      {/* The main door (owner, 2026-10-28): who is on shift right now at each branch, and the whole schedule behind it. */}
      <Link href={scheduleHref} className="gl-surf gl-row-card gl-row-card--main">
        <span className="gl-ico" aria-hidden="true"><UsersRound size={26} /></span>
        <span className="gl-row-card__copy"><strong>מי במשמרת &amp; משמרות</strong><small>מי עובד עכשיו בכל סניף, והלוח והאילוצים שלכם</small></span>
        <ChevronLeft size={20} className="gl-chev" aria-hidden="true" />
      </Link>
      {!me.auth_user_id && <GoogleLinkPrompt />}
      <StaffPushCard />
      <ShiftStatusCard status={shiftStatus} scheduleHref={scheduleHref} developer={developer} />
      <ToolShortcuts />
      {manager && messageable.length > 0 && <TeamMessage branches={messageable} />}
      <WorkshopCard />
      <ToolFinder />
      <div data-track-tools><DashboardSections categories={categories} staff /></div>
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
    </ToolsProvider>
  )
}
