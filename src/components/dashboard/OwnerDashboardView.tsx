import { cookies } from 'next/headers'
import Link from 'next/link'
import { AlertTriangle, Accessibility, Building2, CalendarClock, CheckCircle2, ChevronLeft, ClipboardCheck, ClipboardList, History, Link2, MessageCircle, Receipt, ShoppingBag, Sparkles, Star, Tablet, Users, Wrench } from 'lucide-react'
import InstallAppButton from '@/components/app/InstallAppButton'
import { loadStaffTheme } from '@/lib/staff/theme-server'
import ThemeRow from '@/components/staff/ThemeRow'
import DashboardLive from '@/components/DashboardLive'
import DashboardSections, { type DashboardCategory } from '@/components/app/DashboardSections'
import StaffPushCard from '@/components/staff/StaffPushCard'
import WorkshopCard from '@/components/workshop/WorkshopCard'
import DashboardNotifications, { type DashboardNotification } from '@/components/app/DashboardNotifications'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { readDashboardStats } from '@/lib/owner/dashboard-stats'
import { readDashboardSignals } from '@/lib/owner/signals'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'
import { isDeveloper } from '@/lib/checklists/developer'
import { loadShortageReport } from '@/lib/checklists/issues-server'
import { shortageCount } from '@/lib/checklists/gaps'
import { alertTitle } from '@/lib/push/staff-rules'

export type OwnerMe = { id: string; role: string | null; badge: string | null; branch_id: string | null; email: string | null; first_name: string | null }

// The owner's dashboard BODY — everything under the header. It lives here (2026-10-16) because two pages show it: the
// owner's own /owner/dashboard, and the developer's single dashboard (/staff/dev) as its "manager" view, so the
// developer sees exactly what an owner sees by construction rather than by two pages kept in step.
//
// The order is the order of attention: what is waiting (alerts) → how the day is going (the pulse and signals) → the two
// things an owner opens most (חוסרים ופערים, ניהול סניפים) → the phone alerts card → everything else, by topic.
export default async function OwnerDashboardView({ me }: { me: OwnerMe }) {
  const service = createServiceRoleClient()
  // Coffee trucks only: an event's register is a subsystem of its truck (branch manager > קופה ואירועים), not a branch of the business.
  const branches = await getBranches()
  const cookieStore = await cookies()
  const currentSlug = resolveCurrentBranchSlug(branches, cookieStore.get(BRANCH_COOKIE)?.value)
  const defaultBranch = branches.find((branch) => branch.slug === currentSlug) ?? branches[0] ?? null
  const developer = isDeveloper(me)
  // The look (src/lib/staff/theme.ts) is one choice for the whole panel: the owner picks it in the profile, like everyone.
  const look = await loadStaffTheme(me.id)
  const [updates, updateCount] = await Promise.all([
    service.from('schedule_notifications').select('id, kind, title, body, link, created_at, read_at').eq('staff_id', me.id).order('created_at', { ascending: false }).limit(20),
    service.from('schedule_notifications').select('id', { count: 'exact', head: true }).eq('staff_id', me.id).is('read_at', null),
  ])
  const [stats, signals, shortages] = defaultBranch
    ? await Promise.all([
        readDashboardStats(defaultBranch.id),
        readDashboardSignals(defaultBranch.id),
        // Everything the checklists say needs attention right now: broken or missing things (one per check) plus checklists nobody sent.
        loadShortageReport(service, defaultBranch.id).then((report) => shortageCount(report)).catch(() => null),
      ])
    : [{ hasUnpublishedChanges: { known: false, value: false }, outOfStockCount: { known: false, value: 0 }, categoryCount: { known: false, value: 0 } }, [], null]

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
      { href: '/owner/links', icon: Link2, label: 'קישורים ושיתוף', description: 'הפורטל, תפריטים וקודי QR' },
      { href: '/owner/audit', icon: History, label: 'יומן פעילות', description: 'שינויים שבוצעו במערכת' },
      { href: '/owner/intro', icon: Sparkles, label: 'מסך פתיחה', description: 'הדלקה וכיבוי, והשורות שמופיעות' },
      { href: '/owner/accessibility', icon: Accessibility, label: 'נגישות', description: 'הצהרת הנגישות של העסק' },
    ] },
  ]
  const date = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  const issuesHref = `/owner/issues${defaultBranch ? `?branch=${defaultBranch.slug}` : ''}`
  const notifications = ((updates.data ?? []) as DashboardNotification[]).map((row) => ({ ...row, title: alertTitle(row.kind ?? '', row.title, { developer }) }))

  return (
    <>
      <div className="app-welcome"><div><h2>שלום, {me.first_name || 'Sarcafe'}</h2><p>כל מה שצריך כדי לנהל את היום שלך.</p></div><span className="app-date">{date}</span></div>
      <DashboardNotifications initialNotifications={notifications} initialUnread={updateCount.count ?? 0} initialError={!!updates.error || !!updateCount.error} scheduleHref="/owner/schedule" manager />
      <DashboardLive branches={branches} initialBranch={defaultBranch?.slug ?? ''} initial={{ stats, signals }} />

      <section className="app-attention" aria-label="הכי חשוב עכשיו">
        <Link href={issuesHref} className={`app-attention__card press${shortages ? ' app-attention__card--warn' : ''}`}>
          <span className="app-attention__icon" aria-hidden="true">{shortages ? <AlertTriangle size={22} /> : shortages === 0 ? <CheckCircle2 size={22} /> : <Wrench size={22} />}</span>
          <span className="app-attention__copy">
            <strong>חוסרים ופערים</strong>
            <small>{shortages === null ? 'לא זמין כרגע. לחצו לנסות שוב' : shortages === 0 ? 'הכול בסדר, אין מה לטפל' : shortages === 1 ? 'דבר אחד לטיפול' : `${shortages} דברים לטיפול`}</small>
          </span>
          <ChevronLeft size={18} aria-hidden="true" className="app-row__chevron" />
        </Link>
        <Link href="/owner/branches" className="app-attention__card press">
          <span className="app-attention__icon" aria-hidden="true"><Building2 size={22} /></span>
          <span className="app-attention__copy">
            <strong>ניהול סניפים</strong>
            <small>{branches.length === 1 ? 'הגדרות, צ׳קליסטים וצוות' : `${branches.length} סניפים: הגדרות, צ׳קליסטים וצוות`}</small>
          </span>
          <ChevronLeft size={18} aria-hidden="true" className="app-row__chevron" />
        </Link>
      </section>

      <StaffPushCard />
      <WorkshopCard />
      <DashboardSections categories={categories} />
      <div className="app-group app-account">
        <ThemeRow theme={look.theme} chosen={look.chosen} />
        <InstallAppButton />
      </div>
    </>
  )
}
