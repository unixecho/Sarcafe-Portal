'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { InlineError } from '@/components/shifts/ui'
import { messageOf } from '@/components/staff/types'
import { haptic } from '@/lib/haptics'
import { STAFF_AVATARS } from '@/lib/staff/avatar'
import { NAME_MAX, normalizePhone, suggestEmoji } from '@/lib/staff/profile'

// The wizard's "my details" step: name, phone and avatar emoji. It opens filled in with what the owner typed and an emoji
// already suggested, so "המשך" alone is enough; "דילוג" keeps everything as it is. Saves through PATCH /api/staff/profile,
// which edits only this person's own row.
export default function StaffProfileStep({ firstName, lastName, emoji: initialEmoji = null, onDone }: { firstName: string; lastName: string; emoji?: string | null; onDone: () => void }) {
  const [first, setFirst] = useState(firstName)
  const [last, setLast] = useState(lastName)
  const [phone, setPhone] = useState('')
  // The emoji the owner's roster already gave this person (random at creation); a suggestion only when there is none.
  const [emoji, setEmoji] = useState<string>(() => initialEmoji ?? suggestEmoji([]))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [])

  const phoneBad = phone.trim() !== '' && normalizePhone(phone) === null

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy || !first.trim() || phoneBad) return
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/staff/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: first, lastName: last, phone: phone.trim() ? phone : null, emoji }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(messageOf(payload, 'לא הצלחנו לשמור. נסו שוב או דלגו.'))
      haptic('impact')
      onDone()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'בעיית חיבור. נסו שוב.')
      setBusy(false)
    }
  }

  return (
    <form className="ob-details" onSubmit={(e) => void save(e)} aria-labelledby="details-h">
      <h1 id="details-h" ref={headingRef} tabIndex={-1}>הפרטים שלי</h1>
      <p className="ob-lead">כך יראו אתכם בסידור ובצ׳קליסטים. אפשר לשנות בכל זמן.</p>
      <div className="ob-preview" aria-hidden="true"><span className="ob-preview__avatar">{emoji}</span><strong>{[first, last].filter((x) => x.trim()).join(' ') || 'השם שלכם'}</strong></div>
      <div className="onboard__group">
        <label><span>שם פרטי</span><input className="sch-input" value={first} maxLength={NAME_MAX} autoComplete="given-name" onChange={(e) => setFirst(e.target.value)} required /></label>
        <label><span>שם משפחה</span><input className="sch-input" value={last} maxLength={NAME_MAX} autoComplete="family-name" onChange={(e) => setLast(e.target.value)} /></label>
        <label><span>טלפון (לא חובה)</span><input className="sch-input" type="tel" inputMode="tel" dir="ltr" value={phone} autoComplete="tel" placeholder="050-1234567" onChange={(e) => setPhone(e.target.value)} aria-invalid={phoneBad} style={{ textAlign: 'start' }} /></label>
        {phoneBad && <p className="onboard__hint" role="alert">מספר הטלפון לא נראה תקין. למשל 050-1234567.</p>}
      </div>
      <fieldset className="ob-emojis">
        <legend>בחרו אימוג׳י</legend>
        <div role="radiogroup" aria-label="אימוג׳י לפרופיל">
          {STAFF_AVATARS.map((item) => (
            <button key={item} type="button" role="radio" aria-checked={emoji === item} aria-label={item} className={`ob-emoji press${emoji === item ? ' ob-emoji--on' : ''}`} onClick={() => { setEmoji(item); haptic('select') }}>{item}</button>
          ))}
        </div>
      </fieldset>
      {error && <InlineError>{error}</InlineError>}
      <div className="ob-actions">
        <button type="button" className="sch-btn press" disabled={busy} onClick={onDone}>דילוג</button>
        <button type="submit" className="sch-btn sch-btn--primary press" style={{ flex: 1 }} disabled={busy || !first.trim() || phoneBad}>{busy ? 'שומר…' : 'שמירה והמשך'}</button>
      </div>
    </form>
  )
}
