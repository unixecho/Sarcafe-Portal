import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { Clock } from 'lucide-react'
import OwnerHeader from '@/components/OwnerHeader'
import TabletWorkspace from '@/components/TabletWorkspace'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { hasAnyMenuEditAccess, isOp } from '@/lib/staff/access'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'
import { isWithinOperatingHours } from '@/lib/shifts/hours'

export const dynamic = 'force-dynamic'

// Same staff login as the editor (no separate PIN gate) — just a
// touch-optimized layout meant for a tablet mounted behind the counter.
// Access is the same coarse gate the editor uses (hasAnyMenuEditAccess);
// POST /api/owner/menu-availability re-checks per-branch access, same
// defense-in-depth pattern as every other owner route.
//
// Additionally gated to operating hours (shift_settings, not shift
// instances — see lib/shifts/hours.ts): a live stock count only means
// anything while the branch is actually selling. Only the owner may open
// the tool outside those hours (to test it); TabletAvailability itself
// re-checks per branch (via GET /api/owner/menu-variants'
// withinOperatingHours) so switching branches on a multi-branch account
// re-evaluates instead of trusting this page's one-time check.
export default async function OwnerTabletPage() {
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

  const isOwner = isOp(me)

  let allowedBranchSlug: string | null = null
  if (me?.branch_id) {
    const { data: branch } = await service.from('branches').select('slug').eq('id', me.branch_id).maybeSingle()
    allowedBranchSlug = branch?.slug ?? null
  }

  const branches = await getBranches()
  const visibleBranches = allowedBranchSlug ? branches.filter((b) => b.slug === allowedBranchSlug) : branches
  const cookieStore = await cookies()
  const initialBranch = resolveCurrentBranchSlug(visibleBranches, cookieStore.get(BRANCH_COOKIE)?.value)

  // The common case (a branch-scoped, non-owner editor) has exactly one
  // visible branch — block the whole page up front instead of flashing the
  // tool and then disabling it. A multi-branch non-owner (a null-branch_id
  // general_manager) falls through to TabletAvailability's own per-branch
  // check instead, since "outside hours" can differ branch to branch.
  if (!isOwner && visibleBranches.length === 1) {
    const onlyBranch = visibleBranches[0]!
    const withinHours = await isWithinOperatingHours(onlyBranch.id)
    if (!withinHours) {
      return (
        <main id="main" tabIndex={-1} style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 32px' }}>
          <OwnerHeader title="זמינות בזמן אמת" backHref="/owner/dashboard" />
          <div
            className="rise"
            style={{
              marginTop: 24,
              padding: '28px 20px',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-elev)',
              border: '1px solid var(--line)',
              textAlign: 'center',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: 44,
                height: 44,
                margin: '0 auto 12px',
                borderRadius: 12,
                background: 'var(--bg-elev-2)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--text-faint)',
              }}
            >
              <Clock size={22} strokeWidth={2} />
            </div>
            <h2 style={{ margin: '0 0 6px', fontSize: '1.05rem', fontWeight: 700 }}>הכלי זמין רק בשעות הפעילות</h2>
            <p style={{ margin: 0, color: 'var(--text-faint)', fontSize: '0.85rem', lineHeight: 1.6 }}>
              הסניף סגור כרגע לפי שעות הפעילות שהוגדרו בלוח המשמרות. אפשר לחזור בשעות הפתיחה.
            </p>
          </div>
        </main>
      )
    }
  }

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 'min(1200px, 100%)', margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="זמינות בזמן אמת" backHref="/owner/dashboard" />
      <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', margin: '0 0 16px' }}>
        כל שינוי כאן משפיע מיד על התפריט שהלקוחות רואים — בלי צורך בפרסום.
      </p>
      <TabletWorkspace branches={visibleBranches} initialBranch={initialBranch} isOwner={isOwner} />
    </main>
  )
}
