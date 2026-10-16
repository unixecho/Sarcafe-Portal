'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Palette } from 'lucide-react'
import ThemePicker from '@/components/staff/ThemePicker'
import { THEMES, type StaffTheme } from '@/lib/staff/theme'
import { saveTheme } from '@/lib/staff/theme-client'
import '@/components/shifts/schedule.css'

// "מראה האפליקציה" on the profile: the same five looks, saved the moment one is tapped (and the whole screen changes at once).
export default function ProfileStyle({ initial }: { initial: StaffTheme | null }) {
  const router = useRouter()
  const [theme, setTheme] = useState<StaffTheme | null>(initial)
  const [status, setStatus] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  async function choose(next: StaffTheme) {
    setTheme(next)
    setStatus(null)
    const result = await saveTheme(next)
    if (result.ok) {
      setStatus({ tone: 'ok', text: `נשמר: ${THEMES.find((item) => item.id === next)?.name}` })
      router.refresh()
    } else {
      setStatus({ tone: 'bad', text: result.message })
    }
  }

  return (
    <section id="style" className="sch-wrap" aria-labelledby="style-title" style={{ marginBlock: '20px 8px', scrollMarginTop: 90 }}>
      <div className="sch-row"><Palette size={19} aria-hidden="true" /><h2 id="style-title" className="sch-h">מראה האפליקציה</h2></div>
      <p className="sch-sub">בחרו איך האפליקציה נראית אצלכם. זה משפיע רק על המסכים שלכם.</p>
      <ThemePicker value={theme} onSelect={(next) => void choose(next)} />
      <p className="sp__status" role="status" aria-live="polite" style={status?.tone === 'bad' ? { color: 'var(--danger)' } : undefined}>{status?.text ?? ''}</p>
    </section>
  )
}
