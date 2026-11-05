import { cookies } from 'next/headers'
import InstallAppButton from '@/components/app/InstallAppButton'
import { loadStaffTheme } from '@/lib/staff/theme-server'
import ThemeRow from '@/components/staff/ThemeRow'
import DashboardLive from '@/components/DashboardLive'
import StaffPushCard from '@/components/staff/StaffPushCard'
import WorkshopCard from '@/components/workshop/WorkshopCard'
import TeamMessage from '@/components/glass/TeamMessage'
import ToolFinder from '@/components/glass/tools/ToolFinder'
import { ToolShortcuts } from '@/components/glass/tools/ToolLists'
import DashboardSections, { type DashboardCategory } from '@/components/app/DashboardSections'
import { Accessibility, CalendarClock, ClipboardCheck, ClipboardList, History, Link2, MessageCircle, MonitorSmartphone, Receipt, ShoppingBag, Sparkles, Star, Tablet, UserPlus, Users } from 'lucide-react'
import { ToolsProvider } from '@/components/glass/tools/ToolsProvider'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { readDashboardStats } from '@/lib/owner/dashboard-stats'
import { readDashboardSignals } from '@/lib/owner/signals'
import { countPendingDecisions, toolBadges } from '@/lib/owner/dashboard-badges'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'
import { isDeveloper } from '@/lib/checklists/developer'
import { loadShortageReport } from '@/lib/checklists/issues-server'
import { shortageCount } from '@/lib/checklists/gaps'
import { wallClockNow } from '@/lib/shifts/time'
import { toolRolesFor } from '@/lib/tools'

export type OwnerMe = { id: string; role: string | null; badge: string | null; branch_id: string | null; email: string | null; first_name: string | null }

// The owner's dashboard BODY on glass (docs/SARCAFE_GLASS_UI.md). Two pages show it: /owner/dashboard and the developer's /staff/dev
// ("manager" view), so the developer sees exactly what an owner sees by construction. The page around it draws the glass top bar
// (branch switch, notifications, account) and the dock; the branch they switch is shared through <GlassBranchProvider>.
//
// The order is the order of attention: hello → the shortcuts this person uses most → the day's numbers and what needs attention →
// the team message → phone alerts → everything else, searchable.
export default async function OwnerDashboardView({ me }: { me: OwnerMe }) {
  const service = createServiceRoleClient()
  // Coffee trucks only: an event's register is a subsystem of its truck (branch manager > קופה ואירועים), not a branch of the business.
  const branches = await getBranches()
  const cookieStore = await cookies()
  const currentSlug = resolveCurrentBranchSlug(branches, cookieStore.get(BRANCH_COOKIE)?.value)
  const defaultBranch = branches.find((branch) => branch.slug === currentSlug) ?? branches[0] ?? null
  const developer = isDeveloper(me)
  const look = await loadStaffTheme(me.id)
  const [stats, signals, shortages, requests] = defaultBranch
    ? await Promise.all([
        readDashboardStats(defaultBranch.id),
        readDashboardSignals(defaultBranch.id),
        // Everything the checklists say needs attention right now: broken or missing things (one per check) plus checklists nobody sent.
        loadShortageReport(service, defaultBranch.id).then((report) => shortageCount(report)).catch(() => null),
        countPendingDecisions(service, defaultBranch.id).catch(() => null),
      ])
    : [{ hasUnpublishedChanges: { known: false, value: false }, outOfStockCount: { known: false, value: 0 }, categoryCount: { known: false, value: 0 } }, [], null, null] as const

  // The owner's tool lists, unchanged (the order of attention the owner set).
  const categories: DashboardCategory[] = [
    { title: 'הצוות והמשמרות', entries: [
      { href: '/owner/staff', icon: Users, label: 'העובדים שלי', description: 'קליטה, קישורי הצטרפות, היסטוריה ותלושי שכר' },
      { href: '/owner/schedule', icon: CalendarClock, label: 'סידור עבודה', description: 'אילוצים, שיבוצים ואישור החלפות' },
      { href: '/owner/checklists', icon: ClipboardCheck, label: 'צ׳קליסטים', description: 'מעקב משמרות ודיווחים. הטפסים עצמם בניהול הסניף' },
    ] },
    { title: 'שירות והזמנות', entries: [
      { href: '/staff/pos', icon: ShoppingBag, label: 'הזמנות מהירות', description: 'קבלת הזמנות ומעקב בזמן אמת' },
      { href: '/owner/pos', icon: Receipt, label: 'ניהול קופת אירועים', description: 'עמדות, הזמנות ופעילות באירוע' },
      { href: '/owner/tablet', icon: Tablet, label: 'זמינות פריטים', description: 'עדכון המלאי במהלך השירות' },
    ] },
    { title: 'תפריט והעסק', entries: [
      { href: '/owner/editor', icon: ClipboardList, label: 'התפריט שלי', description: 'פריטים, מחירים ופרסום שינויים' },
      { href: '/owner/reviews', icon: Star, label: 'ביקורות', description: 'חוויות שהלקוחות משתפים' },
      { href: '/owner/feedback', icon: MessageCircle, label: 'משוב מלקוחות', description: 'הודעות והצעות לשיפור' },
      { href: '/owner/waitlist', icon: UserPlus, label: 'נרשמים למועדון', description: 'מי נרשם בקיוסק, בהסכמתו, לרשימת המתעניינים' },
      { href: '/owner/kiosk', icon: MonitorSmartphone, label: 'תוכן הקיוסק', description: 'הכרטיסים, הזמנים, ימים חריגים ותוצאות ההצבעה' },
      { href: '/owner/links', icon: Link2, label: 'קישורים ושיתוף', description: 'הפורטל, תפריטים וקודי QR' },
      { href: '/owner/audit', icon: History, label: 'יומן פעילות', description: 'שינויים שבוצעו במערכת' },
      { href: '/owner/intro', icon: Sparkles, label: 'מסך פתיחה', description: 'הדלקה וכיבוי, והשורות שמופיעות' },
      { href: '/owner/accessibility', icon: Accessibility, label: 'נגישות', description: 'הצהרת הנגישות של העסק' },
    ] },
  ]
  const date = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  const hour = Number(wallClockNow('Asia/Jerusalem').time.slice(0, 2))
  const roles = toolRolesFor({ op: true, manager: true, developer })
  const badges = toolBadges({ stats, shortages, requests })
  const messageable = branches.map((b) => ({ slug: b.slug, name: b.name.he }))

  return (
    <ToolsProvider staffId={me.id} roles={roles} hour={hour} badges={badges} home="/owner/dashboard">
      <section className="gl-welcome">
        <div><h2>שלום, {me.first_name || 'Sarcafe'}</h2><p>כל מה שצריך כדי לנהל את היום שלך.</p></div>
        <span className="gl-welcome__date">{date}</span>
      </section>
      <ToolShortcuts />
      {defaultBranch && <DashboardLive branches={branches} initialBranch={defaultBranch.slug} initial={{ stats, signals: [...signals], shortages, requests }} />}
      {messageable.length > 0 && <TeamMessage branches={messageable} />}
      <StaffPushCard />
      <WorkshopCard />
      <ToolFinder />
      <div data-track-tools><DashboardSections categories={categories} /></div>
      <div className="app-group app-account">
        <ThemeRow theme={look.theme} chosen={look.chosen} />
        <InstallAppButton />
      </div>
    </ToolsProvider>
  )
}
