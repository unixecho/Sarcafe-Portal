import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import LogView from '@/components/owner/pos/LogView'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'
import { canManagePos, resolvePosIdentity } from '@/lib/pos/server/guard'
import { readLogPage } from '@/lib/pos/server/log'
import { createServiceRoleClient } from '@/lib/supabase/server'
import '@/components/owner/pos/ops.css'

export const dynamic = 'force-dynamic'

// The audit log: every event, newest first. First paint is the API's own reader
// (readLogPage), so the first page and "load more" come from one code path.
export default async function OwnerPosLogPage() {
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
    readLogPage(service, { id: branch.id, slug: branch.slug }, { branch: branch.slug }).catch(() => null),
    service.from('branches').select('slug, timezone').in('slug', branches.map((b) => b.slug)),
  ])
  const timezones: Record<string, string> = {}
  for (const z of (zones.data ?? []) as { slug: string; timezone: string | null }[]) {
    if (z.timezone) timezones[z.slug] = z.timezone
  }

  return (
    <main id="main" tabIndex={-1} className="ops-main">
      <OwnerHeader title="יומן קופה" backHref="/owner/pos" />
      <LogView branches={branches} initialBranch={branch.slug} timezones={timezones} initial={initial} />
    </main>
  )
}
