import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import HubLive from '@/components/owner/pos/HubLive'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'
import { canManagePos, resolvePosIdentity } from '@/lib/pos/server/guard'
import { readDashboard } from '@/lib/pos/server/signals'
import { createServiceRoleClient } from '@/lib/supabase/server'
import '@/components/owner/pos/ops.css'

export const dynamic = 'force-dynamic'

// The manager's live hub. First paint comes from the very module the API route
// uses (readDashboard), so the page and its 30 s / realtime refetches can never
// disagree about a number. Access is "OP or this branch's general manager"
// (canManagePos == canEditMenu); /api/owner/pos/* re-checks per branch on every
// request, so this redirect is the first gate and not the only one.
export default async function OwnerPosHubPage() {
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

  // A failed first read is not a failed page: the client refetches and says so plainly.
  const initial = await readDashboard(createServiceRoleClient(), { id: branch.id, slug: branch.slug }).catch(() => null)

  return (
    <main id="main" tabIndex={-1} className="ops-main">
      <OwnerHeader title="קופה" backHref="/owner/dashboard" />
      <HubLive branches={branches} initialBranch={branch.slug} initial={initial} />
    </main>
  )
}
