import { notFound, redirect } from 'next/navigation'
import OwnerHeader from '@/components/OwnerHeader'
import BranchManager from '@/components/branches/BranchManager'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'
import { getBranchBySlug } from '@/lib/branches/server'
import { loadBranchOverview, loadEventTree } from '@/lib/branches/manager'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'checklists', 'schedule', 'details', 'team', 'pos'] as const

export default async function OwnerBranchPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string | string[] }> }) {
  const { slug } = await params
  const rawTab = (await searchParams).tab
  const tab = TABS.find((t) => t === (Array.isArray(rawTab) ? rawTab[0] : rawTab)) ?? 'overview'
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/owner/branches/${encodeURIComponent(slug)}`)
  const service = createServiceRoleClient()
  const { data: me } = await service.from('staff').select('role, badge').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
  if (!isOp(me)) redirect('/no-access')

  const branch = await getBranchBySlug(slug)
  if (!branch) notFound()
  // An event has no manager of its own: it is a subsystem of its truck, so its address opens that truck's POS tab
  // (an event nobody has claimed yet opens the list of branches, where the note about it is).
  if (branch.kind === 'event') {
    const tree = await loadEventTree(service)
    const parent = tree.trucks.find((truck) => truck.id === tree.events.find((event) => event.id === branch.id)?.parentId)
    redirect(parent ? `/owner/branches/${parent.slug}?tab=pos` : '/owner/branches')
  }
  const overview = await loadBranchOverview(service, branch)
  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 980, margin: '0 auto', padding: '0 16px 96px' }}>
      <OwnerHeader title="ניהול סניף" backHref="/owner/branches" homeHref="/owner/dashboard" />
      <BranchManager overview={overview} links={branch.links} initialTab={tab} />
    </main>
  )
}
