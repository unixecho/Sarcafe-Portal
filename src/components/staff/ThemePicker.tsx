'use client'

import { useEffect } from 'react'
import { Check } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { THEMES, type StaffTheme } from '@/lib/staff/theme'
import { THEME_EVENT } from '@/components/staff/ThemeScope'
import '@/components/app/staff-themes.css'
import '@/components/staff/style-picker.css'

const MONO_FONT = 'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap'

/** One look, drawn small in its own colours: a header line, the shift card with a time, a progress line and the checklist button. */
function Miniature({ id }: { id: StaffTheme }) {
  return (
    <span className="tp" data-staff-theme={id} aria-hidden="true">
      <span className="tp__top"><span className="tp__dot tp__dot--on" /><span className="tp__title" /><span className="tp__dot" /></span>
      <span className="tp__card">
        <span className="tp__pill">במשמרת עכשיו</span>
        <span className="tp__time">07:00–13:00</span>
        <span className="tp__bar"><span /></span>
        <span className="tp__cta">הגשת צ׳קליסט</span>
      </span>
    </span>
  )
}

/** The five looks as a radio group. Choosing one changes the whole screen at once (the app's tokens are swapped in the browser) so the
 *  person sees it for real; saving is the caller's job (the wizard saves on "continue", the profile saves on every choice). */
export default function ThemePicker({ value, onSelect, label = 'סגנון האפליקציה' }: { value: StaffTheme | null; onSelect: (theme: StaffTheme) => void; label?: string }) {
  // The "shift pass" look uses a monospace face for its numbers; load it once the picker is open so its miniature is drawn right.
  useEffect(() => {
    if (document.querySelector('link[data-staff-mono]')) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = MONO_FONT
    link.setAttribute('data-staff-mono', '1')
    document.head.appendChild(link)
  }, [])

  function choose(id: StaffTheme) {
    haptic('select')
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: id }))
    onSelect(id)
  }

  return (
    <div className="sp" role="radiogroup" aria-label={label}>
      {THEMES.map((item) => {
        const on = value === item.id
        return (
          <button key={item.id} type="button" role="radio" aria-checked={on} className="sp__item press" onClick={() => choose(item.id)}>
            <span className="sp__thumb"><Miniature id={item.id} /></span>
            <span className="sp__copy">
              <span className="sp__name">{item.name}<span className="sp__mode">{item.mode === 'light' ? 'בהיר' : 'כהה'}</span>{on && <span className="sp__check"><Check size={14} strokeWidth={3} aria-hidden="true" /></span>}</span>
              <span className="sp__blurb">{item.blurb}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
