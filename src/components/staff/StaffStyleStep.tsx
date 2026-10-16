'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { InlineError } from '@/components/shifts/ui'
import ThemePicker from '@/components/staff/ThemePicker'
import { haptic } from '@/lib/haptics'
import { DEFAULT_THEME, type StaffTheme } from '@/lib/staff/theme'
import { saveTheme } from '@/lib/staff/theme-client'

// The wizard's "style" step (owner, 2026-10-17): five looks, tried on the real screen as they are tapped. "שמירה והמשך" keeps the one
// shown; "דילוג" leaves the default and the home asks again later. It is never a dead end: a failed save still lets the person go on.
export default function StaffStyleStep({ initial, onDone }: { initial: StaffTheme | null; onDone: () => void }) {
  const router = useRouter()
  const [theme, setTheme] = useState<StaffTheme>(initial ?? DEFAULT_THEME)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [])

  async function keep() {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await saveTheme(theme)
    if (!result.ok) { setError(result.message); setBusy(false); return }
    haptic('impact')
    router.refresh()
    onDone()
  }

  return (
    <section className="ob-style" aria-labelledby="style-h">
      <h1 id="style-h" ref={headingRef} tabIndex={-1}>איך תרצו שזה ייראה?</h1>
      <p className="ob-lead">בחרו סגנון. אפשר לנסות כמה שרוצים, המסך משתנה מיד, ולהחליף בכל זמן בפרופיל.</p>
      <ThemePicker value={theme} onSelect={(next) => { setTheme(next); setError(null) }} />
      {error && <InlineError>{error}</InlineError>}
      <div className="ob-actions">
        <button type="button" className="sch-btn press" disabled={busy} onClick={onDone}>דילוג</button>
        <button type="button" className="sch-btn sch-btn--primary press" style={{ flex: 1 }} disabled={busy} onClick={() => void keep()}>{busy ? 'שומר…' : 'שמירה והמשך'}</button>
      </div>
    </section>
  )
}
