'use client'

import { useRouter } from 'next/navigation'
import Seg from './Seg'

// The two dashboards, one tap apart (owner, 2026-11-05: "give me a way to bounce back from dashboard to dashboard"): the business
// (/owner/dashboard, or the developer's /staff/dev) and the kiosk (/owner/kiosk/control). Sits at the top of both.
export type DashboardKind = 'business' | 'kiosk'
export default function DashboardSwitch({ current, home = '/owner/dashboard' }: { current: DashboardKind; home?: string }) {
  const router = useRouter()
  return (
    <div className="gl-dash-switch" data-dashboard-switch="">
      <Seg fill label="לוח" value={current} onChange={(v) => router.push(v === 'kiosk' ? '/owner/kiosk/control' : home)}
        items={[{ value: 'business', label: 'לוח הבקרה' }, { value: 'kiosk', label: 'הקיוסק' }]} />
    </div>
  )
}
