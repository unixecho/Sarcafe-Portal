'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Palette } from 'lucide-react'
import ThemePicker from '@/components/staff/ThemePicker'
import { THEMES, type StaffTheme } from '@/lib/staff/theme'
import { saveTheme } from '@/lib/staff/theme-client'
import '@/components/shifts/schedule.css'

// "מראה האפליקציה" on the profile: the same five looks, saved the moment one is tapped (and the whole screen changes at once).
/** `bare`: inside a dialog (the home screens' look row): no heading of its own. `onChosen`: told when a look was saved. */
export default function ProfileStyle({ initial, bare = false, onChosen }: { initial: StaffTheme | null; bare?: boolean; onChosen?: (theme: StaffTheme) => void }) {
  const router = useRouter()
  const [theme, setTheme] = useState<StaffTheme | null>(initial)
  const [status, setStatus] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  async function choose(next: StaffTheme) {
    setTheme(next)
    setStatus(null)
    const result = await saveTheme(next)
    if (result.ok) {
      setStatus({ tone: 'ok', text: `נשמר: ${THEMES.find((item) => item.id === next)?.name}` })
      onChosen?.(next)
      router.refresh()
    } else {
      setStatus({ tone: 'bad', text: result.message })
    }
  }

  return (
    <section id={bare ? undefined : 'style'} className="sch-wrap" aria-labelledby={bare ? undefined : 'style-title'} style={bare ? undefined : { marginBlock: '20px 8px', scrollMarginTop: 90 }}>
      {!bare && <div className="sch-row"><Palette size={19} aria-hidden="true" /><h2 id="style-title" className="sch-h">מראה האפליקציה</h2></div>}
      <p className="sch-sub">בחרו איך האפליקציה נראית אצלכם. זה משפיע רק על המסכים שלכם.</p>
      <ThemePicker value={theme} onSelect={(next) => void choose(next)} />
      <p className="sp__status" role="status" aria-live="polite" style={status?.tone === 'bad' ? { color: 'var(--danger)' } : undefined}>{status?.text ?? ''}</p>
    </section>
  )
}
