import { redirect } from 'next/navigation'
import { Beaker, ClipboardCheck, LayoutDashboard, UserRound } from 'lucide-react'
import OwnerHeader from '@/components/OwnerHeader'
import DashboardSections, { type DashboardCategory } from '@/components/app/DashboardSections'
import DevPushPanel from '@/components/staff/DevPushPanel'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { isDeveloper } from '@/lib/checklists/developer'
import { isOp } from '@/lib/staff/access'

export const dynamic = 'force-dynamic'

// The developer's own corner. Everything that is a test tool lives here, so the rest of the panel can be used
// exactly like an employee uses it. Not linked from anywhere an employee can see; the check is server-side and
// the APIs behind the panels check the developer again.
export default async function StaffDevPage() {
  const me = await resolveStaffIdentity()
  if (!me) redirect('/login?next=/staff&quick=1')
  if (!isDeveloper(me)) redirect('/staff')
  const fullLogin = me.via === 'google' && !me.quick

  const categories: DashboardCategory[] = [
    { title: 'צ׳קליסט לבדיקה (לא נשמר)', entries: [
      { href: '/staff/checklists?preview=opening', icon: ClipboardCheck, label: 'פתיחת משמרת', description: 'עוברים על הטופס כמו עובד, בלי שיוך למשמרת' },
      { href: '/staff/checklists?preview=handover', icon: ClipboardCheck, label: 'החלפת משמרת', description: 'הטופס שמעביר את המשמרת לעובד הבא' },
      { href: '/staff/checklists?preview=closing', icon: ClipboardCheck, label: 'סגירת משמרת', description: 'סיום היום, כולל סכום הקופה' },
    ] },
    { title: 'מעבר מהיר', entries: [
      { href: '/staff', icon: UserRound, label: 'הפאנל כמו שעובד רואה אותו', description: 'כרטיס המשמרת, כפתור הצ׳קליסט וההתראות' },
      ...(fullLogin && isOp(me) ? [{ href: '/owner/dashboard', icon: LayoutDashboard, label: 'לוח הבקרה לניהול', description: 'צוות, סידור, צ׳קליסטים ותפריט' }] : []),
    ] },
  ]

  return (
    <main id="main" tabIndex={-1} className="app-page">
      <OwnerHeader title="מצב מפתח" backHref="/staff" homeHref="/staff" />
      <section className="app-hero">
        <h2><Beaker size={20} aria-hidden="true" style={{ verticalAlign: '-3px', marginInlineEnd: 8 }} />כלי מפתח</h2>
        <p>את הפאנל עצמו חווים כמו עובד: כרטיס המשמרת בדף הבית מציע כניסה למשמרת בדיקה כשאין לכם משמרת אמיתית. כאן נמצא כל השאר.</p>
      </section>
      <DashboardSections categories={categories} staff />
      <DevPushPanel />
    </main>
  )
}
