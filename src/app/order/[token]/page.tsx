import Link from 'next/link'
import type { Metadata } from 'next'
import LogoMark from '@/components/LogoMark'
import OrderStatusView from '@/components/orders/OrderStatusView'
import { resolveOrderIdByToken } from '@/lib/orders/customer'
import { loadOrderById } from '@/lib/orders/state-query'
import { getBranches } from '@/lib/branches/server'
import { getCustomerFeedbackEnabled } from '@/lib/settings/server'
import type { CustomerOrder, Order } from '@/lib/orders/types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'מעקב הזמנה — SARCafe' }

function toCustomerOrder(order: Order): CustomerOrder {
  const { createdByName: _createdByName, notes: _notes, ...rest } = order
  return rest
}

// Public, no session — the token IS the credential (see
// lib/orders/customer.ts). Reads once here for a fast first paint;
// OrderStatusView takes it from there with its own poll + realtime.
export default async function OrderTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const orderId = await resolveOrderIdByToken(token)
  const order = orderId ? await loadOrderById(orderId) : null

  // Resolved once for the initial paint, not re-fetched on every poll —
  // a branch's review link/feedback switch don't change mid-order. Looked
  // up by id via the same branches list the portal already reads, rather
  // than adding a getBranchById() just for this.
  const [branches, feedbackEnabled] = order ? await Promise.all([getBranches(), getCustomerFeedbackEnabled()]) : [[], false]
  const branch = order ? branches.find((b) => b.id === order.branchId) : null

  return (
    <main id="main" tabIndex={-1} style={{ maxWidth: 480, margin: '0 auto', padding: '28px 16px 40px', minHeight: '100dvh' }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
        <LogoMark size={56} />
      </div>
      {order ? (
        <OrderStatusView
          token={token}
          initialOrder={toCustomerOrder(order)}
          branchSlug={branch?.slug ?? null}
          reviewUrl={branch?.links.review ?? null}
          feedbackEnabled={feedbackEnabled}
        />
      ) : (
        <div style={{ textAlign: 'center', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
          <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
            לא ניתן היה למצוא את ההזמנה הזו — יכול להיות שהקישור פג תוקף.
          </p>
          <Link
            href="/order"
            className="press"
            style={{
              display: 'inline-flex',
              minHeight: 'var(--tap-min)',
              alignItems: 'center',
              padding: '0 20px',
              borderRadius: 999,
              background: 'var(--neon)',
              color: 'var(--bg)',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            כניסה עם קוד שחזור
          </Link>
        </div>
      )}
    </main>
  )
}
