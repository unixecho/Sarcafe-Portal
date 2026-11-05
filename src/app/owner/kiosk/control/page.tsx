import { redirect } from 'next/navigation'
import GlassDashboardShell from '@/components/glass/GlassDashboardShell'
import DashboardSwitch from '@/components/glass/DashboardSwitch'
import KioskControl from '@/components/kiosk-admin/KioskControl'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { isOp } from '@/lib/staff/access'
import { isDeveloper } from '@/lib/checklists/developer'
import { loadOwnerDevices } from '@/lib/kiosk/device'
import { loadRemoteState } from '@/lib/kiosk/remote'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// The kiosk dashboard (owner, 2026-11-05): the tablets, their remote control panel and PIN reset, one tap from the business dashboard
// (the switch at the top of both). Full owner (Google sign-in, not a quick session); the middleware already keeps /owner/kiosk to
// owners, and every action behind it checks again (requireOwner). docs/SARCAFE_KIOSK_REMOTE.md.
export default async function KioskControlPage() {
  const me = await resolveStaffIdentity()
  if (!me || me.via !== 'google') redirect('/login?next=/owner/kiosk/control')
  if (!isOp(me) || me.quick) redirect('/no-access')
  const developer = isDeveloper(me)
  const [{ devices, branches }, remote] = await Promise.all([
    loadOwnerDevices(),
    loadRemoteState(createServiceRoleClient()).catch(() => ({ ready: false, bySlug: {} })),
  ])
  return (
    <GlassDashboardShell title="לוח הקיוסק" account={{ developer, manager: true }}>
      <DashboardSwitch current="kiosk" home={developer ? '/staff/dev?view=manager' : '/owner/dashboard'} />
      <KioskControl initialDevices={devices} branches={branches} initialRemote={remote} />
    </GlassDashboardShell>
  )
}
