'use client'

import { useEffect, useState } from 'react'
import { Download, Share, Smartphone, X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import '@/components/app/app.css'

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const STORAGE_KEY = 'sarcafe:staff-install-intro:v1'
export const STAFF_INSTALL_EVENT = 'sarcafe:staff-install-open'

export default function StaffInstallIntro() {
  const [open, setOpen] = useState(false)
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null)
  const [ios, setIos] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
    setInstalled(standalone)
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) || (/mac/i.test(navigator.platform) && navigator.maxTouchPoints > 1))
    let seen = false
    try { seen = localStorage.getItem(STORAGE_KEY) === 'seen' } catch { /* Installation help remains available without device storage. */ }
    if (!standalone && !seen) setOpen(true)
    const prompt = (event: Event) => { event.preventDefault(); setPromptEvent(event as InstallPromptEvent) }
    const complete = () => { setInstalled(true); setOpen(false); setPromptEvent(null) }
    const show = () => { setOpen(true); setError(null) }
    window.addEventListener('beforeinstallprompt', prompt)
    window.addEventListener('appinstalled', complete)
    window.addEventListener(STAFF_INSTALL_EVENT, show)
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
    return () => {
      window.removeEventListener('beforeinstallprompt', prompt)
      window.removeEventListener('appinstalled', complete)
      window.removeEventListener(STAFF_INSTALL_EVENT, show)
    }
  }, [])

  function close() {
    try { localStorage.setItem(STORAGE_KEY, 'seen') } catch { /* Dismissal still works in private browsing. */ }
    setOpen(false)
  }
  async function install() {
    if (!promptEvent || busy) return
    setBusy(true)
    setError(null)
    try {
      await promptEvent.prompt()
      const choice = await promptEvent.userChoice
      setPromptEvent(null)
      if (choice.outcome === 'accepted') close()
    } catch { setError('לא הצלחנו לפתוח את ההתקנה. אפשר להוסיף דרך תפריט הדפדפן.') }
    finally { setBusy(false) }
  }

  return (
    <SheetShell open={open} onClose={close} labelledBy="staff-install-title" className="app-install">
      <div className="app-install__head">
        <span className="app-install__icon"><Smartphone size={27} aria-hidden="true" /></span>
        <div style={{ flex: 1 }}><h2 id="staff-install-title">Sarcafe במסך הבית</h2><p>{installed ? 'Sarcafe כבר פתוחה כאפליקציה במסך הבית שלך.' : 'פתיחה ישירה למשמרות, לצ׳קליסטים ולכלים שלך, בחלון אפליקציה.'}</p></div>
        <button className="app-header__icon press" type="button" onClick={close} aria-label="סגירה"><X size={20} aria-hidden="true" /></button>
      </div>
      {!installed && <ol className="app-install__steps">
        {ios ? <><li>פתחו את Sarcafe ב־Safari.</li><li><span>הקישו על שיתוף <Share size={16} style={{ verticalAlign: 'middle' }} aria-hidden="true" /> בתפריט הדפדפן.</span></li><li>בחרו „הוספה למסך הבית” ואשרו „הוספה”.</li></> : <><li>פתחו את תפריט הדפדפן.</li><li>בחרו „התקנת אפליקציה” או „הוספה למסך הבית”.</li><li>אשרו ופתחו את Sarcafe מהסמל במסך הבית.</li></>}
      </ol>}
      {error && <p className="app-notifications__error" role="alert">{error}</p>}
      {promptEvent && !installed && <button type="button" className="app-install__button app-install__primary press" disabled={busy} onClick={() => void install()}><Download size={19} aria-hidden="true" />{busy ? 'פותח התקנה…' : 'הוספה למסך הבית'}</button>}
      <button type="button" className="app-install__later press" onClick={close}>{installed ? 'חזרה לאפליקציה' : 'הבנתי'}</button>
    </SheetShell>
  )
}