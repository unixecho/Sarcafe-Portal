import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { Beaker, ClipboardCheck, ClipboardList, Users, Accessibility, History, Tablet, Link2, Star, MessageCircle, CalendarClock, Receipt, ShoppingBag, ShieldCheck } from 'lucide-react'
import OwnerHeader from '@/components/OwnerHeader'
import InstallAppButton from '@/components/app/InstallAppButton'
import DashboardLive from '@/components/DashboardLive'
import DashboardSections, { type DashboardCategory } from '@/components/app/DashboardSections'
import DashboardNotifications, { type DashboardNotification } from '@/components/app/DashboardNotifications'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'
import { readDashboardStats } from '@/lib/owner/dashboard-stats'
import { readDashboardSignals } from '@/lib/owner/signals'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'
import { isQuickSessionId, validatedSessionId } from '@/lib/pos/server/quick-login'
import { isChecklistDeveloper } from '@/lib/checklists/developer'

export const dynamic = 'force-dynamic'

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
        <DashboardNotifications scheduleHref="/login?next=/staff/schedule" />
        <DashboardSections staff categories={[
          { title: 'במשמרת', entries: [{ href: '/staff/checklists', icon: ClipboardCheck, label: 'צ׳קליסטים למשמרת', description: 'פתיחה, החלפה וסגירה' }, { href: '/pos', icon: Receipt, label: 'קופת אירועים', description: 'הזמנות ועמדות הכנה' }] },
          { title: 'החשבון שלי', entries: [{ href: '/staff/profile', icon: Users, label: 'הפרופיל שלי', description: 'פרטי חשבון וקוד כניסה' }, { href: '/login?next=/owner/dashboard', icon: ShieldCheck, label: 'כניסה לניהול עם Google', description: 'צוות, סידור עבודה ודיווחים' }] },
        ]} />
      </main>
    )
  }

  const branches = await getBranches({ includeEvents: true })
  const cookieStore = await cookies()
  const currentSlug = resolveCurrentBranchSlug(branches, cookieStore.get(BRANCH_COOKIE)?.value)
  const defaultBranch = branches.find((branch) => branch.slug === currentSlug) ?? branches[0] ?? null
  const [updates, updateCount] = await Promise.all([
    service.from('schedule_notifications').select('id, title, body, created_at, read_at').eq('staff_id', me!.id).order('created_at', { ascending: false }).limit(20),
    service.from('schedule_notifications').select('id', { count: 'exact', head: true }).eq('staff_id', me!.id).is('read_at', null),
  ])
  const [stats, signals, checklistIssues] = defaultBranch
    ? await Promise.all([
        readDashboardStats(defaultBranch.id),
        readDashboardSignals(defaultBranch.id),
        service.from('checklist_assignments').select('id', { count: 'exact', head: true }).eq('branch_id', defaultBranch.id).eq('status', 'submitted').gt('issue_count', 0).is('manager_resolved_at', null).then(({ count, error }) => error ? null : count ?? 0),
      ])
    : [{ hasUnpublishedChanges: { known: false, value: false }, outOfStockCount: { known: false, value: 0 }, categoryCount: { known: false, value: 0 } }, [], null]

  const categories: DashboardCategory[] = [
    { title: 'צוות ומשמרות', entries: [
      { href: '/owner/staff', icon: Users, label: 'העובדים שלי', description: 'קליטה, היסטוריה ותלושי שכר' },
      { href: '/owner/schedule', icon: CalendarClock, label: 'סידור עבודה', description: 'בקשות, שיבוצים ואישור החלפות' },
      { href: '/owner/checklists', icon: ClipboardCheck, label: 'צ׳קליסטים ודיווחים', description: 'מעקב משמרות, ליקויים ועריכת טפסים', badge: checklistIssues && checklistIssues > 0 ? `${checklistIssues} דיווחים דורשים טיפול` : undefined },
    ] },
    { title: 'שירות והזמנות', entries: [
      { href: '/staff/pos', icon: ShoppingBag, label: 'הזמנות מהירות', description: 'קבלת הזמנות ומעקב בזמן אמת' },
      { href: '/owner/pos', icon: Receipt, label: 'ניהול קופת אירועים', description: 'עמדות, הזמנות ופעילות באירוע' },
      { href: '/owner/tablet', icon: Tablet, label: 'זמינות פריטים', description: 'עדכון המלאי במהלך השירות' },
    ] },
    { title: 'תפריט וניהול העסק', entries: [
      { href: '/owner/editor', icon: ClipboardList, label: 'התפריט שלי', description: 'פריטים, מחירים ופרסום שינויים' },
      { href: '/owner/reviews', icon: Star, label: 'ביקורות', description: 'חוויות שהלקוחות משתפים' },
      { href: '/owner/feedback', icon: MessageCircle, label: 'משוב מלקוחות', description: 'הודעות והצעות לשיפור' },
      { href: '/owner/links', icon: Link2, label: 'קישורים ושיתוף', description: 'הפורטל, תפריטים וקודי QR' },
      { href: '/owner/audit', icon: History, label: 'יומן פעילות', description: 'שינויים שבוצעו במערכת' },
      { href: '/owner/accessibility', icon: Accessibility, label: 'נגישות', description: 'הצהרת הנגישות של העסק' },
    ] },
  ]
  const date = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  return (
    <main id="main" tabIndex={-1} className="app-page">
      <OwnerHeader title="לוח הבקרה" homeHref="/owner/dashboard" />
      <div className="app-welcome"><div><h2>שלום, {me?.first_name || 'Sarcafe'}</h2><p>כל מה שצריך כדי לנהל את היום שלך.</p></div><span className="app-date">{date}</span></div>
      <DashboardNotifications initialNotifications={(updates.data ?? []) as DashboardNotification[]} initialUnread={updateCount.count ?? 0} initialError={!!updates.error || !!updateCount.error} scheduleHref="/owner/schedule" />
      <DashboardLive branches={branches} initialBranch={defaultBranch?.slug ?? ''} initial={{ stats, signals }} />
      {checklistIssues === null && <p className="app-notifications__error" role="status">מצב הדיווחים אינו זמין כרגע. אפשר לפתוח את הצ׳קליסטים כדי לנסות שוב.</p>}
      <DashboardSections categories={categories} />
      <div className="app-group app-account"><InstallAppButton /></div>
      {isChecklistDeveloper(me?.email) && <div className="app-group app-account"><Link href="/staff/checklists" className="app-row app-row--quiet"><span className="app-row__icon"><Beaker size={21} aria-hidden="true" /></span><span className="app-row__copy"><strong>תצוגת הצ׳קליסט לעובד</strong><small>בדיקת חוויית המשמרת</small></span></Link></div>}
    </main>
  )
}