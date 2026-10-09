'use client'

// Quick login — employee number + 6-digit passcode (blueprint §1a.5).
//
// An OPTION below the Google door, for a shared station tablet; Google stays the
// default. Two exports: <QuickLogin> (the login panel) and <PasscodeEntry> (the dots +
// numeric keypad, also used by the person's own code sheet so both feel identical).
//
// Why the keypad is a real UI and not a text field: a tablet at a till should never
// raise the OS keyboard, and an employee in a rush needs 56px+ targets. A hidden
// input (inputMode="none") still receives a hardware keyboard and paste, so nothing
// is lost for a desk with a keyboard.
//
// The dots never show digits, and a wrong guess clears the code but KEEPS the number:
// the typo is almost always in the code.

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Delete } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { useT } from '@/lib/pos/useT'

const CODE_LENGTH = 6

const CSS = `
.qk-dots { display: flex; justify-content: center; gap: 14px; }
.qk-dot {
  inline-size: 18px; block-size: 18px; border-radius: 50%;
  border: 2px solid var(--line-interactive, rgba(255,255,255,0.4));
  background: transparent;
  transition: background-color 0.12s var(--ease), border-color 0.12s var(--ease), transform 0.12s var(--ease);
}
.qk-dot--on { background: var(--neon); border-color: var(--neon); transform: scale(1.08); }
.qk-dots--bad .qk-dot { border-color: var(--danger, #ff6b6b); }
.qk-dots--bad .qk-dot--on { background: var(--danger, #ff6b6b); }
.qk-shake { animation: qk-shake 0.36s var(--ease); }
@keyframes qk-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-9px); }
  40% { transform: translateX(8px); }
  60% { transform: translateX(-6px); }
  80% { transform: translateX(4px); }
}
.qk-pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; inline-size: 100%; max-inline-size: 300px; margin-inline: auto; }
.qk-key {
  min-block-size: 64px; border-radius: 16px; border: 1px solid var(--line-interactive, rgba(255,255,255,0.25));
  background: var(--bg-elev-2); color: var(--text); font-size: 1.6rem; font-weight: 700;
  display: grid; place-items: center; cursor: pointer; font-family: inherit;
}
.qk-key:focus-visible { outline: 3px solid var(--neon); outline-offset: 3px; }
.qk-sink:focus-visible + .qk-dots-wrap .qk-dots { outline: 3px solid var(--neon); outline-offset: 8px; border-radius: 999px; }
.qk-key[disabled] { opacity: 0.5; cursor: not-allowed; }
.qk-key--ghost { background: transparent; border-color: transparent; }
.qk-sink { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; pointer-events: none; }
.qk-field {
  inline-size: 100%; min-block-size: 64px; padding: 0 16px; border-radius: 16px; text-align: center;
  border: 1px solid var(--line-interactive, rgba(255,255,255,0.25)); background: var(--bg-elev); color: var(--text);
  font-size: 1.7rem; font-weight: 700; letter-spacing: 0.08em; font-family: inherit;
}
.qk-field:focus-visible { outline: 3px solid var(--neon); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .qk-shake { animation: none; }
  .qk-dot { transition: none; }
}
`

type EntryProps = {
  value: string
  onChange: (next: string) => void
  /** fired once when the 6th digit lands (key, hardware keyboard or paste) */
  onComplete: (code: string) => void
  disabled?: boolean
  invalid?: boolean
  /** bump to replay the gentle shake */
  shakeKey?: number
  /** the visible label's text, wired to the hidden input as its accessible name */
  label: string
}

/** The six dots and the numeric keypad. Controlled; the parent owns the digits. */
export function PasscodeEntry({ value, onChange, onComplete, disabled, invalid, shakeKey = 0, label }: EntryProps) {
  const t = useT()
  const labelId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const apply = useCallback(
    (next: string) => {
      const clean = next.replace(/\D/g, '').slice(0, CODE_LENGTH)
      if (clean === value) return
      onChange(clean)
      if (clean.length === CODE_LENGTH) onComplete(clean)
    },
    [value, onChange, onComplete]
  )

  const press = (digit: string) => {
    if (disabled) return
    haptic('tick')
    apply(value + digit)
  }
  const erase = () => {
    if (disabled) return
    haptic('tick')
    apply(value.slice(0, -1))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center', position: 'relative' }}>
      <style>{CSS}</style>
      <span id={labelId} style={{ fontWeight: 700, fontSize: '0.95rem' }}>
        {label}
      </span>
      {/* Receives a hardware keyboard and paste; inputMode none keeps the OS keyboard away. */}
      <input
        ref={inputRef}
        className="qk-sink"
        type="password"
        inputMode="none"
        autoComplete="off"
        aria-labelledby={labelId}
        value={value}
        disabled={disabled}
        onChange={(e) => apply(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Backspace') {
            e.preventDefault()
            erase()
          }
        }}
      />
      <div key={shakeKey} className={`qk-dots-wrap${shakeKey > 0 ? ' qk-shake' : ''}`}>
        <div
          className={`qk-dots${invalid ? ' qk-dots--bad' : ''}`}
          role="img"
          aria-label={t('me.quick.login.progress', { n: value.length })}
          onClick={() => inputRef.current?.focus()}
        >
          {Array.from({ length: CODE_LENGTH }, (_, i) => (
            <span key={i} className={`qk-dot${i < value.length ? ' qk-dot--on' : ''}`} />
          ))}
        </div>
      </div>
      <div className="qk-pad" dir="ltr">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="qk-key press" disabled={disabled} onClick={() => press(d)}>
            <span className="ltr-isolate">{d}</span>
          </button>
        ))}
        <span aria-hidden="true" />
        <button type="button" className="qk-key press" disabled={disabled} onClick={() => press('0')}>
          <span className="ltr-isolate">0</span>
        </button>
        <button
          type="button"
          className="qk-key qk-key--ghost press"
          disabled={disabled || value.length === 0}
          onClick={erase}
          aria-label={t('me.quick.login.delete')}
        >
          <Delete size={26} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

export default function QuickLogin({ next = '/staff' }: { next?: '/pos' | '/staff' | '/staff/checklists' | '/staff/schedule' }) {
  const t = useT()
  const router = useRouter()
  const numberId = useId()
  const errorId = useId()
  const numberRef = useRef<HTMLInputElement>(null)
  const [employeeNo, setEmployeeNo] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(0)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const submit = useCallback(
    async (finalCode: string) => {
      const no = employeeNo.trim()
      if (!/^\d{1,5}$/.test(no) || !/[1-9]/.test(no)) {
        // The code stays: only the missing number needs fixing.
        setError(t('me.quick.login.needNumber'))
        numberRef.current?.focus()
        return
      }
      setBusy(true)
      setError(null)
      let message: string | null = null
      try {
        const res = await fetch('/api/auth/quick-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeNo: no, passcode: finalCode, next }),
        })
        if (res.ok) {
          const payload = (await res.json().catch(() => null)) as { next?: string } | null
          router.replace(payload?.next || next)
          router.refresh()
          return
        }
        message = res.status === 401 ? t('me.quick.login.wrong') : res.status === 429 ? t('me.quick.login.locked') : t('me.quick.login.failed')
      } catch {
        message = t('me.quick.login.failed')
      }
      if (!aliveRef.current) return
      // Wrong guess: clear the code, keep the number.
      setCode('')
      setError(message)
      setShake((n) => n + 1)
      setBusy(false)
    },
    [employeeNo, next, router, t]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, textAlign: 'center' }} aria-busy={busy}>
      <p style={{ margin: 0, color: 'var(--text-faint)', fontSize: '0.82rem' }}>{t('me.quick.login.hint')}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label htmlFor={numberId} style={{ fontWeight: 700, fontSize: '0.95rem' }}>
          {t('me.quick.login.number')}
        </label>
        <input
          ref={numberRef}
          id={numberId}
          className="qk-field ltr-isolate"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={5}
          autoComplete="off"
          dir="ltr"
          value={employeeNo}
          disabled={busy}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error === t('me.quick.login.needNumber') ? true : undefined}
          onChange={(e) => {
            setEmployeeNo(e.target.value.replace(/\D/g, '').slice(0, 5))
            if (error) setError(null)
          }}
        />
      </div>

      <PasscodeEntry
        label={t('me.quick.login.code')}
        value={code}
        onChange={(next) => {
          setCode(next)
          if (error && next.length > 0) setError(null)
        }}
        onComplete={(finalCode) => void submit(finalCode)}
        disabled={busy}
        invalid={error !== null && error !== t('me.quick.login.needNumber')}
        shakeKey={shake}
      />

      <p
        id={errorId}
        role="alert"
        style={{ margin: 0, minHeight: '1.4em', color: 'var(--danger, #ff6b6b)', fontSize: '0.9rem', fontWeight: 600 }}
      >
        {busy ? <span style={{ color: 'var(--text-dim)' }}>{t('me.quick.login.entering')}</span> : error}
      </p>
    </div>
  )
}
