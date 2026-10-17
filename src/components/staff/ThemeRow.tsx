'use client'

import { useState } from 'react'
import { ChevronLeft, Palette, X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import ProfileStyle from '@/components/staff/ProfileStyle'
import { THEMES, THEME_ROW_ID, type StaffTheme } from '@/lib/staff/theme'
import '@/components/shifts/schedule.css'

// The "מראה האפליקציה" row on the home screens (owner, 2026-10-17: no redirect for a setting). Tapping it opens the five looks in a dialog right
// there; the choice is saved on every tap and the row updates behind it. (The first-login notice's "take me there" scrolls to this row and marks it.)
export default function ThemeRow({ theme, chosen }: { theme: StaffTheme; chosen: boolean }) {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState<{ theme: StaffTheme; chosen: boolean }>({ theme, chosen })
  const name = THEMES.find((item) => item.id === now.theme)?.name
  return (
    <>
      <button id={THEME_ROW_ID} type="button" className="app-row app-row--quiet app-install-trigger" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span className="app-row__icon"><Palette size={22} aria-hidden="true" /></span>
        <span className="app-row__copy"><strong>מראה האפליקציה</strong><small>{name}{now.chosen ? ' · לחצו לשינוי' : ' · עוד לא בחרתם. לחצו לבחירת סגנון'}</small></span>
        {!now.chosen && <span className="app-row__new">חדש</span>}
        <span className="app-row__spot" aria-hidden="true">לחצו כאן</span>
        <ChevronLeft size={18} className="app-row__chevron" aria-hidden="true" />
      </button>
      <SheetShell open={open} onClose={() => setOpen(false)} labelledBy="theme-sheet-title" className="sch-sheet">
        <div className="sch-sheet__head">
          <h2 id="theme-sheet-title" className="sch-sheet__title">מראה האפליקציה</h2>
          <button type="button" className="sch-iconbtn press" onClick={() => setOpen(false)} aria-label="סגירה"><X size={20} aria-hidden="true" /></button>
        </div>
        <div className="sheet-scroll">
          <ProfileStyle initial={now.chosen ? now.theme : null} bare onChosen={(next) => setNow({ theme: next, chosen: true })} />
        </div>
      </SheetShell>
    </>
  )
}
