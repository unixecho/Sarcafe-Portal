import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CalendarClock, Receipt, ShoppingBag } from 'lucide-react'
import OwnerHeader from '@/components/OwnerHeader'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { isStaff } from '@/lib/staff/access'
import { staffLandingPath } from '@/lib/pos/server/landing'

export const dynamic = 'force-dynamic'

// Staff-facing (non-owner) tile grid — grows the same way /owner/dashboard
// did as more of these land. Three destinations today: the schedule, the
// order-taking register (/staff/pos) and the event POS (/pos).
//
// When an EVENT this person may work is live right now, they go straight to the
// event POS (a cashier opening the app at a stall wants the till, not a menu of
// choices); otherwise they see this grid. Middleware has already required an
// active staff row; a failed landing lookup just means "show the grid".
const TILES = [
  { href: '/staff/schedule', icon: CalendarClock, label: 'לוח משמרות' },
  { href: '/staff/pos', icon: ShoppingBag, label: 'קופה — הזמנות' },
  { href: '/pos', icon: Receipt, label: 'קופת אירועים' },
] as const

export default async function StaffIndexPage() {
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
  if (!isStaff(me)) redirect('/no-access')

  let landing: '/pos' | '/staff/schedule' = '/staff/schedule'
  try {
    landing = await staffLandingPath(me)
  } catch {
    landing = '/staff/schedule'
  }
  if (landing === '/pos') redirect('/pos')

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px 32px' }}>
      <OwnerHeader title="אזור צוות" />
      <nav aria-label="ניהול" style={{ marginTop: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {TILES.map((tile, i) => (
            <Link
              key={tile.href}
              href={tile.href}
              className="press rise"
              style={{
                animationDelay: `${60 + i * 40}ms`,
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
