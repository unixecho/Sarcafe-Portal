import { redirect } from 'next/navigation'
import { Beaker, ClipboardCheck, ExternalLink, GitBranch, Database, Triangle } from 'lucide-react'
import GlassDashboardShell from '@/components/glass/GlassDashboardShell'
import DashboardSections, { type DashboardCategory } from '@/components/app/DashboardSections'
import DevPushPanel from '@/components/staff/DevPushPanel'
import DevNotificationCenter from '@/components/staff/DevNotificationCenter'
import LensTabs from '@/components/dashboard/LensTabs'
import ToolFinder from '@/components/glass/tools/ToolFinder'
import { ToolGroups } from '@/components/glass/tools/ToolLists'
import { ToolsProvider } from '@/components/glass/tools/ToolsProvider'
import { HOME_TOOL_GROUPS, toolRolesFor } from '@/lib/tools'
import { loadQaPage } from '@/lib/qa/server'
import { passRate } from '@/lib/qa/report'
import { wallClockNow } from '@/lib/shifts/time'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import OwnerDashboardView from '@/components/dashboard/OwnerDashboardView'
import EmployeeDashboardView from '@/components/dashboard/EmployeeDashboardView'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { isDeveloper } from '@/lib/checklists/developer'
import { isOp } from '@/lib/staff/access'
import { lensesFor, parseLens } from '@/lib/dashboard/lens'
import { readDevHealth, type HealthRow } from '@/lib/owner/dev-health'
import { loadDevCentre } from '@/lib/push/dev-centre'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { AUDIENCE_PREFIX } from '@/lib/push/staff-rules'
import { badgeLabel } from '@/lib/staff/badges'
import '@/components/app/app.css'

export const dynamic = 'force-dynamic'

// The developer's dashboard — ONE place with all the views (owner, 2026-10-16: "make the dev panel just like Ayeka Bar's"):
//
//   מנהל   — exactly the owner's dashboard (components/dashboard/OwnerDashboardView.tsx)
//   עובד   — exactly what staff see (components/dashboard/EmployeeDashboardView.tsx), including the test-shift card
//   מפתח   — the developer's own tools: system health, the alert test bench, test checklists, and the reference links
//   התראות — the developer's own notification centre: the one inbox sorted into three containers (system, management,
//            the person as an employee), each alert opening the thing it is about
//
// The first two are the SAME components the owner and employee pages render, so the developer sees what those people see
// by construction. /owner/dashboard and /staff send a developer here (?view=manager / ?view=employee), so there is no
// second place to be. The view is `?view=` (default: the developer's tools). Not linked from anywhere an employee can
// see; this check is server-side and the APIs behind the panels check the developer again.

const STATE_LABEL: Record<HealthRow['state'], string> = { ok: 'תקין', warn: 'דורש טיפול', bad: 'תקלה', info: 'מידע' }
const SUPABASE_URL = 'https://supabase.com/dashboard/project/moiunkugxgsgbdokaxbr'
const REFERENCE: { href: string; label: string; hint: string; Icon: typeof Database }[] = [
  { href: SUPABASE_URL, label: 'Supabase', hint: 'מסד הנתונים, ה-SQL editor והלוגים', Icon: Database },
  { href: 'https://vercel.com/dashboard', label: 'Vercel', hint: 'פריסות ולוגים', Icon: Triangle },
  { href: 'https://github.com/unixecho/Sarcafe-Portal', label: 'GitHub', hint: 'unixecho/Sarcafe-Portal', Icon: GitBranch },
]

export default async function StaffDevPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const me = await resolveStaffIdentity()
  if (!me) redirect('/login?next=/staff/dev&quick=1')
  if (!isDeveloper(me)) redirect('/staff')
  const fullLogin = me.via === 'google' && !me.quick
  const canManage = fullLogin && isOp(me)
  const lenses = lensesFor(canManage)
  const initial = parseLens((await searchParams).view)
  const view = lenses.some((l) => l.id === initial) ? initial : 'dev'

  // All three views are built on the server, in parallel, and handed to the switcher: switching is then instant (nothing to fetch)
  // and only the one on screen is mounted. The same arrangement as the Ayeka Bar developer dashboard.
  const health = await readDevHealth()
  const centre = await loadDevCentre(createServiceRoleClient(), me.id).catch(() => ({ rows: [], unread: { developer: 0, owner: 0, employee: 0 } }))
  const problems = health.filter((row) => row.state === 'bad' || row.state === 'warn').length
  const panels: Parameters<typeof LensTabs>[0]['panels'] = {
    employee: <EmployeeDashboardView me={me} />,
    dev: DevPanel({ health, qa: await loadQaPage().catch(() => null), staffId: me.id, canManage }),
    alerts: <DevNotificationCenter initial={centre} health={{ problems }} />,
    ...(canManage ? { manager: <OwnerDashboardView me={{ id: me.id, role: me.role ?? null, badge: me.badge ?? null, branch_id: me.branch_id ?? null, email: me.email, first_name: me.first_name }} /> } : {}),
  }

  // The glass dashboard (docs/SARCAFE_GLASS_UI.md). A developer who is also an owner gets the branch switch and the manager's dock.
  return (
    <GlassDashboardShell title="לוח מפתח" dock={canManage ? 'manager' : 'employee'} home="/staff/dev" account={{ developer: true, manager: canManage }} branchSwitch={canManage}>
      <div className="lens-greeting">
        <strong>{me.first_name || me.display_name || 'מפתח'}</strong>
        <span className="lens-badge">{badgeLabel(me.badge) || 'מפתח/ת'}</span>
      </div>
      <LensTabs initial={view} lenses={lenses} panels={panels} badges={{ alerts: centre.unread.developer + centre.unread.owner + centre.unread.employee }} />
    </GlassDashboardShell>
  )
}

function DevPanel({ health, qa, staffId, canManage }: { health: HealthRow[]; qa: Awaited<ReturnType<typeof loadQaPage>> | null; staffId: string; canManage: boolean }) {
  const report = qa?.latest
  const qaTone = report ? (report.status === 'pass' ? 'ok' : report.status === 'fail' ? 'bad' : '') : ''
  const hour = Number(wallClockNow('Asia/Jerusalem').time.slice(0, 2))
  const categories: DashboardCategory[] = [
    { title: 'צ׳קליסט לבדיקה (לא נשמר)', entries: [
      { href: '/staff/checklists?preview=opening', icon: ClipboardCheck, label: 'פתיחת משמרת', description: 'עוברים על הטופס כמו עובד, בלי שיוך למשמרת' },
      { href: '/staff/checklists?preview=handover', icon: ClipboardCheck, label: 'החלפת משמרת', description: 'הטופס שמעביר את המשמרת לעובד הבא' },
      { href: '/staff/checklists?preview=closing', icon: ClipboardCheck, label: 'סגירת משמרת', description: 'סיום היום, כולל סכום הקופה' },
    ] },
  ]
  return (
    <ToolsProvider staffId={staffId} roles={toolRolesFor({ op: canManage, manager: canManage, developer: true })} hour={hour} home="/staff/dev">
      {/* The morning QA review (docs/QA_BLUEPRINT.md): the newest automatic run, one tap to the full review. */}
      <Link href="/staff/dev/qa" className={`gl-surf gl-row-card${qaTone ? ` gl-surf--${qaTone}` : ''}`}>
        <span className={`gl-ico${qaTone ? ` gl-ico--${qaTone}` : ''}`} aria-hidden="true"><ClipboardCheck size={22} /></span>
        <span className="gl-row-card__copy">
          <strong>סקירת QA של הבוקר</strong>
          <small>{report && report.totals.tests > 0 ? `${report.review.headline} · ${passRate(report.totals)}% עברו (${report.totals.passed}/${report.totals.tests - report.totals.skipped})` : 'עוד אין דוח. הבדיקות רצות כל בוקר ואחרי כל פרסום'}</small>
        </span>
        <ChevronLeft size={18} className="gl-chev" aria-hidden="true" />
      </Link>
      <section aria-labelledby="dev-health" className="dev-card rise">
        <h2 id="dev-health">בריאות המערכת</h2>
        <p>נבדק בכל טעינה. מיגרציות נבדקות לפי האובייקטים שהן יוצרות, לא לפי רשימת המיגרציות של Supabase.</p>
        <ul className="dev-health">
          {health.map((row) => (
            <li key={row.id}>
              <span aria-hidden="true" className={`dev-health__dot dev-health__dot--${row.state}`} />
              <span><strong>{row.label} <span className="sr-only">— {STATE_LABEL[row.state]}</span></strong><small>{row.detail}</small></span>
            </li>
          ))}
        </ul>
      </section>

      <DevPushPanel />

      <section className="dev-card rise" aria-labelledby="dev-legend">
        <h2 id="dev-legend">איך מזהים של מי ההתראה</h2>
        <p>בחשבון הזה מגיעות כל ההתראות: של עובד, של בעלים ושל מפתח. בלשונית ״התראות״ הן מחולקות לשלושה מכלים, וכל התראה נפתחת במקום שהיא עוסקת בו. במסכי העובד והמנהל התראה של בעלים או של מפתח נפתחת עם הסימון שלה. אצל בעלים ואצל עובדים אין שום סימון.</p>
        <div className="dev-legend">
          <span><b>{AUDIENCE_PREFIX.developer.trim()}</b>התראות מערכת ובדיקות (גם כל התראת בדיקה מהלוח הזה)</span>
          <span><b>{AUDIENCE_PREFIX.owner.trim()}</b>דוח חוסרים ופערים, צ׳קליסט שלא הוגש, אילוצים ובקשות שמחכות להחלטה</span>
          <span><b>בלי סימון</b>המשמרות והצ׳קליסטים שלך כעובד/ת</span>
        </div>
      </section>

      <DashboardSections categories={categories} staff />

      <section className="app-section" aria-label="קישורים">
        <div className="app-section__heading"><h2>קישורים</h2></div>
        <div className="app-group">
          {REFERENCE.map(({ href, label, hint, Icon }) => (
            <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="app-row">
              <span className="app-row__icon"><Icon size={21} aria-hidden="true" /></span>
              <span className="app-row__copy"><strong>{label}</strong><small>{hint}</small></span>
              <ExternalLink size={16} className="app-row__chevron" aria-hidden="true" />
            </a>
          ))}
        </div>
      </section>
      <section className="gl-field" style={{ gap: 14 }} aria-label="כלי מפתח">
        <ToolFinder placeholder="חיפוש בכל הכלים…" />
        <ToolGroups groups={HOME_TOOL_GROUPS.dev} />
      </section>
      <p className="sch-sub" style={{ textAlign: 'center', margin: '18px 0 0' }}><Beaker size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> גרסת מערכת: {process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'מקומית'}</p>
    </ToolsProvider>
  )
}
