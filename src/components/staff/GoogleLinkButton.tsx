'use client'

import { useId, useState } from 'react'
import { GoogleG } from '@/components/AuthHandoff'
import { InlineError } from '@/components/shifts/ui'
import { messageOf } from '@/components/staff/types'

/** A fresh onboarding proof skips PIN re-entry. Existing staff prove their PIN first. */
export default function GoogleLinkButton({ prepared = false }: { prepared?: boolean }) {
  const id = useId()
  const [needsPin, setNeedsPin] = useState(!prepared)
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function request(body: object) {
    const response = await fetch('/api/staff/google-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const payload = await response.json()
    if (!response.ok) {
      if (payload?.error?.code === 'proof_expired') setNeedsPin(true)
      throw new Error(messageOf(payload, 'לא הצלחנו לקשר את החשבון. נסו שוב.'))
    }
    return payload
  }
  async function start() {
    setBusy(true); setError(null)
    try {
      if (needsPin) { await request({ action: 'prepare', passcode }); setPasscode(''); setNeedsPin(false) }
      const payload = await request({ action: 'start' })
      window.location.assign(payload.url)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'בעיית חיבור. נסו שוב.'); setBusy(false) }
  }
  return <div className="sch-wrap" style={{ gap: 12 }}>
    {needsPin && <label htmlFor={id}>
      <span className="sch-label">הקוד האישי שלכם לאישור הקישור</span>
      <input id={id} className="sch-input" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="off" dir="ltr" value={passcode} onChange={(event) => setPasscode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" style={{ textAlign: 'center', letterSpacing: '.4em', fontSize: '1.15rem' }} />
    </label>}
    <button type="button" className="sch-btn sch-btn--primary press" disabled={busy || (needsPin && passcode.length !== 6)} onClick={() => void start()} style={{ minHeight: 52 }}><GoogleG />{busy ? 'פותח Google…' : 'קישור חשבון Google'}</button>
    {error && <InlineError>{error}</InlineError>}
  </div>
}
