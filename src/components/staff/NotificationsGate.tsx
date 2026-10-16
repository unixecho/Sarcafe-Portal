'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { BellRing, Check, Copy, Download, Share, Smartphone } from 'lucide-react'
import LogoMark from '@/components/LogoMark'
import SignOutButton from '@/components/SignOutButton'
import { haptic } from '@/lib/haptics'
import { enablePush, isPushSupported, isStandaloneDisplay, reconcilePush, sessionPushRegistrar, type PushRegistrar } from '@/lib/push/client'
import {
  GATE_RECHECK_MS, GATE_SKIP_KEY, detectInAppBrowser, detectPlatform, gateAppliesTo, gateStep, stepRows,
  type GateEnv, type GateMode, type Platform,
} from '@/lib/staff/gate-rules'
import '@/components/staff/gate.css'

// The notifications gate (owner, 2026-10-16): a staff page does not open until this device can be told things. The rules are
// pure and live in lib/staff/gate-rules.ts (that file also holds the survival and recovery rules); this file is the screen and
// the browser plumbing. The same screen is the onboarding wizard's FIRST step (`SetupGate`), where the invite link is the
// identity because the personal code does not exist yet.
//
//   a browser inside another app → step 0: open the link in Safari / Chrome (a copy-link button)
//   a phone, not installed        → step 1: put it on the Home Screen (a one-tap button where the browser offers it,
//                                    otherwise the exact taps for that platform)
//   not allowed yet               → step 2: ONE button that asks (a browser only prompts from a tap)
//   said no                       → exactly how to undo that on this platform; re-checks without a reload
//   cannot do push at all         → says so plainly, and who can fix it (the owner can exempt one phone)
//
// It RE-CHECKS itself while open (focus, visibility, every 30 s). NOTHING is stored but, for management only, the "continue
// without alerts" choice for the life of the tab.

interface InstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
// Chrome/Edge/Samsung Internet fire this once the app is installable. Captured at import time (it can fire before any component
// mounts) so the install step can offer a real one-tap button.
let deferredInstall: InstallPromptEvent | null = null
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredInstall = event as InstallPromptEvent })
  window.addEventListener('appinstalled', () => { deferredInstall = null })
}

const IOS_STEPS = ['פתחו את הקישור ב־Safari', 'הקישו על כפתור השיתוף (ריבוע עם חץ) בסרגל התחתון', 'גללו ובחרו ״הוספה למסך הבית״ ואשרו', 'סגרו את הדפדפן ופתחו את האפליקציה מהסמל החדש במסך הבית: ההמשך שם']
const ANDROID_STEPS = ['פתחו את תפריט הדפדפן (⋮)', 'בחרו ״התקנת אפליקציה״ או ״הוספה למסך הבית״', 'פתחו את האפליקציה מהסמל החדש במסך הבית: ההמשך שם']
const BLOCKED: Record<Platform, string> = {
  ios: 'פתחו הגדרות ← התראות ← Sarcafe, והפעילו ״אפשר התראות״. חזרו לכאן והקישו ״בדקתי״.',
  android: 'לחיצה ארוכה על סמל האפליקציה ← פרטי אפליקציה ← התראות ← הפעלה. חזרו לכאן והקישו ״בדקתי״.',
  desktop: 'לחצו על המנעול ליד כתובת האתר ← התראות ← אפשר. אחר כך הקישו ״בדקתי״.',
}

/** What the device says without asking anyone anything: the fallback if the full check ever takes too long, so the screen can
 *  never sit on "checking" forever. Granted permission counts as ready here ('unknown' = not confirmed, not refused). */
function quickEnv(): GateEnv {
  const platform = detectPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)
  const permission: GateEnv['permission'] = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  return { platform, standalone: isStandaloneDisplay(), inAppBrowser: detectInAppBrowser(navigator.userAgent, platform), pushSupported: isPushSupported(), permission, subscribed: permission === 'granted' ? 'unknown' : 'no' }
}

async function readEnv(registrar: PushRegistrar): Promise<GateEnv> {
  const platform = detectPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)
  const standalone = isStandaloneDisplay()
  const pushSupported = isPushSupported()
  const permission: GateEnv['permission'] = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  // Granted but not filed yet (a wiped worker, a rotated key, another person's phone): file it. No prompt is involved.
  const ready = pushSupported && permission === 'granted' && (standalone || platform === 'desktop')
  const subscribed: GateEnv['subscribed'] = ready ? await reconcilePush(registrar) : 'no'
  return { platform, standalone, inAppBrowser: detectInAppBrowser(navigator.userAgent, platform), pushSupported, permission, subscribed }
}

export type GateState = {
  env: GateEnv | null
  busy: boolean
  failed: boolean
  canPrompt: boolean
  turnOn: () => Promise<void>
  install: () => Promise<void>
  recheck: () => Promise<void>
}

export function useGate(registrar: PushRegistrar, active = true): GateState {
  const [env, setEnv] = useState<GateEnv | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [canPrompt, setCanPrompt] = useState(!!deferredInstall)
  const registrarRef = useRef(registrar)
  registrarRef.current = registrar

  const recheck = useCallback(async () => {
    try {
      setEnv(await Promise.race([readEnv(registrarRef.current), new Promise<GateEnv>((resolve) => setTimeout(() => resolve(quickEnv()), 12_000))]))
    } catch { /* keep what is on screen; the next check corrects it */ }
    setCanPrompt(!!deferredInstall)
  }, [])

  useEffect(() => {
    if (!active) return
    void recheck()
    const onVisible = () => { if (document.visibilityState === 'visible') void recheck() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('appinstalled', onVisible)
    const timer = window.setInterval(onVisible, GATE_RECHECK_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('appinstalled', onVisible)
      window.clearInterval(timer)
    }
  }, [active, recheck])

  const turnOn = useCallback(async () => {
    haptic('select')
    setBusy(true); setFailed(false)
    const result = await enablePush(registrarRef.current)
    setFailed(result === 'error')
    setBusy(false)
    await recheck()
  }, [recheck])

  const install = useCallback(async () => {
    const event = deferredInstall
    if (!event) return
    try { await event.prompt(); await event.userChoice } catch { /* dismissed */ }
    deferredInstall = null
    await recheck()
  }, [recheck])

  return { env, busy, failed, canPrompt, turnOn, install, recheck }
}

/** The screen. `extra` is the wizard's own note (copy the link); `skip` and `signOut` are for the staff pages. */
export function GateScreen({ gate, intro, extra, skip, signOut, hard }: { gate: GateState; intro?: ReactNode; extra?: ReactNode; skip?: () => void; signOut?: boolean; hard?: boolean }) {
  const { env, busy, failed, canPrompt, turnOn, install, recheck } = gate
  if (!env) return <div className="gate-wrap"><div className="gate" role="status"><LogoMark size={44} /><p className="gate-muted">בודקים…</p></div></div>
  const step = gateStep(env)
  const rows = stepRows(env)
  const platformSteps = env.platform === 'ios' ? IOS_STEPS : ANDROID_STEPS
  const title = step === 'unsupported' ? 'הדפדפן הזה לא מקבל התראות' : step === 'blocked' ? 'ההתראות חסומות' : step === 'browser' ? 'פותחים בדפדפן' : 'לפני שמתחילים: אפליקציה והתראות'

  return (
    <div className="gate-wrap">
      <div className="gate" role="main" aria-labelledby="gate-title">
        <LogoMark size={44} />
        <h1 id="gate-title">{title}</h1>
        {step === 'unsupported' ? (
          <>
            <p className="gate-muted">פתחו את האתר ב־Chrome או Safari עדכניים (ובטלפון: שמרו אותו במסך הבית). דפדפנים שנפתחים מתוך אינסטגרם, וואטסאפ וכדומה לא תומכים בהתראות.</p>
            {hard && <p className="gate-note">אם הטלפון שלכם פשוט לא יכול לקבל התראות, פנו למנהל/ת: אפשר לאשר לכם כניסה בלי התראות מדף הצוות.</p>}
          </>
        ) : (
          <p className="gate-muted">{intro ?? 'כדי לעבוד עם Sarcafe צריך לקבל התראות: שינוי בסידור, תזכורת לפני משמרת, צ׳קליסט שמחכה, החלפת משמרת. בלי זה לא תדעו מה קורה, ולכן הצוות נפתח רק אחרי שני הצעדים:'}</p>
        )}

        {step === 'browser' && (
          <div className="gate-box" role="note">
            <p>הדף הזה נפתח בתוך אפליקציה אחרת, ושם אי אפשר להוסיף למסך הבית ולקבל התראות.</p>
            <p>הקישו על ⋯ או על סמל השיתוף ובחרו ״פתיחה ב־Safari״ או ״פתיחה ב־Chrome״. אפשר גם להעתיק את הקישור ולפתוח אותו בדפדפן.</p>
            <CopyLink />
          </div>
        )}

        {step !== 'unsupported' && step !== 'browser' && (
          <ol className="gate-steps">
            {rows.map((row, index) => (
              <li key={row.key} className={`gate-step${row.done ? ' done' : ''}${row.now ? ' now' : ''}`}>
                <span className="gate-step-n" aria-hidden="true">{row.done ? <Check size={15} /> : index + 1}</span>
                <div className="gate-step-body">
                  <b>{row.key === 'install' ? 'הוספה למסך הבית' : 'הפעלת התראות'}</b>
                  {row.key === 'install' && row.now && (
                    <>
                      <p>{env.platform === 'ios' ? 'באייפון התראות עובדות רק מהאפליקציה שעל מסך הבית.' : 'מהאפליקציה שעל מסך הבית ההתראות מגיעות גם כשהטלפון נעול.'}</p>
                      <ol>{platformSteps.map((text) => <li key={text}>{text}</li>)}</ol>
                      {extra}
                    </>
                  )}
                  {row.key === 'notifications' && row.now && step === 'notifications' && <p>הקישו להפעלה ואשרו את הבקשה שהדפדפן יציג. אפשר לשנות אחר כך רק בהגדרות הטלפון.</p>}
                  {row.key === 'notifications' && row.now && step === 'blocked' && <p>{BLOCKED[env.platform]}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}

        <div className="gate-actions">
          {step === 'install' && canPrompt && <button type="button" className="sch-btn sch-btn--primary press" onClick={() => void install()}><Download size={18} aria-hidden="true" />התקנת האפליקציה</button>}
          {step === 'install' && <button type="button" className={`sch-btn press${canPrompt ? '' : ' sch-btn--primary'}`} onClick={() => void recheck()}><Smartphone size={18} aria-hidden="true" />התקנתי, פתחתי מהסמל</button>}
          {step === 'notifications' && <button type="button" className="sch-btn sch-btn--primary press" disabled={busy} onClick={() => void turnOn()}><BellRing size={18} aria-hidden="true" />{busy ? 'מפעילים…' : 'הפעלת התראות'}</button>}
          {step === 'notifications' && failed && <p className="gate-muted" role="alert">לא הצלחנו להפעיל. נסו שוב. אם זה חוזר, בדקו חיבור לאינטרנט.</p>}
          {(step === 'blocked' || step === 'unsupported' || step === 'browser') && <button type="button" className="sch-btn sch-btn--primary press" onClick={() => void recheck()}>בדקתי, נסו שוב</button>}
          {skip && <button type="button" className="sch-btn press" onClick={skip}>להמשיך בלי התראות (הנהלה בלבד)</button>}
          {signOut && <SignOutButton className="gate-signout" />}
        </div>
      </div>
    </div>
  )
}

function CopyLink() {
  const [copied, setCopied] = useState(false)
  return (
    <button type="button" className="sch-btn press" onClick={async () => {
      try { await navigator.clipboard.writeText(window.location.href); setCopied(true) } catch { /* the address bar still holds it */ }
    }}>{copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}{copied ? 'הקישור הועתק' : 'העתקת הקישור'}</button>
  )
}

/** The staff pages' gate (components/staff in app/staff/layout.tsx). `mode` is decided on the server (gateModeFor). */
export default function NotificationsGate({ mode, children }: { mode: GateMode; children: ReactNode }) {
  const pathname = usePathname()
  const applies = mode !== 'off' && gateAppliesTo(pathname)
  const gate = useGate(sessionPushRegistrar, applies)
  const [skipped, setSkipped] = useState(false)
  useEffect(() => {
    try { setSkipped(sessionStorage.getItem(GATE_SKIP_KEY) === '1') } catch { /* without storage the choice is asked again per page load */ }
  }, [])
  if (!applies) return <>{children}</>
  // Until the first check has run, show the page's own quiet placeholder rather than flashing the gate at someone who passes it.
  if (!gate.env) return <GateScreen gate={gate} />
  if (gateStep(gate.env) === 'done') return <>{children}</>
  if (mode === 'soft' && skipped) return <>{children}</>
  return (
    <GateScreen
      gate={gate}
      hard={mode === 'hard'}
      signOut
      skip={mode === 'soft' ? () => { try { sessionStorage.setItem(GATE_SKIP_KEY, '1') } catch { /* per page load then */ } setSkipped(true) } : undefined}
    />
  )
}

/** The wizard's first step: the same gate, with the invite link as the identity. Calls `onReady` once the device can be told things. */
export function SetupGate({ registrar, extra, onReady }: { registrar: PushRegistrar; extra?: ReactNode; onReady: () => void }) {
  const gate = useGate(registrar)
  const done = gate.env ? gateStep(gate.env) === 'done' : false
  const fired = useRef(false)
  useEffect(() => {
    if (done && !fired.current) { fired.current = true; onReady() }
  }, [done, onReady])
  if (done) return null
  return <GateScreen gate={gate} extra={extra} intro="לפני שמתחילים בהגדרת החשבון: מוסיפים את Sarcafe למסך הבית ומפעילים התראות. בלי זה אי אפשר להמשיך, כי כך תדעו על משמרות, צ׳קליסטים והחלפות:" />
}
