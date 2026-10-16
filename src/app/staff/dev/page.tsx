import { redirect } from 'next/navigation'
import { Beaker, ClipboardCheck, ExternalLink, GitBranch, Database, Triangle } from 'lucide-react'
import OwnerHeader from '@/components/OwnerHeader'
import DashboardSections, { type DashboardCategory } from '@/components/app/DashboardSections'
import DevPushPanel from '@/components/staff/DevPushPanel'
import LensTabs from '@/components/dashboard/LensTabs'
import OwnerDashboardView from '@/components/dashboard/OwnerDashboardView'
import EmployeeDashboardView from '@/components/dashboard/EmployeeDashboardView'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { isDeveloper } from '@/lib/checklists/developer'
import { isOp } from '@/lib/staff/access'
import { lensesFor, parseLens } from '@/lib/dashboard/lens'
import { readDevHealth, type HealthRow } from '@/lib/owner/dev-health'
import { AUDIENCE_PREFIX } from '@/lib/push/staff-rules'
import { badgeLabel } from '@/lib/staff/badges'
import '@/components/app/app.css'

export const dynamic = 'force-dynamic'

// The developer's dashboard — ONE place with all three views (owner, 2026-10-16: "make the dev panel just like Ayeka Bar's"):
//
//   מנהל   — exactly the owner's dashboard (components/dashboard/OwnerDashboardView.tsx)
//   עובד   — exactly what staff see (components/dashboard/EmployeeDashboardView.tsx), including the test-shift card
//   מפתח   — the developer's own tools: system health, the alert test bench, test checklists, and the reference links
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
  const panels: Parameters<typeof LensTabs>[0]['panels'] = {
    employee: <EmployeeDashboardView me={me} />,
    dev: await DevPanel(),
    ...(canManage ? { manager: <OwnerDashboardView me={{ id: me.id, role: me.role ?? null, badge: me.badge ?? null, branch_id: me.branch_id ?? null, email: me.email, first_name: me.first_name }} /> } : {}),
  }

  return (
    <main id="main" tabIndex={-1} className="app-page">
      <OwnerHeader title="לוח מפתח" homeHref="/staff/dev" />
      <div className="lens-greeting">
        <strong>{me.first_name || me.display_name || 'מפתח'}</strong>
        <span className="lens-badge">{badgeLabel(me.badge) || 'מפתח/ת'}</span>
      </div>
      <LensTabs initial={view} lenses={lenses} panels={panels} />
    </main>
  )
}

async function DevPanel() {
  const health = await readDevHealth()
  const categories: DashboardCategory[] = [
    { title: 'צ׳קליסט לבדיקה (לא נשמר)', entries: [
      { href: '/staff/checklists?preview=opening', icon: ClipboardCheck, label: 'פתיחת משמרת', description: 'עוברים על הטופס כמו עובד, בלי שיוך למשמרת' },
      { href: '/staff/checklists?preview=handover', icon: ClipboardCheck, label: 'החלפת משמרת', description: 'הטופס שמעביר את המשמרת לעובד הבא' },
      { href: '/staff/checklists?preview=closing', icon: ClipboardCheck, label: 'סגירת משמרת', description: 'סיום היום, כולל סכום הקופה' },
    ] },
  ]
  return (
    <>
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
        <p>בחשבון הזה מגיעות כל ההתראות: של עובד, של בעלים ושל מפתח. התראה שמיועדת לבעלים או למפתח נפתחת עם הסימון שלה. אצל בעלים ואצל עובדים אין שום סימון.</p>
        <div className="dev-legend">
          <span><b>{AUDIENCE_PREFIX.developer.trim()}</b>התראות מערכת ובדיקות</span>
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
      <p className="sch-sub" style={{ textAlign: 'center', margin: '18px 0 0' }}><Beaker size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> גרסת מערכת: {process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'מקומית'}</p>
    </>
  )
}
