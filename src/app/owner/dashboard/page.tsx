import { redirect } from 'next/navigation'
import Link from 'next/link'
import OwnerHeader from '@/components/OwnerHeader'
import DashboardLive from '@/components/DashboardLive'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'
import { readDashboardStats } from '@/lib/owner/dashboard-stats'
import { readDashboardSignals } from '@/lib/owner/signals'
import { BRANCHES } from '@/lib/branches'

export const dynamic = 'force-dynamic'

const TILES = [
  { href: '/owner/editor', icon: '📋', label: 'עריכת תפריט' },
  { href: '/owner/staff', icon: '👥', label: 'צוות' },
  { href: '/owner/accessibility', icon: '♿', label: 'הצהרת נגישות' },
] as const

export default async function OwnerDashboardPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Defense in depth on top of middleware — re-resolve the caller's role
  // server-side rather than trusting that the middleware check already ran.
  const service = createServiceRoleClient()
  const { data: me } = await service
    .from('staff')
    .select('role, badge, branch_id, email, first_name')
    .eq('auth_user_id', user.id)
    .eq('active', true)
    .maybeSingle()

  if (!isOp(me)) redirect('/no-access')

  const defaultBranch = BRANCHES[0]
  const { data: branchRow } = await service
    .from('branches')
    .select('id')
    .eq('slug', defaultBranch.slug)
    .maybeSingle()

  const [stats, signals] = branchRow
    ? await Promise.all([readDashboardStats(branchRow.id), readDashboardSignals(branchRow.id)])
    : [
        { hasUnpublishedChanges: { known: false, value: false }, outOfStockCount: { known: false, value: 0 }, categoryCount: { known: false, value: 0 } },
        [],
      ]

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="לוח בקרה" />

      <div className="rise" style={{ animationDelay: '60ms' }}>
        <DashboardLive initialBranch={defaultBranch.slug} initial={{ stats, signals }} />
      </div>

      <nav aria-label="ניהול" style={{ marginTop: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {TILES.map((tile, i) => (
            <Link
              key={tile.href}
              href={tile.href}
              className="press rise"
              style={{
                animationDelay: `${140 + i * 40}ms`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                minHeight: 74,
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-elev)',
                border: '1px solid var(--line)',
                color: 'var(--text)',
                textDecoration: 'none',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              <span aria-hidden="true" style={{ fontSize: '1.3rem' }}>
                {tile.icon}
              </span>
              {tile.label}
            </Link>
          ))}
        </div>
      </nav>
    </main>
  )
}
