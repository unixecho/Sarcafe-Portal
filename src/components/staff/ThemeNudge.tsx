'use client'

import { useId, useRef, useState } from 'react'
import { Palette } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { NUDGE_COOKIE, THEMES } from '@/lib/staff/theme'
import { spotlightThemeRow } from '@/lib/staff/theme-spot'
import '@/components/staff/theme-nudge.css'

/** This device remembers that the notice was read (a plain cookie, a year); the server then stops showing it. */
function rememberRead() {
  try {
    document.cookie = `${NUDGE_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`
  } catch { /* no cookies: the notice simply comes back next time */ }
}

// The first-login notice (owner, 2026-10-17): an employee who has not chosen a look is told about the five looks, and the notice stays until
// they tick "קראתי והבנתי" and close it. "קחו אותי לשם" also counts as read: it closes the notice, scrolls the home screen down to the
// "מראה האפליקציה" row and marks it. Escape and a tap outside only close it once it has been read; before that they nudge the checkbox.
export default function ThemeNudge() {
  const titleId = useId()
  const boxRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(true)
  const [read, setRead] = useState(false)
  const [refused, setRefused] = useState(false)

  function finish() {
    rememberRead()
    setOpen(false)
  }
  function close() {
    if (read) { finish(); return }
    setRefused(true)
    const box = boxRef.current
    box?.focus()
    // A short shake of the box, replayed on every refusal (not for people who asked for less motion).
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      box?.closest('label')?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-9px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
    }
  }
  function takeMeThere() {
    finish()
    // The sheet slides away first (and gives the page its scroll back), then the page scrolls to the row.
    window.setTimeout(spotlightThemeRow, 380)
  }

  return (
    <SheetShell open={open} onClose={close} labelledBy={titleId}>
      <div className="tn">
        <span className="tn__icon" aria-hidden="true"><Palette size={26} /></span>
        <h2 id={titleId} className="tn__title">חדש: בחרו איך האפליקציה נראית</h2>
        <p className="tn__lead">יש עכשיו חמישה סגנונות לאפליקציה: כהים וזוהרים, ובהירים שנקראים טוב בשמש. בחרו את זה שהכי נעים לכם. זה משפיע רק על המסכים שלכם, ואפשר להחליף בכל זמן.</p>
        <ul className="tn__looks" aria-label="הסגנונות">
          {THEMES.map((look) => (
            <li key={look.id}><span className="tn__dot" aria-hidden="true" style={{ background: `conic-gradient(${look.swatch.accent} 0 50%, ${look.swatch.ground} 0)` }} />{look.name}</li>
          ))}
        </ul>
        <label className={`tn__check${refused && !read ? ' tn__check--refused' : ''}`}>
          <input ref={boxRef} type="checkbox" checked={read} onChange={(event) => setRead(event.target.checked)} />
          <span>קראתי והבנתי</span>
        </label>
        <div className="tn__actions">
          <button type="button" className="tn__btn tn__btn--primary press" onClick={takeMeThere}><Palette size={19} aria-hidden="true" />קחו אותי לשם</button>
          <button type="button" className="tn__btn press" aria-disabled={!read} onClick={close}>סגירה</button>
        </div>
        <p className="tn__hint" role="status">{read ? 'אפשר לסגור.' : 'כדי לסגור, סמנו ״קראתי והבנתי״. או לחצו ״קחו אותי לשם״.'}</p>
      </div>
    </SheetShell>
  )
}
