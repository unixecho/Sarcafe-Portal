import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { redirect } from 'next/navigation'
import GlassDashboardShell from '@/components/glass/GlassDashboardShell'
import KioskInstall from '@/components/kiosk-admin/KioskInstall'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { isOp } from '@/lib/staff/access'
import { isDeveloper } from '@/lib/checklists/developer'
import { loadOwnerDevices } from '@/lib/kiosk/device'

export const dynamic = 'force-dynamic'

// The kiosk install wizard — the owner's private link for installing the kiosk on any tablet (owner, 2026-11-06). Full owner
// (Google sign-in, not a quick session); the middleware keeps /owner/kiosk to owners and every action checks again. Not listed
// anywhere public, never cached. docs/SARCAFE_KIOSK_INSTALL.md.
export default async function KioskInstallPage() {
  const me = await resolveStaffIdentity()
  if (!me || me.via !== 'google') redirect('/login?next=/owner/kiosk/install')
  if (!isOp(me) || me.quick) redirect('/no-access')
  const { devices, branches } = await loadOwnerDevices()
  let apkFile: string | null = null
  try { apkFile = (JSON.parse(readFileSync(join(process.cwd(), 'public', 'kiosk-ota', 'apk', 'latest.json'), 'utf8')) as { url?: string }).url ?? null } catch { apkFile = null }
  return (
    <GlassDashboardShell title="התקנת קיוסק" account={{ developer: isDeveloper(me), manager: true }}>
      <KioskInstall branches={branches} takenSlugs={(devices ?? []).map((d) => d.slug)} apkFile={apkFile} />
    </GlassDashboardShell>
  )
}
