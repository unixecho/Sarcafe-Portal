import { redirect } from 'next/navigation'
import OwnerHeader from '@/components/OwnerHeader'
import BranchList from '@/components/branches/BranchList'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'
import { getBranches } from '@/lib/branches/server'
import { loadBranchOverview, loadEventTree } from '@/lib/branches/manager'

export const dynamic = 'force-dynamic'

// ניהול סניפים: one card per branch (and a way to add the next one). Owner-only: it changes what the whole team is asked.
export default async function OwnerBranchesPage() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/owner/branches')
  const service = createServiceRoleClient()
  const { data: me } = await service.from('staff').select('role, badge').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
  if (!isOp(me)) redirect('/no-access')

  // Coffee trucks only. An event is the POS subsystem of a truck and lives inside it (the branch manager's "קופה ואירועים" tab).
  const branches = await getBranches()
  const tree = await loadEventTree(service).catch(() => ({ trucks: [], events: [] }))
  const overviews = await Promise.all(branches.map((branch) => loadBranchOverview(service, branch).catch(() => null)))
  const cards = branches.map((branch, index) => {
    const overview = overviews[index]
    return {
      slug: branch.slug,
      name: branch.name.he,
      kind: branch.kind === 'event' ? ('event' as const) : ('permanent' as const),
      openNow: branch.openNow,
      hoursConfigured: branch.hoursConfigured === true,
      hoursToday: branch.hoursToday,
      shortages: overview?.shortages ?? null,
      missing: overview ? overview.readiness.filter((item) => !item.ok).length : null,
      people: overview ? overview.people.filter((p) => p.schedulable).length : null,
      checklistsOn: overview ? overview.checklists.filter((c) => c.enabled).length : null,
      events: tree.events.filter((event) => event.parentId === branch.id).length,
    }
  })

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 980, margin: '0 auto', padding: '0 16px 40px' }}>
      <OwnerHeader title="ניהול סניפים" backHref="/owner/dashboard" homeHref="/owner/dashboard" />
      <BranchList cards={cards} unassignedEvents={tree.events.filter((event) => event.parentId === null).length} />
    </main>
  )
}
