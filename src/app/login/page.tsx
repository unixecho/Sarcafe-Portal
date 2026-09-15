'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import AuthHandoff from '@/components/AuthHandoff'
import PublicBackdrop from '@/components/PublicBackdrop'
import LogoMark from '@/components/LogoMark'

// Structurally mirrors AyekaBar's /login: a two-step reveal (this page,
// then the AuthHandoff interstitial) rather than firing OAuth straight off
// a single button. /owner, /staff, and (later) /customer all funnel here —
// there is no separate staff login route and no email/password form
// anywhere; Google is the only door, and the destination after sign-in is
// resolved server-side by role (see app/auth/callback/route.ts).
export default function LoginPage() {
  const [handoffOpen, setHandoffOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Sarcafe | כניסה'
    const params = new URLSearchParams(window.location.search)
    if (params.get('error') || params.get('error_code')) {
      setError('ההתחברות בוטלה או שפג תוקפה. נסה/י שוב.')
    }
  }, [])

  return (
    <PublicBackdrop>
      <main id="main" tabIndex={-1}
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          position: 'relative',
        }}
      >
        <section
          className="rise"
          style={{
            width: '100%',
            maxWidth: 360,
            background: 'var(--glass-strong)',
            backdropFilter: 'blur(24px)',
            border: '1px solid var(--line)',
            borderRadius: 20,
            padding: '32px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            textAlign: 'center',
          }}
        >
          <header>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <LogoMark size={64} />
            </div>
            <h1 style={{ margin: 0, fontSize: '1.7rem', fontWeight: 800 }}>Sarcafe</h1>
            <p style={{ margin: '4px 0 0', color: 'var(--text-faint)', fontSize: '0.85rem' }}>כניסה</p>
          </header>

          <button
            type="button"
            className="press"
            onClick={() => setHandoffOpen(true)}
            style={{
              width: '100%',
              minHeight: 'var(--tap-min)',
              borderRadius: 999,
              border: 'none',
              background: '#fff',
              color: '#1a1c1e',
              fontWeight: 700,
              fontSize: '0.95rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              cursor: 'pointer',
            }}
          >
            <span aria-hidden="true">G</span>
            המשך עם Google
          </button>

          {error && !handoffOpen && (
            <p role="alert" style={{ margin: 0, color: '#ff6b6b', fontSize: '0.85rem' }}>
              {error}
            </p>
          )}

          <p style={{ margin: 0, color: 'var(--text-faint)', fontSize: '0.78rem' }}>
            המערכת תיקח אותך לאזור המתאים לך אוטומטית לפי ההרשאה שלך.
          </p>

          <Link
            href="/"
            className="press"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--text-dim)', fontSize: '0.85rem' }}
          >
            <ArrowRight size={15} aria-hidden="true" />
            חזרה
          </Link>
        </section>

        <AuthHandoff open={handoffOpen} onClose={() => setHandoffOpen(false)} lang="he" />
      </main>
    </PublicBackdrop>
  )
}
