'use client'

import { useEffect, useRef, useState } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { createClient } from '@/lib/supabase/client'

const COPY = {
  he: {
    heading: 'קפיצה קצרה ל-Google',
    subtitle: 'Google מוודא מי אתם ומחזיר אתכם לכאן.',
    features: [
      { icon: '🔒', title: 'רק השם והאימייל', blurb: 'Google משתף איתנו רק שם ואימייל — שום דבר אחר.' },
      { icon: '⚡', title: 'הקשה אחת, בלי סיסמאות', blurb: 'אין סיסמה לזכור ואין טופס למלא.' },
      { icon: '🔑', title: 'הגישה שלך מאומתת', blurb: 'ההרשאה שלך נקבעת אצלנו לפי החשבון המאומת שלך.' },
    ],
    continueLabel: 'המשך עם Google',
    connecting: 'מתחבר…',
    notNow: 'לא עכשיו',
    close: 'סגירה',
  },
  en: {
    heading: 'A quick hop to Google',
    subtitle: 'Google verifies who you are and returns you here.',
    features: [
      { icon: '🔒', title: 'Only your name & email', blurb: 'Google shares nothing else with us.' },
      { icon: '⚡', title: 'One tap, no passwords', blurb: 'Nothing to remember, nothing to type.' },
      { icon: '🔑', title: 'Your access is verified', blurb: 'Your permissions are set by us against your verified account.' },
    ],
    continueLabel: 'Continue with Google',
    connecting: 'Connecting…',
    notNow: 'Not now',
    close: 'Close',
  },
} as const

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.16.28-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.03l2.99-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.97l2.99 2.33C4.66 5.17 6.65 3.58 9 3.58Z" />
    </svg>
  )
}

type AuthHandoffProps = {
  open: boolean
  onClose: () => void
  lang?: 'he' | 'en'
  /** Where Supabase should send the browser back after Google returns. */
  redirectPath?: string
}

/**
 * The "step 2" reveal before actually leaving for Google — deliberately not
 * a single button straight into OAuth. Leaving the app for a third-party
 * sign-in page reads as more trustworthy when the app says so first.
 * Ported from AyekaBar (copy rewritten for Sarcafe; no loyalty/"points"
 * framing since Sarcafe has no such feature).
 */
export default function AuthHandoff({ open, onClose, lang = 'he', redirectPath = '/auth/callback' }: AuthHandoffProps) {
  const t = COPY[lang]
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'

    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('button')?.focus()
    }, 60)

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab') return
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>('button')
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = ''
      previouslyFocused.current?.focus?.({ preventScroll: true })
    }
  }, [open, onClose])

  if (!open) return null

  async function continueWithGoogle() {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${redirectPath}`,
        queryParams: { prompt: 'select_account' },
      },
    })
    if (authError) {
      setBusy(false)
      setError(authError.message)
    }
    // On success the browser navigates away to Google — nothing left to do here.
  }

  return (
    <ModalPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.heading}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          background: `radial-gradient(circle at 85% 0%, rgba(255,122,69,0.14), transparent 60%), var(--bg)`,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t.close}
          className="press dir-flip"
          style={{
            position: 'absolute',
            top: 16,
            insetInlineStart: 16,
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: 'none',
            background: 'var(--bg-elev-2)',
            color: 'var(--text)',
            fontSize: '1.1rem',
            cursor: 'pointer',
          }}
        >
          ‹
        </button>

        <div ref={panelRef} className="rise" style={{ maxWidth: 360, width: '100%', textAlign: 'center' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 14,
              marginBottom: 20,
            }}
          >
            <div
              className="pop"
              style={{
                width: 64,
                height: 64,
                borderRadius: 18,
                background: 'rgba(255,122,69,0.14)',
                display: 'grid',
                placeItems: 'center',
                fontSize: '1.6rem',
              }}
              aria-hidden="true"
            >
              ☕
            </div>
            <div aria-hidden="true" style={{ display: 'flex', gap: 4 }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: 'var(--text-faint)',
                    animation: `handoff-dot 1.2s ${i * 0.15}s infinite`,
                  }}
                />
              ))}
            </div>
            <div
              className="pop"
              style={{
                width: 64,
                height: 64,
                borderRadius: 18,
                background: '#fff',
                display: 'grid',
                placeItems: 'center',
                animationDelay: '80ms',
              }}
            >
              <GoogleG />
            </div>
          </div>

          <h2 style={{ margin: '0 0 6px', fontSize: '1.2rem', fontWeight: 800 }}>{t.heading}</h2>
          <p style={{ margin: '0 0 20px', color: 'var(--text-dim)', fontSize: '0.9rem' }}>{t.subtitle}</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {t.features.map((f, i) => (
              <div
                key={f.title}
                className="rise"
                style={{
                  animationDelay: `${90 + i * 60}ms`,
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  textAlign: 'start',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--line)',
                }}
              >
                <span aria-hidden="true" style={{ fontSize: '1.1rem' }}>
                  {f.icon}
                </span>
                <span>
                  <strong style={{ display: 'block', fontSize: '0.88rem' }}>{f.title}</strong>
                  <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-faint)' }}>{f.blurb}</span>
                </span>
              </div>
            ))}
          </div>

          {error && (
            <p role="alert" style={{ color: '#ff6b6b', fontSize: '0.85rem', marginBottom: 12 }}>
              {error}
            </p>
          )}

          <button
            type="button"
            className="press"
            onClick={continueWithGoogle}
            disabled={busy}
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
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.75 : 1,
            }}
          >
            {!busy && <GoogleG />}
            {busy ? t.connecting : t.continueLabel}
          </button>

          <button
            type="button"
            onClick={onClose}
            style={{
              marginTop: 12,
              background: 'none',
              border: 'none',
              color: 'var(--text-faint)',
              fontSize: '0.85rem',
              cursor: 'pointer',
              padding: 8,
            }}
          >
            {t.notNow}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes handoff-dot {
          0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="handoff-dot"] { animation: none !important; }
        }
      `}</style>
    </ModalPortal>
  )
}
