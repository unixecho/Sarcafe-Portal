'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, BellRing, CalendarClock, CheckCircle2, ClipboardCheck, Repeat2, Share, Smartphone, X } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import {
  isIosDevice,
  isPushSupported,
  isStandaloneDisplay,
  isStaffPushActive,
  sendStaffPushTest,
  subscribeStaffPush,
  unsubscribeStaffPush,
} from '@/lib/push/client'
import '@/components/app/app.css'

// Asks staff to put Sarcafe on their home screen and switch on alerts: shift changes, a reminder
// before a shift, a checklist nobody submitted, and colleagues giving shifts away. It is the same
// card in the onboarding wizard (variant "wizard") and on the staff and owner home screens
// (variant "home"); only the home one can be snoozed.
//
// The permission ask is two-step on purpose, like the customer order page: a plain-language card
// first, and the browser's one-shot permission dialog only after the person said yes here (a
// denial is remembered by the browser for good). iPhones are the awkward case — Web Push exists
// there only inside the home-screen app — so a browser tab on iOS is shown the install steps
// instead of a button that would silently do nothing.

type Stage = 'checking' | 'install' | 'unsupported' | 'ask' | 'busy' | 'on' | 'denied' | 'failed' | 'snoozed'
type TestState = 'idle' | 'sending' | 'sent' | 'none' | 'failed' | 'error'

const OFF_KEY = 'sarcafe:staff-push-off:v1'
const SNOOZE_KEY = 'sarcafe:staff-push-snooze:v1'
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000

const read = (key: string) => {
  try { return window.localStorage.getItem(key) } catch { return null }
}
const write = (key: string, value: string | null) => {
  try { if (value === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, value) } catch { /* Private browsing: worst case the ask comes back next visit. */ }
}

const BENEFITS = [
  { icon: CalendarClock, text: 'שינוי במשמרת, פרסום סידור ותזכורת לפני שהמשמרת מתחילה' },
  { icon: ClipboardCheck, text: 'צ׳קליסט שלא הוגש' },
  { icon: Repeat2, text: 'עובדים שמוסרים משמרת, ובקשות החלפה שמחכות לך' },
]

export default function StaffPushCard({ variant = 'home' }: { variant?: 'home' | 'wizard' }) {
  const [stage, setStage] = useState<Stage>('checking')
  const [test, setTest] = useState<TestState>('idle')
  const [detail, setDetail] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    const settle = (next: Stage) => { if (current) setStage(next) }
    void (async () => {
      // iOS in a plain browser tab exposes the Push API but subscribing fails — check first.
      if (isIosDevice() && !isStandaloneDisplay()) return settle('install')
      if (!isPushSupported()) return settle('unsupported')
      if (Notification.permission === 'denied') return settle('denied')
      if (Notification.permission === 'granted' && read(OFF_KEY) !== '1') {
        if (await isStaffPushActive()) return settle('on')
        // Permission was already given (an earlier order page, or another employee on this phone):
        // file this phone under the person who is signed in now. No dialog involved.
        return settle((await subscribeStaffPush()) ? 'on' : 'ask')
      }
      const snoozedAt = Number(read(SNOOZE_KEY))
      if (variant === 'home' && snoozedAt && Date.now() - snoozedAt < SNOOZE_MS) return settle('snoozed')
      settle('ask')
    })()
    return () => { current = false }
  }, [variant])

  async function enable() {
    haptic('select')
    setStage('busy')
    try {
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
      if (permission !== 'granted') return setStage(permission === 'denied' ? 'denied' : 'ask')
      const ok = await subscribeStaffPush()
      if (ok) { write(OFF_KEY, null); write(SNOOZE_KEY, null); haptic('impact') }
      setStage(ok ? 'on' : 'failed')
    } catch { setStage('failed') }
  }

  async function turnOff() {
    haptic('tick')
    write(OFF_KEY, '1')
    setTest('idle')
    await unsubscribeStaffPush()
    setStage('ask')
  }

  function snooze() {
    haptic('tick')
    write(SNOOZE_KEY, String(Date.now()))
    setStage('snoozed')
  }

  async function sendTest() {
    haptic('select')
    setTest('sending')
    setDetail(null)
    const result = await sendStaffPushTest()
    if (!result || !result.configured) { setTest('error'); setDetail(result?.error?.detail ?? null); return }
    if (result.subscriptions === 0) return setTest('none')
    if (result.sent === 0) { setTest('failed'); setDetail(result.error ? `${result.error.statusCode ?? '?'} — ${result.error.detail}` : null); return }
    setTest('sent')
  }

  if (stage === 'checking' || stage === 'unsupported' || stage === 'snoozed') return null

  if (stage === 'install') {
    return (
      <section className={`app-push app-push--${variant}`} aria-label="התראות">
        <div className="app-push__head">
          <span className="app-push__icon"><Smartphone size={24} aria-hidden="true" /></span>
          <div><h2>הוסיפו את Sarcafe למסך הבית</h2><p>באייפון, התראות עובדות רק מהאפליקציה שעל מסך הבית. ככה לא תפספסו משמרת, שינוי בסידור או צ׳קליסט.</p></div>
        </div>
        <ol className="app-install__steps">
          <li>פתחו את Sarcafe ב־Safari.</li>
          <li><span>הקישו על שיתוף <Share size={16} style={{ verticalAlign: 'middle', display: 'inline' }} aria-hidden="true" /> בסרגל הדפדפן.</span></li>
          <li>בחרו „הוספה למסך הבית”.</li>
          <li>פתחו את Sarcafe מהסמל במסך הבית, התחברו שוב, וחזרו לכאן להפעלת ההתראות.</li>
        </ol>
      </section>
    )
  }

  if (stage === 'on') {
    return (
      <section className="app-push app-push--on" aria-label="התראות">
        <div className="app-push__row">
          <CheckCircle2 size={22} aria-hidden="true" className="app-push__ok" />
          <div><strong>התראות פעילות במכשיר הזה</strong><small>משמרות, צ׳קליסטים ובקשות יגיעו אליך גם כשהאפליקציה סגורה.</small></div>
          <button type="button" className="app-push__icon-button press" onClick={() => void turnOff()} aria-label="כיבוי התראות"><BellOff size={18} aria-hidden="true" /></button>
        </div>
        <button type="button" className="app-push__test press" disabled={test === 'sending'} onClick={() => void sendTest()}>{test === 'sending' ? 'שולח…' : 'שליחת התראת בדיקה'}</button>
        {test !== 'idle' && test !== 'sending' && (
          <div role="status">
            <p className="app-push__note">
              {test === 'sent' && 'נשלחה בדיקה. אם לא הגיעה תוך כמה שניות, ההתראות לא באמת פעילות במכשיר הזה.'}
              {test === 'none' && 'לא נמצא מנוי פעיל במכשיר הזה. כבו והפעילו את ההתראות שוב.'}
              {test === 'failed' && 'השרת ניסה לשלוח והשירות סירב. אפשר לשלוח צילום מסך של הפרטים למנהל/ת:'}
              {test === 'error' && 'שליחת הבדיקה נכשלה. נסו שוב בעוד רגע.'}
            </p>
            {detail && <p className="app-push__detail">{detail}</p>}
          </div>
        )}
      </section>
    )
  }

  if (stage === 'denied') {
    return (
      <section className="app-push app-push--denied" aria-label="התראות">
        <div className="app-push__row">
          <BellOff size={22} aria-hidden="true" />
          <div><strong>ההתראות חסומות במכשיר</strong><small>אפשר להפעיל אותן בהגדרות הטלפון או הדפדפן, תחת התראות של Sarcafe, ואז לרענן את העמוד.</small></div>
        </div>
      </section>
    )
  }

  return (
    <section className={`app-push app-push--${variant}`} aria-label="התראות">
      <div className="app-push__head">
        <span className="app-push__icon"><BellRing size={24} aria-hidden="true" /></span>
        <div><h2>קבלו התראות מ־Sarcafe</h2><p>נעדכן אתכם בטלפון בדברים שחשוב לדעת בזמן:</p></div>
        {variant === 'home' && <button type="button" className="app-push__icon-button press" onClick={snooze} aria-label="לא עכשיו"><X size={18} aria-hidden="true" /></button>}
      </div>
      <ul className="app-push__list">
        {BENEFITS.map(({ icon: Icon, text }) => <li key={text}><Icon size={18} aria-hidden="true" /><span>{text}</span></li>)}
      </ul>
      {stage === 'failed' && <p className="app-notifications__error" role="alert">לא הצלחנו להפעיל את ההתראות. נסו שוב, ואם זה חוזר, רעננו את העמוד.</p>}
      <button type="button" className="app-install__button app-install__primary press" disabled={stage === 'busy'} onClick={() => void enable()}>
        <Bell size={19} aria-hidden="true" />{stage === 'busy' ? 'מפעיל…' : 'הפעלת התראות'}
      </button>
      {variant === 'wizard' && <p className="app-push__note">אפשר להפעיל גם אחר כך, מהמסך הבית.</p>}
    </section>
  )
}
