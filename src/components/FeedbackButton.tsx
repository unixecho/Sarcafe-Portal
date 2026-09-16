'use client'

import { useState, type CSSProperties } from 'react'
import { MessageCircle } from 'lucide-react'
import type { Lang } from '@/lib/menu/types'
import { FEEDBACK_UI } from '@/lib/feedback/i18n'
import FeedbackSheet from '@/components/FeedbackSheet'

// The portal/menu pages' one entry point into the feedback box — ported
// from AyekaBar's FeedbackButton.tsx. Deliberately the quietest control on
// the page (a 'link' variant for a footer, a plain 'card' for the portal) —
// this is the private "tell us what went wrong" conversation, not the
// public five-star ask the review wall already makes.
//
// Renders nothing when the owner has closed the box. Display only — POST
// /api/feedback re-reads the same switch and refuses on its own, so a
// hidden button is never the actual security boundary.
export default function FeedbackButton({
  lang,
  enabled,
  branchSlug,
  variant = 'card',
}: {
  lang: Lang
  enabled: boolean
  /** Which branch's page this button lives on, or null on the
   *  branch-picker portal before one is chosen. */
  branchSlug: string | null
  variant?: 'card' | 'link'
}) {
  const [open, setOpen] = useState(false)
  if (!enabled) return null

  return (
    <>
      {variant === 'link' ? (
        <button
          type="button"
          className="press"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          style={linkBtn}
        >
          {FEEDBACK_UI.open[lang]}
        </button>
      ) : (
        <button
          type="button"
          className="press"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          style={cardBtn}
        >
          <span style={icWrap} aria-hidden="true">
            <MessageCircle size={18} strokeWidth={1.8} />
          </span>
          <span style={{ flex: 1, textAlign: 'start' }}>{FEEDBACK_UI.open[lang]}</span>
        </button>
      )}

      <FeedbackSheet open={open} onClose={() => setOpen(false)} lang={lang} branchSlug={branchSlug} />
    </>
  )
}

const cardBtn: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 'var(--tap-min)',
  padding: '13px 16px',
  borderRadius: 15,
  border: '1px solid var(--line)',
  background: 'var(--bg-elev)',
  color: 'var(--text-dim)',
  fontWeight: 600,
  fontSize: '0.95rem',
  fontFamily: 'inherit',
  cursor: 'pointer',
  width: '100%',
}

const icWrap: CSSProperties = { width: 26, display: 'grid', placeItems: 'center', color: 'var(--text-faint)', flex: '0 0 auto' }

const linkBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  padding: '0 12px',
  border: 0,
  background: 'none',
  color: 'var(--text-faint)',
  textDecoration: 'underline',
  font: 'inherit',
  fontSize: '0.78rem',
  cursor: 'pointer',
}
