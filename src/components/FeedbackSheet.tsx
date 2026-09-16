'use client'

import { useEffect, useId, useState, type CSSProperties } from 'react'
import SheetShell from '@/components/SheetShell'
import { FEEDBACK_UI, feedbackErrorText } from '@/lib/feedback/i18n'
import { FEEDBACK_CATEGORIES, MAX_EMAIL_LEN, MAX_MESSAGE_LEN, MIN_MESSAGE_LEN, type FeedbackCategory } from '@/lib/feedback/types'
import type { Lang } from '@/lib/menu/types'

// The customer feedback form — adapted from AyekaBar's FeedbackSheet.tsx,
// simplified to Sarcafe's own SheetShell/`.sheet-scroll`/`.press`/`.rise`
// primitives instead of porting AyekaBar's bespoke `.fb-*` motion CSS
// (shake-on-error, scale-out-then-replace) — same validation and privacy
// posture, lighter chrome.
//
// Everything typed here is re-checked server-side by
// lib/feedback/validate.ts; these checks exist so the customer finds out
// before the round trip, not because the server trusts them.

function currentPagePath(): string | null {
  if (typeof window === 'undefined') return null
  return `${window.location.pathname}${window.location.hash}` || null
}

type Phase = 'form' | 'sent'

export default function FeedbackSheet({
  open,
  onClose,
  lang,
  branchSlug,
}: {
  open: boolean
  onClose: () => void
  lang: Lang
  branchSlug: string | null
}) {
  const t = (k: keyof typeof FEEDBACK_UI) => FEEDBACK_UI[k][lang]
  const ids = useId()
  const titleId = `${ids}-title`

  const [category, setCategory] = useState<FeedbackCategory>('business')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  // The honeypot's own state, kept controlled so it always posts a defined
  // value — see the field itself below.
  const [company, setCompany] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('form')

  // A fresh sheet every time it opens — otherwise a reopened sheet shows a
  // stale error, or the thank-you screen forever.
  useEffect(() => {
    if (!open) return
    setCategory('business')
    setMessage('')
    setEmail('')
    setCompany('')
    setBusy(false)
    setError(null)
    setPhase('form')
  }, [open])

  const trimmed = message.trim()
  const messageOk = trimmed.length >= MIN_MESSAGE_LEN && trimmed.length <= MAX_MESSAGE_LEN

  async function submit() {
    if (busy || !messageOk) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          message: trimmed,
          contactEmail: email.trim() || null,
          pageUrl: currentPagePath(),
          branchSlug,
          company,
        }),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !json?.ok) {
        setBusy(false)
        setError(feedbackErrorText(json?.error, lang))
        return
      }
      setBusy(false)
      setPhase('sent')
    } catch {
      setBusy(false)
      setError(feedbackErrorText(undefined, lang))
    }
  }

  const remaining = MAX_MESSAGE_LEN - message.length

  return (
    <SheetShell open={open} onClose={onClose} labelledBy={titleId}>
      {phase === 'sent' ? (
        <div className="rise" style={sentWrap}>
          <div aria-hidden="true" style={{ fontSize: '2.4rem', lineHeight: 1 }}>
            💬
          </div>
          <h2 id={titleId} style={sentTitle}>
            {t('thanksTitle')}
          </h2>
          <p style={sentBody}>{t('thanksBody')}</p>
          <button type="button" className="press" onClick={onClose} style={{ ...primaryBtn, width: '100%', maxWidth: 260 }}>
            {t('done')}
          </button>
        </div>
      ) : (
        <div>
          <div style={{ paddingBottom: 4 }}>
            <h2 id={titleId} style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>
              {t('title')}
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>{t('intro')}</p>
          </div>

          <div className="sheet-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 14 }}>
            <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
              <legend style={legend}>{t('categoryLabel')}</legend>
              <div role="radiogroup" aria-label={t('categoryLabel')} style={{ display: 'grid', gap: 8 }}>
                {FEEDBACK_CATEGORIES.map((c) => {
                  const active = category === c
                  return (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className="press"
                      onClick={() => setCategory(c)}
                      style={{
                        ...choice,
                        borderColor: active ? 'var(--neon)' : 'var(--line-strong)',
                        background: active ? 'rgba(255,122,69,0.12)' : 'var(--bg-elev)',
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0, textAlign: 'start' }}>
                        <b style={{ display: 'block', fontSize: '0.92rem', fontWeight: 700 }}>{t(c)}</b>
                        <small style={{ display: 'block', fontSize: '0.74rem', color: 'var(--text-faint)', marginTop: 2, lineHeight: 1.4 }}>
                          {t(c === 'business' ? 'businessHint' : 'technicalHint')}
                        </small>
                      </span>
                    </button>
                  )
                })}
              </div>
            </fieldset>

            <div>
              <label htmlFor={`${ids}-msg`} style={label}>
                {t('messageLabel')}
              </label>
              <textarea
                id={`${ids}-msg`}
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_LEN))}
                placeholder={t('messagePlaceholder')}
                rows={5}
                maxLength={MAX_MESSAGE_LEN}
                required
                aria-describedby={error ? `${ids}-count ${ids}-error` : `${ids}-count`}
                style={textarea}
              />
              <div
                id={`${ids}-count`}
                style={{
                  fontSize: '0.72rem',
                  marginTop: 4,
                  textAlign: 'end',
                  color: remaining < 60 ? 'var(--neon-soft)' : 'var(--text-faint)',
                }}
              >
                <span dir="ltr">
                  {message.length} / {MAX_MESSAGE_LEN}
                </span>
              </div>
            </div>

            <div>
              <label htmlFor={`${ids}-email`} style={label}>
                {t('emailLabel')}
              </label>
              <input
                id={`${ids}-email`}
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value.slice(0, MAX_EMAIL_LEN))}
                placeholder={t('emailPlaceholder')}
                maxLength={MAX_EMAIL_LEN}
                dir="ltr"
                style={input}
              />
              <p style={hint}>{t('emailHint')}</p>
            </div>

            {/* The honeypot — off-canvas, not display:none (some bots skip
                hidden fields; some screen readers announce them anyway),
                out of the tab order, told not to autofill. A human never
                reaches it; anything non-empty here didn't come from one. */}
            <div aria-hidden="true" style={honeypotWrap}>
              <label htmlFor={`${ids}-company`}>Company</label>
              <input
                id={`${ids}-company`}
                name="company"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>

            <p style={{ ...hint, marginTop: 0 }}>{t('privacy')}</p>

            {error && (
              <p id={`${ids}-error`} role="alert" style={errorText}>
                {error}
              </p>
            )}
          </div>

          <div style={{ paddingTop: 12, display: 'flex', gap: 8 }}>
            <button type="button" className="press" onClick={onClose} style={{ ...secondaryBtn, flex: 1 }}>
              {t('close')}
            </button>
            <button
              type="button"
              className="press"
              onClick={submit}
              disabled={!messageOk}
              aria-busy={busy}
              style={{
                ...primaryBtn,
                flex: 2,
                opacity: messageOk ? (busy ? 0.75 : 1) : 0.45,
                cursor: busy ? 'progress' : 'pointer',
              }}
            >
              {busy ? t('sending') : t('submit')}
            </button>
          </div>
        </div>
      )}
    </SheetShell>
  )
}

const sentWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  minHeight: '34dvh',
  padding: '18px 4px 10px',
  textAlign: 'center',
}
const sentTitle: CSSProperties = { margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text)' }
const sentBody: CSSProperties = { margin: '0 0 8px', fontSize: '0.9rem', color: 'var(--text-dim)', lineHeight: 1.6, maxWidth: 320 }

const legend: CSSProperties = { padding: 0, marginBottom: 8, fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-dim)' }
const label: CSSProperties = { display: 'block', marginBottom: 6, fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-dim)' }
const hint: CSSProperties = { margin: '6px 2px 0', fontSize: '0.73rem', color: 'var(--text-faint)', lineHeight: 1.5 }
const errorText: CSSProperties = { margin: 0, color: '#ff6b6b', fontSize: '0.82rem', lineHeight: 1.5 }
const choice: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 11,
  width: '100%',
  minHeight: 'var(--tap-min)',
  padding: '12px 13px',
  borderRadius: 14,
  border: '1px solid var(--line-strong)',
  color: 'var(--text)',
  font: 'inherit',
  cursor: 'pointer',
}
const input: CSSProperties = {
  width: '100%',
  minHeight: 'var(--tap-min)',
  padding: '12px 13px',
  borderRadius: 12,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: '0.95rem',
  fontFamily: 'inherit',
}
const textarea: CSSProperties = { ...input, resize: 'vertical', minHeight: 110, lineHeight: 1.55 }
const primaryBtn: CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '14px 0',
  borderRadius: 14,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontSize: '0.95rem',
  fontWeight: 800,
  fontFamily: 'inherit',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}
const secondaryBtn: CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '14px 0',
  borderRadius: 14,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  fontSize: '0.95rem',
  fontWeight: 700,
  fontFamily: 'inherit',
  cursor: 'pointer',
}
const honeypotWrap: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
  padding: 0,
  margin: -1,
}
