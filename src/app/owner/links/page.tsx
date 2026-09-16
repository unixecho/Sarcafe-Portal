import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import OwnerHeader from '@/components/OwnerHeader'
import LinksWorkspace from '@/components/LinksWorkspace'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { hasAnyMenuEditAccess } from '@/lib/staff/access'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'

export const dynamic = 'force-dynamic'

// Same access level as the menu editor (requireMenuEditor, branch-scoped) —
// a general_manager can fix their own branch's links without needing full
// owner rights, matching how menu content itself is gated.
export default async function OwnerLinksPage() {
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

  let allowedBranchSlug: string | null = null
  if (me?.branch_id) {
    const { data: branch } = await service.from('branches').select('slug').eq('id', me.branch_id).maybeSingle()
    allowedBranchSlug = branch?.slug ?? null
  }

  const branches = await getBranches()
  const visibleBranches = allowedBranchSlug ? branches.filter((b) => b.slug === allowedBranchSlug) : branches
  const cookieStore = await cookies()
  const initialBranch = resolveCurrentBranchSlug(visibleBranches, cookieStore.get(BRANCH_COOKIE)?.value)

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 560, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="קישורי פורטל" backHref="/owner/dashboard" />
      <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', margin: '0 0 16px' }}>
        הקישורים נשמרים ישירות בכפתורי הפורטל — שינוי כאן משפיע מיד, בלי צורך בפריסה מחדש.
      </p>
      <LinksWorkspace branches={visibleBranches} initialBranch={initialBranch} />
    </main>
  )
}
