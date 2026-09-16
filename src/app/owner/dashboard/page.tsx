import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { ClipboardList, Users, Accessibility, History, Tablet, Link2, Star, MessageCircle, CalendarClock } from 'lucide-react'
import OwnerHeader from '@/components/OwnerHeader'
import DashboardLive from '@/components/DashboardLive'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'
import { readDashboardStats } from '@/lib/owner/dashboard-stats'
import { readDashboardSignals } from '@/lib/owner/signals'
import { getBranches } from '@/lib/branches/server'
import { BRANCH_COOKIE, resolveCurrentBranchSlug } from '@/lib/branches/current'

export const dynamic = 'force-dynamic'

const TILES = [
  { href: '/owner/editor', icon: ClipboardList, label: 'עריכת תפריט' },
  { href: '/owner/tablet', icon: Tablet, label: 'זמינות בזמן אמת' },
  { href: '/owner/staff', icon: Users, label: 'צוות' },
  { href: '/owner/schedule', icon: CalendarClock, label: 'לוח משמרות' },
  { href: '/owner/audit', icon: History, label: 'יומן שינויים' },
  { href: '/owner/links', icon: Link2, label: 'קישורי פורטל' },
  { href: '/owner/reviews', icon: Star, label: 'ביקורות' },
  { href: '/owner/feedback', icon: MessageCircle, label: 'משוב מלקוחות' },
  { href: '/owner/accessibility', icon: Accessibility, label: 'הצהרת נגישות' },
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

  const branches = await getBranches()
  const cookieStore = await cookies()
  const currentSlug = resolveCurrentBranchSlug(branches, cookieStore.get(BRANCH_COOKIE)?.value)
  const defaultBranch = branches.find((b) => b.slug === currentSlug) ?? branches[0] ?? null

  const [stats, signals] = defaultBranch
    ? await Promise.all([readDashboardStats(defaultBranch.id), readDashboardSignals(defaultBranch.id)])
    : [
        { hasUnpublishedChanges: { known: false, value: false }, outOfStockCount: { known: false, value: 0 }, categoryCount: { known: false, value: 0 } },
        [],
      ]

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="לוח בקרה" />

      <div className="rise" style={{ animationDelay: '60ms' }}>
        <DashboardLive branches={branches} initialBranch={defaultBranch?.slug ?? ''} initial={{ stats, signals }} />
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
              <tile.icon size={22} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--neon-soft)' }} />
              {tile.label}
            </Link>
          ))}
        </div>
      </nav>
    </main>
  )
}
