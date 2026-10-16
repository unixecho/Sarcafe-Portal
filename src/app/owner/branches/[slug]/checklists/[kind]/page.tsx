import { notFound, redirect } from 'next/navigation'
import OwnerHeader from '@/components/OwnerHeader'
import ChecklistBuilder, { type BuilderSource, type BuilderTemplate } from '@/components/checklists/ChecklistBuilder'
import { branchChecklistBuilderPath } from '@/lib/checklists/links'
import { ensureChecklistTemplates } from '@/lib/checklists/server'
import type { ChecklistDefinition, ChecklistKind } from '@/lib/checklists/types'
import { getBranches, getBranchBySlug } from '@/lib/branches/server'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { canEditMenu, hasAnyMenuEditAccess, isOp } from '@/lib/staff/access'

export const dynamic = 'force-dynamic'

const KINDS: readonly ChecklistKind[] = ['opening', 'handover', 'closing']

// ONE branch's checklist builder (owner, 2026-10-16). The owner, or the branch's general manager, edits that branch's forms here;
// nobody else gets in, and no branch can edit another's. The forms of a branch that has none yet are made on the way in
// (ensureChecklistTemplates), so a new branch starts with a working set it can then change.
export default async function BranchChecklistBuilderPage({ params }: { params: Promise<{ slug: string; kind: string }> }) {
  const { slug, kind } = await params
  if (!KINDS.includes(kind as ChecklistKind)) notFound()
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=${branchChecklistBuilderPath(slug, kind as ChecklistKind)}`)
  const service = createServiceRoleClient()
  const { data: me } = await service.from('staff').select('role, badge, branch_id').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
  if (!hasAnyMenuEditAccess(me)) redirect('/no-access')

  const branch = await getBranchBySlug(slug)
  // An event has no forms of its own: its team works the truck's checklists.
  if (!branch || branch.kind === 'event') notFound()
  if (!canEditMenu(me, branch.id)) redirect('/no-access')

  await ensureChecklistTemplates(service, { id: branch.id, slug: branch.slug, name: { he: branch.name.he } })
  const [{ data: templates }, { data: switches }, others] = await Promise.all([
    service.from('checklist_templates').select('id, kind, name, version, definition, published_at').eq('branch_id', branch.id).eq('active', true).order('kind'),
    service.from('checklist_branch_settings').select('kind, enabled').eq('branch_id', branch.id),
    getBranches(),
  ])
  const enabled = { opening: true, handover: true, closing: true } as Record<ChecklistKind, boolean>
  for (const row of switches ?? []) if (KINDS.includes(row.kind as ChecklistKind)) enabled[row.kind as ChecklistKind] = row.enabled === true

  // Other trucks' current forms, as a starting point. Only the forms themselves (the same checklist items every truck uses), never who filled them in.
  const otherIds = others.filter((other) => other.id !== branch.id).map((other) => other.id)
  const { data: donor } = otherIds.length
    ? await service.from('checklist_templates').select('branch_id, kind, name, definition').in('branch_id', otherIds).eq('active', true)
    : { data: [] as { branch_id: string; kind: string; name: string; definition: unknown }[] }
  const sources: BuilderSource[] = others
    .filter((other) => other.id !== branch.id)
    .map((other) => ({
      slug: other.slug,
      name: other.name.he,
      templates: (donor ?? []).filter((row) => row.branch_id === other.id && KINDS.includes(row.kind as ChecklistKind)).map((row) => ({ kind: row.kind as ChecklistKind, name: String(row.name), definition: row.definition as ChecklistDefinition })),
    }))
    .filter((source) => source.templates.length > 0)

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 980, margin: '0 auto', padding: '0 16px 96px' }}>
      <OwnerHeader title={`צ׳קליסטים · ${branch.name.he}`} backHref={isOp(me) ? `/owner/branches/${branch.slug}?tab=checklists` : '/staff'} homeHref="/staff" />
      <ChecklistBuilder
        branch={{ id: branch.id, slug: branch.slug, name: branch.name.he }}
        initialKind={kind as ChecklistKind}
        templates={(templates ?? []) as BuilderTemplate[]}
        sources={sources}
        enabled={enabled}
        backHref={isOp(me) ? `/owner/branches/${branch.slug}?tab=checklists` : '/staff'}
      />
    </main>
  )
}
