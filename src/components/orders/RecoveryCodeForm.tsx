'use client'

import { useState, type CSSProperties, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { haptic } from '@/lib/haptics'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_code: 'הקוד שגוי או שפג תוקפו.',
  rate_limited: 'יותר מדי ניסיונות — נסו שוב בעוד כמה דקות.',
}

export default function RecoveryCodeForm() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (code.length !== 6 || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/order/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recoveryCode: code }),
      })
      const payload = await res.json()
      if (!res.ok) {
        haptic('impact')
        setError(ERROR_MESSAGES[payload?.error?.code] ?? 'משהו השתבש. נסו שוב.')
        setSubmitting(false)
        return
      }
      haptic('select')
      router.push(`/order/${payload.token}`)
    } catch {
      setError('בעיית רשת — נסו שוב.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label htmlFor="recovery-code" className="sr-only">
        קוד שחזור בן 6 ספרות
      </label>
      <input
        id="recovery-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d*"
        maxLength={6}
        value={code}
        onChange={(e) => {
          setError(null)
          setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
        }}
        placeholder="000000"
        style={inputStyle}
      />
      {error && (
        <p role="alert" style={{ margin: 0, color: '#ff6b6b', fontSize: '0.82rem', textAlign: 'center' }}>
          {error}
        </p>
      )}
      <button type="submit" className="press" disabled={code.length !== 6 || submitting} style={submitBtnStyle(code.length === 6 && !submitting)}>
        {submitting ? 'בודק…' : 'כניסה'}
      </button>
    </form>
  )
}

const inputStyle: CSSProperties = {
  width: '100%',
  minHeight: 64,
  borderRadius: 16,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  textAlign: 'center',
  fontSize: '2rem',
  fontWeight: 800,
  letterSpacing: '0.3em',
  fontVariantNumeric: 'tabular-nums',
  direction: 'ltr',
}

function submitBtnStyle(enabled: boolean): CSSProperties {
  return {
    minHeight: 'var(--tap-min)',
    borderRadius: 999,
    border: 'none',
    background: enabled ? 'var(--neon)' : 'var(--bg-elev-2)',
    color: enabled ? 'var(--bg)' : 'var(--text-faint)',
    fontWeight: 800,
    fontSize: '0.95rem',
    cursor: enabled ? 'pointer' : 'not-allowed',
  }
}
