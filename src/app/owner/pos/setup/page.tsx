import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import SetupWorkspace from '@/components/owner/pos/SetupWorkspace'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { canEditMenu, hasAnyMenuEditAccess, isOp } from '@/lib/staff/access'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'
import { readSetupState } from '@/lib/pos/server/readiness'
import type { SetupState } from '@/lib/pos/owner-api'

export const dynamic = 'force-dynamic'

// The owner's setup page: a readiness checklist plus the selling-point wizard.
// Open to a manager of the event (the owner, or a general manager scoped to it) —
// the same circle that edits the menu — and re-checked here on top of the
// middleware, which only knows "could manage SOME branch".

export default async function OwnerPosSetupPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const service = createServiceRoleClient()
  const { data: me } = await service
    .from('staff')
    .select('role, badge, branch_id')
    .eq('auth_user_id', user.id)
    .eq('active', true)
    .maybeSingle()
  if (!hasAnyMenuEditAccess(me)) redirect('/no-access')

  // Events only: that is where the register runs. A manager sees just the ones they may manage.
  const all = await getBranches({ includeEvents: true })
  const events = all.filter((b) => b.kind === 'event' && canEditMenu(me, b.id))
  const cookieStore = await cookies()
  const slug = resolveCurrentBranchSlug(events, cookieStore.get(BRANCH_COOKIE)?.value)
  const current = events.find((b) => b.slug === slug) ?? null

  // First paint is server-rendered. If the read fails the workspace reads it itself —
  // an error here must never be a blank page for the owner.
  let initial: SetupState | null = null
  if (current) {
    try {
      initial = await readSetupState(service, { id: current.id, slug: current.slug })
    } catch {
      initial = null
    }
  }

  const label = (b: { slug: string; name: { he: string; en?: string } }) => b.name.he || b.name.en || b.slug

  return (
    <SetupWorkspace
      key={current?.slug ?? 'none'}
      events={events.map((b) => ({ id: b.id, slug: b.slug, label: label(b) }))}
      sources={all.filter((b) => b.kind !== 'event').map((b) => ({ slug: b.slug, label: label(b) }))}
      initialSlug={current?.slug ?? ''}
      initial={initial}
      canCreateEvent={isOp(me)}
    />
  )
}
