'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarDays, Check, ClipboardCheck, Home, KeyRound, Smartphone } from 'lucide-react'
import LogoMark from '@/components/LogoMark'
import GoogleLinkButton from '@/components/staff/GoogleLinkButton'
import { InlineError } from '@/components/shifts/ui'
import { messageOf } from '@/components/staff/types'
import '@/components/shifts/schedule.css'
import '@/components/staff/onboarding.css'

type Person = { name: string; employeeNo: string; hasGoogle?: boolean }

export default function StaffOnboarding() {
  const [person, setPerson] = useState<Person | null>(null)
  const [token, setToken] = useState('')
  const [passcode, setPasscode] = useState('')
  const [confirm, setConfirm] = useState('')
  const [ready, setReady] = useState(false)
  const [prepared, setPrepared] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    const params = new URLSearchParams(window.location.search)
    const invite = new URLSearchParams(window.location.hash.slice(1)).get('invite')
    // Fragments are never sent to the server. Remove the bearer link from browser history.
    if (invite) window.history.replaceState(null, '', window.location.pathname)
    if (params.get('error')) setError(params.get('error') === 'account_conflict' ? 'חשבון Google הזה כבר קשור לעובד/ת אחר/ת. התחברו עם החשבון האישי שלכם, או פנו למנהל/ת.' : 'קישור Google לא הושלם. אפשר לנסות שוב עם הקוד האישי שלכם.')
    const load = async () => {
      try {
        const response = invite ? await fetch('/api/staff/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'inspect', token: invite }) }) : await fetch('/api/staff/onboarding', { cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) throw new Error(messageOf(payload, 'הקישור אינו זמין. בקשו מהמנהל/ת קישור חדש.'))
        if (!current) return
        setPerson(payload.staff)
        if (invite) setToken(invite)
        else setReady(true)
      } catch (failure) { if (current) setError(failure instanceof Error ? failure.message : 'בעיית חיבור. נסו לרענן.') }
      finally { if (current) setLoading(false) }
    }
    void load()
    return () => { current = false }
  }, [])
  async function complete() {
    if (passcode.length !== 6 || passcode !== confirm) return
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/staff/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'complete', token, passcode }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(messageOf(payload, 'לא הצלחנו להגדיר את החשבון. נסו שוב.'))
      setPerson(payload.staff); setPasscode(''); setConfirm(''); setToken(''); setReady(true); setPrepared(true)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'בעיית חיבור. נסו שוב.') }
    finally { setBusy(false) }
  }
  return <main id="main" className="onboard" dir="rtl">
    <nav className="onboard__nav" aria-label="ניווט">
      <Link href={ready ? '/staff' : '/login'} className="onboard__navlink"><ArrowRight size={19} aria-hidden="true" />חזרה</Link>
      <LogoMark size={30} />
      <Link href="/staff" className="onboard__navlink" aria-label="בית"><Home size={19} aria-hidden="true" /><span>בית</span></Link>
    </nav>
    <section className="onboard__content">
      <div className={`onboard__symbol${ready ? ' onboard__symbol--ready' : ''}`} aria-hidden="true">{ready ? <Check size={30} /> : <KeyRound size={30} />}</div>
      <h1>{ready ? person?.hasGoogle ? 'החשבון שלך מוכן' : 'הקוד האישי שלך מוכן' : 'ברוכים הבאים לצוות'}</h1>
      <p className="onboard__intro">{person ? `${person.name}, ${ready ? 'הכול מחובר לאותו חשבון עובד.' : 'עוד רגע והחשבון שלך מוכן.'}` : loading ? 'פותחים את החשבון שלך…' : 'הגדרת החשבון האישי שלך ב-Sarcafe.'}</p>
      {person && <div className="onboard__identity"><span>{person.name}</span><span className="onboard__number">מספר עובד HYP <bdi>{person.employeeNo}</bdi></span></div>}
      {error && <InlineError>{error}</InlineError>}
      {!loading && person && !ready && <form className="onboard__form" onSubmit={(event) => { event.preventDefault(); void complete() }}>
        <div className="onboard__group">
          <label htmlFor="onboard-pin"><span>בחרו קוד אישי בן 6 ספרות</span><input id="onboard-pin" type="password" inputMode="numeric" pattern="[0-9]{6}" autoComplete="new-password" maxLength={6} value={passcode} onChange={(event) => setPasscode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" dir="ltr" required /></label>
          <label htmlFor="onboard-pin-confirm"><span>הקלידו את הקוד שוב</span><input id="onboard-pin-confirm" type="password" inputMode="numeric" pattern="[0-9]{6}" autoComplete="new-password" maxLength={6} value={confirm} onChange={(event) => setConfirm(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" dir="ltr" required aria-describedby="onboard-pin-help" /></label>
        </div>
        <p id="onboard-pin-help" className="onboard__hint">{confirm.length === 6 && passcode !== confirm ? 'שני הקודים אינם זהים.' : 'בחרו קוד שקשה לנחש. הקוד מיועד לצ׳קליסטים ולעבודה באירועים.'}</p>
        <button type="submit" className="sch-btn sch-btn--primary press" disabled={busy || passcode.length !== 6 || confirm !== passcode}>{busy ? 'מכין את החשבון…' : 'שמירת הקוד האישי'}</button>
      </form>}
      {ready && person && <div className="onboard__form">
        <div className="onboard__access">
          <div><ClipboardCheck size={22} aria-hidden="true" /><span><strong>צ׳קליסטים ואירועים</strong><small>מספר עובד + הקוד האישי שלכם</small></span></div>
          <div><CalendarDays size={22} aria-hidden="true" /><span><strong>משמרות והזמנות מהירות</strong><small>{person.hasGoogle ? 'חשבון Google מקושר' : 'כניסה אישית עם Google'}</small></span>{person.hasGoogle && <Check size={18} aria-label="מקושר" />}</div>
        </div>
        {!person.hasGoogle && <><p className="onboard__hint">קשרו את חשבון Google האישי שלכם כדי לפתוח את לוח המשמרות וההזמנות המהירות.</p><GoogleLinkButton prepared={prepared} /></>}
        <Link href="/staff" className="sch-btn press">{person.hasGoogle ? 'למסך הבית שלי' : 'המשך עם הקוד האישי'}</Link>
        <div className="onboard__install"><Smartphone size={22} aria-hidden="true" /><p>באייפון: פתחו ב-Safari, לחצו על שיתוף ואז ״הוספה למסך הבית״. Sarcafe יהיה תמיד במרחק נגיעה.</p></div>
      </div>}
      {!loading && !person && <Link href="/login?next=/staff&quick=1" className="sch-btn sch-btn--primary press">כניסה עם מספר עובד וקוד</Link>}
    </section>
  </main>
}
