'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import AuthHandoff from '@/components/AuthHandoff'

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
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: `radial-gradient(circle at 85% 0%, rgba(255,122,69,0.14), transparent 60%), var(--bg)`,
      }}
    >
      <section
        className="rise"
        style={{
          width: '100%',
          maxWidth: 360,
          background: 'var(--bg-elev)',
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
          {/* TODO: swap for the real Sarcafe logo asset once available —
              see SARCafe-ARCHITECTURE-AUDIT.md §5 (current assets are
              named "-placeholder"). */}
          <div
            aria-hidden="true"
            style={{
              width: 56,
              height: 56,
              margin: '0 auto 12px',
              borderRadius: 16,
              background: 'rgba(255,122,69,0.14)',
              display: 'grid',
              placeItems: 'center',
              fontSize: '1.8rem',
              filter: 'drop-shadow(0 0 12px rgba(255,122,69,0.35))',
            }}
          >
            ☕
          </div>
          <h1 style={{ margin: 0, fontSize: '1.7rem', fontWeight: 800 }}>
            Sar<span style={{ color: 'var(--neon)' }}>·</span>Cafe
          </h1>
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

        <Link href="/" style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
          ← חזרה
        </Link>
      </section>

      <AuthHandoff open={handoffOpen} onClose={() => setHandoffOpen(false)} lang="he" />
    </main>
  )
}
