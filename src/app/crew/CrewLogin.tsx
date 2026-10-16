'use client'

import Link from 'next/link'
import { ClipboardCheck } from 'lucide-react'
import PublicBackdrop from '@/components/PublicBackdrop'
import LogoMark from '@/components/LogoMark'
import QuickLogin from '@/components/auth/QuickLogin'

// The sign-in the QR code on the cart opens (owner, 2026-10-17): employee number + six-digit code, then the shift card with
// the checklists. Nothing else is offered here; the app sign-in (Google) is one small link for people who have the app.
export default function CrewLogin() {
  return (
    <PublicBackdrop>
      <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, position: 'relative' }}>
        <section className="rise" style={{ width: '100%', maxWidth: 360, background: 'var(--glass-strong)', backdropFilter: 'blur(24px)', border: '1px solid var(--line)', borderRadius: 20, padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 20, textAlign: 'center' }}>
          <header>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><LogoMark size={64} /></div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 8 }}><ClipboardCheck size={24} aria-hidden="true" />צ׳קליסטים למשמרת</h1>
            <p style={{ margin: '6px 0 0', color: 'var(--text-faint)', fontSize: '0.85rem' }}>הכניסו את מספר העובד ואת הקוד בן 6 הספרות</p>
          </header>
          <QuickLogin next="/staff" />
          <Link href="/login?next=/staff" className="press" style={{ color: 'var(--text-dim)', fontSize: '0.85rem', fontWeight: 600, minHeight: 'var(--tap-min)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            יש לך את האפליקציה? כניסה עם Google
          </Link>
        </section>
      </main>
    </PublicBackdrop>
  )
}
