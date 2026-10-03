import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import OrdersHistory from '@/components/owner/pos/OrdersHistory'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'
import { readOrdersPage } from '@/lib/pos/server/details'
import { canManagePos, resolvePosIdentity } from '@/lib/pos/server/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import '@/components/owner/pos/ops.css'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Every order, newest first. First paint is the API's own reader (readOrdersPage),
// so the first 50 rows and "load more" come from one code path. `?order=` opens
// that order's detail on arrival (the hub's drill-downs and feed link here); it is
// only ever used as an id for the manager-gated detail call, never trusted.
export default async function OwnerPosOrdersPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
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
    readOrdersPage(service, { id: branch.id, slug: branch.slug }, { branch: branch.slug }).catch(() => null),
    service.from('branches').select('slug, timezone').in('slug', branches.map((b) => b.slug)),
  ])
  const timezones: Record<string, string> = {}
  for (const z of (zones.data ?? []) as { slug: string; timezone: string | null }[]) {
    if (z.timezone) timezones[z.slug] = z.timezone
  }

  const { order } = await searchParams
  const openOrder = order && UUID.test(order) ? order : null

  return (
    <main id="main" tabIndex={-1} className="ops-main">
      <OwnerHeader title="הזמנות" backHref="/owner/pos" />
      <OrdersHistory branches={branches} initialBranch={branch.slug} timezones={timezones} initial={initial} openOrder={openOrder} />
    </main>
  )
}
