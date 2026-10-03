import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import StatsViewRoot from '@/components/owner/pos/StatsView'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'
import { canManagePos, resolvePosIdentity } from '@/lib/pos/server/guard'
import { readStats } from '@/lib/pos/server/stats'
import { createServiceRoleClient } from '@/lib/supabase/server'
import '@/components/owner/pos/ops.css'

export const dynamic = 'force-dynamic'

// Statistics. First paint is the API's own reader (readStats) for the default scope
// (the active, else the most recent, LIVE session) — every number is computed there
// and only formatted in the browser.
export default async function OwnerPosStatsPage() {
  const { signedIn, staff } = await resolvePosIdentity()
  if (!signedIn) redirect('/login')
  if (!staff) redirect('/no-access')

  const all = await getBranches({ includeEvents: true })
  const branches = all.filter((b) => canManagePos(staff, b.id))
  if (branches.length === 0) redirect('/no-access')

  const cookieStore = await cookies()
  const current = resolveCurrentBranchSlug(branches, cookieStore.get(BRANCH_COOKIE)?.value)
  const branch = branches.find((b) => b.slug === current) ?? branches[0]
  if (!branch) redirect('/no-access')

  const service = createServiceRoleClient()
  const [initial, zones] = await Promise.all([
    readStats(service, { id: branch.id, slug: branch.slug }, { branch: branch.slug }).catch(() => null),
    service.from('branches').select('slug, timezone').in('slug', branches.map((b) => b.slug)),
  ])
  const timezones: Record<string, string> = {}
  for (const z of (zones.data ?? []) as { slug: string; timezone: string | null }[]) {
    if (z.timezone) timezones[z.slug] = z.timezone
  }

  return (
    <main id="main" tabIndex={-1} className="ops-main">
      <OwnerHeader title="סטטיסטיקה" backHref="/owner/pos" />
      <StatsViewRoot branches={branches} initialBranch={branch.slug} timezones={timezones} initial={initial} />
    </main>
  )
}
