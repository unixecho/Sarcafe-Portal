'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ShieldAlert, ArrowRight } from 'lucide-react'
import AuthHandoff from '@/components/AuthHandoff'
import PublicBackdrop from '@/components/PublicBackdrop'
import { createClient } from '@/lib/supabase/client'

// Reached when authenticated but not authorized for anything in the app —
// no `staff` row, or a `staff` row without owner/menu-editor rights (Phase
// 1 has no destination for a plain barista/cook account yet; Phase 2/3's
// kitchen view will). Mirrors AyekaBar's /no-access: no header/nav here on
// purpose, since a denied user must not be able to bounce between this
// page and whatever guard sent them here.
export default function NoAccessPage() {
  const [handoffOpen, setHandoffOpen] = useState(false)

  async function switchAccount() {
    const supabase = createClient()
    await supabase.auth.signOut()
    setHandoffOpen(true)
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        position: 'relative',
      }}
    >
      <PublicBackdrop />
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
          gap: 16,
          textAlign: 'center',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 48,
            height: 48,
            margin: '0 auto',
            borderRadius: 14,
            background: 'rgba(255,107,107,0.14)',
            display: 'grid',
            placeItems: 'center',
            color: '#ff6b6b',
          }}
        >
          <ShieldAlert size={24} strokeWidth={2} />
        </div>
        <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>אין הרשאת גישה</h1>
        <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.9rem' }}>
          החשבון המחובר לא מורשה לגשת למערכת הזו. אם זו טעות, פנו למנהל/ת.
        </p>

        {/* TODO: wire to a real contact number once the owner provides one
            (app_settings key, not hardcoded) — never invent a business
            phone number as a placeholder. */}

        <button
          type="button"
          className="press"
          onClick={switchAccount}
          style={{
            width: '100%',
            minHeight: 'var(--tap-min)',
            borderRadius: 999,
            border: '1px solid var(--line-strong)',
            background: 'var(--bg-elev-2)',
            color: 'var(--text)',
            fontWeight: 600,
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          התחברות עם חשבון אחר
        </button>

        <p style={{ margin: 0, color: 'var(--text-faint)', fontSize: '0.78rem' }}>
          יש לך כמה חשבונות Google? יכול להיות שבחרת בטעות בחשבון הלא נכון.
        </p>

        <Link
          href="/"
          className="press"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--text-dim)', fontSize: '0.85rem' }}
        >
          <ArrowRight size={15} aria-hidden="true" />
          חזרה לדף הבית
        </Link>
      </section>

      <AuthHandoff open={handoffOpen} onClose={() => setHandoffOpen(false)} lang="he" />
    </main>
  )
}
