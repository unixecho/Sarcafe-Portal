import type { Metadata } from 'next'
import LogoMark from '@/components/LogoMark'
import RecoveryCodeForm from '@/components/orders/RecoveryCodeForm'
import QrScanner from '@/components/orders/QrScanner'
import HowToGuide from '@/components/orders/HowToGuide'
import ClientPageFooter from '@/components/ClientPageFooter'

export const metadata: Metadata = { title: 'מעקב הזמנה — SarCafe' }

// The fallback entry point when a customer's QR/link is gone — reachable
// on its own (also the PWA manifest's start_url), not just from a failed
// /order/[token] lookup.
export default function OrderRecoveryPage() {
  return (
    <main
      id="main"
      tabIndex={-1}
      style={{
        maxWidth: 420,
        margin: '0 auto',
        padding: '48px 16px',
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 22,
      }}
    >
      <LogoMark size={64} />
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: '1.2rem', fontWeight: 800 }}>מעקב אחרי הזמנה</h1>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-dim)' }}>
          הזינו את קוד השחזור בן 6 הספרות שעל הקבלה — או סרקו את הברקוד שלצידו.
        </p>
      </div>
      <RecoveryCodeForm />
      <QrScanner />
      <HowToGuide />
      <ClientPageFooter />
    </main>
  )
}
