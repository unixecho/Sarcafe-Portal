'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { MAX_VOTES, SUGGESTION_MAX } from '@/lib/kiosk/content-schema'

// The "what should the cart offer" poll. Votes (up to three), an optional 1-5 rating and an optional suggestion; no
// name, phone or e-mail is asked for and nothing is kept on the device (no storage, no cookie). Everything is rendered
// as React text. A clear button empties it, and after a quiet minute and a half it empties itself, so a phone left on
// the counter (or the kiosk, should it ever open this page) never shows the last person's answer.

type Option = { id: string; label: string }

const T = {
  eyebrow: 'שרקפה · גבעת חביבה',
  title: 'מה תרצו שהעגלה תגיש?',
  intro: `בחרו עד ${MAX_VOTES} דברים שהייתם רוצים למצוא אצלנו. אפשר גם לדרג ולכתוב הצעה משלכם.`,
  votes: 'הצבעה',
  votesHint: (left: number) => (left === 0 ? 'בחרתם את המקסימום' : `אפשר לבחור עוד ${left}`),
  rating: 'איך הייתה החוויה היום? (לא חובה)',
  star: (n: number) => `${n} מתוך 5`,
  suggestion: 'הצעה משלכם (לא חובה)',
  placeholder: 'משקה, מאפה, רעיון לאירוע…',
  send: 'שליחה',
  sending: 'שולח…',
  clear: 'ניקוי',
  privacy: 'בלי שם, בלי טלפון ובלי פרטים מזהים. רק התשובה עצמה נשמרת.',
  thanks: 'תודה! התשובה התקבלה.',
  thanksSub: 'אנחנו קוראים כל הצעה.',
  again: 'תשובה נוספת',
  noOptions: 'כרגע אין אפשרויות להצבעה, אבל אפשר לדרג ולכתוב הצעה.',
  errEmpty: 'בחרו לפחות אפשרות אחת, דירוג או הצעה.',
  errRate: 'נשלחו הרבה תשובות בזמן קצר. נסו שוב מאוחר יותר.',
  errOptions: 'רשימת האפשרויות התעדכנה. רעננו את הדף ונסו שוב.',
  errGeneric: 'השליחה לא הצליחה. נסו שוב.',
}

const IDLE_CLEAR_MS = 90_000

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export default function PollForm({ options }: { options: Option[] }) {
  const [picked, setPicked] = useState<string[]>([])
  const [rating, setRating] = useState<number | null>(null)
  const [suggestion, setSuggestion] = useState('')
  const [website, setWebsite] = useState('')
  const [requestId, setRequestId] = useState<string>('')
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errRef = useRef<HTMLParagraphElement>(null)
  const thanksRef = useRef<HTMLHeadingElement>(null)

  const clear = useCallback(() => {
    setPicked([])
    setRating(null)
    setSuggestion('')
    setWebsite('')
    setErr(null)
    setState('idle')
    setRequestId(newRequestId())
  }, [])

  // a request id per answer, minted on the client after hydration (never during the server render)
  useEffect(() => { setRequestId(newRequestId()) }, [])

  const dirty = picked.length > 0 || rating !== null || suggestion.trim() !== '' || state === 'done'
  const touch = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(clear, IDLE_CLEAR_MS)
  }, [clear])
  useEffect(() => {
    if (!dirty) {
      if (idleTimer.current) clearTimeout(idleTimer.current)
      return
    }
    touch()
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current) }
  }, [dirty, picked, rating, suggestion, state, touch])

  useEffect(() => { if (err) errRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [err])
  useEffect(() => { if (state === 'done') thanksRef.current?.focus() }, [state])

  function toggle(id: string) {
    setErr(null)
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_VOTES ? prev : [...prev, id]))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (state === 'sending') return
    if (picked.length === 0 && rating === null && suggestion.trim() === '') {
      setErr(T.errEmpty)
      return
    }
    setState('sending')
    setErr(null)
    try {
      const res = await fetch('/api/kiosk/content/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionIds: picked, suggestion, rating, requestId: requestId || newRequestId(), website }),
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (res.ok && data?.ok) {
        setState('done')
        return
      }
      setState('idle')
      setErr(data?.error === 'rate_limited' ? T.errRate : data?.error === 'empty' ? T.errEmpty : data?.error === 'bad_option' ? T.errOptions : T.errGeneric)
    } catch {
      setState('idle')
      setErr(T.errGeneric)
    }
  }

  if (state === 'done') {
    return (
      <section className="rise" style={card} aria-live="polite">
        <h1 ref={thanksRef} tabIndex={-1} style={{ ...h1, outline: 'none' }}>{T.thanks}</h1>
        <p style={lead}>{T.thanksSub}</p>
        <button type="button" className="press" onClick={clear} style={{ ...secondary, marginTop: 18, width: '100%' }}>{T.again}</button>
      </section>
    )
  }

  const left = MAX_VOTES - picked.length
  return (
    <form className="rise" style={card} onSubmit={submit} onInput={touch} noValidate>
      <p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-faint)', letterSpacing: '0.02em' }}>{T.eyebrow}</p>
      <h1 style={h1}>{T.title}</h1>
      <p style={lead}>{T.intro}</p>

      <fieldset style={fieldset}>
        <legend style={legend}>{T.votes}</legend>
        {options.length === 0 ? (
          <p style={hint}>{T.noOptions}</p>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {options.map((option) => {
                const on = picked.includes(option.id)
                const blocked = !on && left === 0
                return (
                  <button
                    key={option.id}
                    type="button"
                    className="press"
                    aria-pressed={on}
                    aria-disabled={blocked}
                    onClick={() => toggle(option.id)}
                    style={{ ...chip, ...(on ? chipOn : null), opacity: blocked ? 0.5 : 1 }}
                  >
                    {on ? '✓ ' : ''}{option.label}
                  </button>
                )
              })}
            </div>
            <p style={hint} aria-live="polite">{T.votesHint(left)}</p>
          </>
        )}
      </fieldset>

      <fieldset style={fieldset}>
        <legend style={legend}>{T.rating}</legend>
        <div style={{ display: 'flex', gap: 6 }} dir="ltr">
          {[1, 2, 3, 4, 5].map((n) => {
            const on = rating !== null && n <= rating
            return (
              <button
                key={n}
                type="button"
                className="press"
                aria-label={T.star(n)}
                aria-pressed={rating === n}
                onClick={() => { setErr(null); setRating(rating === n ? null : n) }}
                style={{ ...star, color: on ? 'var(--neon)' : 'var(--text-faint)', borderColor: on ? 'var(--neon)' : 'var(--line-interactive)' }}
              >
                ★
              </button>
            )
          })}
        </div>
      </fieldset>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 18 }}>
        <span style={legend}>{T.suggestion}</span>
        <textarea
          value={suggestion}
          onChange={(e) => { setErr(null); setSuggestion(e.target.value.slice(0, SUGGESTION_MAX)) }}
          maxLength={SUGGESTION_MAX}
          rows={4}
          placeholder={T.placeholder}
          autoComplete="off"
          style={textarea}
        />
        <span style={{ ...hint, alignSelf: 'flex-end', fontVariantNumeric: 'tabular-nums' }} aria-live="polite">{suggestion.length}/{SUGGESTION_MAX}</span>
      </label>

      {/* Honeypot: hidden from people and from assistive technology; a bot fills it. */}
      <div aria-hidden="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', insetInlineStart: -9999 }}>
        <label>
          אתר
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>

      {err && <p ref={errRef} role="alert" style={{ color: 'var(--danger)', fontSize: '0.88rem', margin: '14px 0 0', lineHeight: 1.5 }}>{err}</p>}

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button type="submit" className="press" disabled={state === 'sending'} style={{ ...primary, flex: 1, opacity: state === 'sending' ? 0.7 : 1 }}>
          {state === 'sending' ? T.sending : T.send}
        </button>
        <button type="button" className="press" onClick={clear} style={secondary}>{T.clear}</button>
      </div>
      <p style={{ ...hint, marginTop: 14 }}>{T.privacy}</p>
    </form>
  )
}

const card: CSSProperties = {
  position: 'relative',
  background: 'var(--glass)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '22px 18px',
  color: 'var(--text)',
}
const h1: CSSProperties = { margin: '6px 0 0', fontSize: '1.45rem', fontWeight: 800, lineHeight: 1.25, color: 'var(--text)' }
const lead: CSSProperties = { margin: '8px 0 0', fontSize: '0.95rem', lineHeight: 1.55, color: 'var(--text-dim)' }
const fieldset: CSSProperties = { border: 0, padding: 0, margin: '20px 0 0', minInlineSize: 0 }
const legend: CSSProperties = { padding: 0, marginBottom: 10, fontSize: '0.92rem', fontWeight: 800, color: 'var(--text)' }
const hint: CSSProperties = { margin: '8px 0 0', fontSize: '0.8rem', color: 'var(--text-faint)', lineHeight: 1.5 }
const chip: CSSProperties = {
  minHeight: 'var(--tap-min)', padding: '9px 14px', borderRadius: 999, fontFamily: 'inherit', fontSize: '0.92rem', fontWeight: 700,
  color: 'var(--text)', background: 'var(--bg-elev-2)', border: '1px solid var(--line-interactive)', cursor: 'pointer',
}
const chipOn: CSSProperties = { background: 'var(--neon-soft)', borderColor: 'var(--neon)', color: 'var(--text)' }
const star: CSSProperties = {
  width: 48, height: 48, borderRadius: 12, fontSize: '1.45rem', lineHeight: 1, background: 'var(--bg-elev-2)',
  border: '1px solid var(--line-interactive)', cursor: 'pointer', fontFamily: 'inherit',
}
const textarea: CSSProperties = {
  width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 100, padding: '11px 12px', borderRadius: 12,
  fontFamily: 'inherit', fontSize: '1rem', lineHeight: 1.5, color: 'var(--text)', background: 'var(--bg-elev)',
  border: '1px solid var(--line-interactive)',
}
const primary: CSSProperties = {
  minHeight: 'var(--tap-min)', padding: '12px 16px', borderRadius: 14, border: 0, fontFamily: 'inherit', fontSize: '1rem',
  fontWeight: 800, color: 'var(--bg)', background: 'var(--neon)', cursor: 'pointer',
}
const secondary: CSSProperties = {
  minHeight: 'var(--tap-min)', padding: '12px 16px', borderRadius: 14, fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 700,
  color: 'var(--text)', background: 'var(--bg-elev-2)', border: '1px solid var(--line-strong)', cursor: 'pointer',
}
