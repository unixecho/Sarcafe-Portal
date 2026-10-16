'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarDays, Check, ClipboardPaste, KeyRound, Sparkles } from 'lucide-react'
import LogoMark from '@/components/LogoMark'
import GoogleLinkButton from '@/components/staff/GoogleLinkButton'
import StaffProfileStep from '@/components/staff/StaffProfileStep'
import StaffStyleStep from '@/components/staff/StaffStyleStep'
import { THEME_COOKIE, parseTheme, type StaffTheme } from '@/lib/staff/theme'
import StaffTour from '@/components/staff/StaffTour'
import { SetupGate } from '@/components/staff/NotificationsGate'
import { InlineError } from '@/components/shifts/ui'
import { messageOf } from '@/components/staff/types'
import { haptic } from '@/lib/haptics'
import { invitePushRegistrar, sessionPushRegistrar } from '@/lib/push/client'
import { WIZARD_STEPS, clearInvite, loadInvite, parseInvite, progressIndex, saveInvite, wizardStep } from '@/lib/staff/onboarding-wizard'
import '@/components/shifts/schedule.css'
import '@/components/staff/onboarding.css'

type Person = { name: string; firstName?: string | null; lastName?: string | null; emoji?: string | null; employeeNo: string; hasGoogle?: boolean; onboardingDone?: boolean }

const storage = () => { try { return window.localStorage } catch { return null } }

// The employee's first minute (aligned with the Ayeka Bar wizard, 2026-10-16), with the owner's rule first:
//
//   SETUP (the app on the Home Screen, notifications on) -> welcome -> choose a personal code -> connect Google (skippable)
//     -> my details -> a short tour (the demo) -> home
//
// Nothing else is reachable before setup: the link opens on the gate, not on a button to the main page. Setup registers the
// phone with the INVITE LINK as the identity (the code does not exist yet), so the person is never asked to sign in to be told
// to enable notifications.
//
// SURVIVAL AND RECOVERY. Every screen is a function of what the server and this device say now, never of progress kept here:
//   • the link stays in the address bar through setup (so the Home Screen icon can be saved WITH it), is remembered on this
//     device, and is forgotten the moment the code is set; an installed app that opens without it asks for it to be pasted;
//   • the personal code makes a session that lasts 30 days: closing the app, losing the connection or switching tabs resumes at
//     the right step (the server remembers whether the walk was finished, `onboardingDone`);
//   • the Google round trip returns HERE (?linked=1) and carries on at "my details"; a failed one comes back to the Google step;
//   • a link that stopped working says why in words and offers the two ways out (a new link, or sign in with the code).
export default function StaffOnboarding() {
  const [person, setPerson] = useState<Person | null>(null)
  const [token, setToken] = useState('')
  const [passcode, setPasscode] = useState('')
  const [confirm, setConfirm] = useState('')
  const [coded, setCoded] = useState(false)
  const [prepared, setPrepared] = useState(false)
  const [welcomed, setWelcomed] = useState(false)
  const [gateDone, setGateDone] = useState(false)
  const [googleSkipped, setGoogleSkipped] = useState(false)
  const [continuing, setContinuing] = useState(false)
  const [detailsDone, setDetailsDone] = useState(false)
  // The look: a person who already chose one on this device (the cookie) is not asked again; otherwise the walk has a style step.
  const [styleDone, setStyleDone] = useState(false)
  const [chosenLook, setChosenLook] = useState<StaffTheme | null>(null)
  const [tourOnly, setTourOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noLink, setNoLink] = useState(false)
  const [pasted, setPasted] = useState('')
  const [attempt, setAttempt] = useState(0)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Find out who this is: the link in the address, a session, the link remembered here, or nobody (then ask for the link).
  useEffect(() => {
    let current = true
    const params = new URLSearchParams(window.location.search)
    const fragment = parseInvite(window.location.hash)
    const returning = params.get('linked') === '1'
    const failed = params.get('error')
    if (failed) setError(failed === 'account_conflict' ? 'חשבון Google הזה כבר קשור לעובד/ת אחר/ת. התחברו עם החשבון האישי שלכם, או פנו למנהל/ת.' : 'קישור Google לא הושלם. אפשר לנסות שוב עם הקוד האישי שלכם.')

    const inspect = async (linkToken: string) => {
      const response = await fetch('/api/staff/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'inspect', token: linkToken }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw Object.assign(new Error(messageOf(payload, 'הקישור אינו זמין. בקשו מהמנהל/ת קישור חדש.')), { status: response.status })
      return payload.staff as Person
    }
    const fromSession = async () => {
      const response = await fetch('/api/staff/onboarding', { cache: 'no-store' })
      if (!response.ok) return null
      return ((await response.json()) as { staff: Person }).staff
    }

    const load = async () => {
      try {
        // 1. A link in the address (kept there through setup so the Home Screen icon can be saved with it).
        if (fragment) {
          saveInvite(storage(), fragment, Date.now())
          const staff = await inspect(fragment)
          if (!current) return
          setPerson(staff); setToken(fragment)
          return
        }
        // 2. A session: the personal code is set already. Resume the walk, or (finished) go home.
        const mine = await fromSession()
        if (mine) {
          if (!current) return
          clearInvite(storage())
          setPerson(mine); setCoded(true)
          if (returning) setContinuing(true)
          else if (params.get('tour') === '1') { setContinuing(true); setDetailsDone(true); setStyleDone(true); setTourOnly(true); setGateDone(true) }
          else if (mine.onboardingDone && !failed) { window.location.replace('/staff'); return }
          return
        }
        // 3. A link remembered on this device (the app was closed and reopened before the code was set).
        const remembered = loadInvite(storage(), Date.now())
        if (remembered) {
          try {
            const staff = await inspect(remembered)
            if (!current) return
            setPerson(staff); setToken(remembered)
            return
          } catch (failure) {
            clearInvite(storage())
            throw failure
          }
        }
        if (current) setNoLink(true)
      } catch (failure) {
        if (!current) return
        const status = (failure as { status?: number }).status
        // A link that stopped working (used, expired, replaced) is a dead end with two ways out; a network problem is retryable.
        if (status === 410) clearInvite(storage())
        setError(failure instanceof Error ? failure.message : 'בעיית חיבור. נסו שוב.')
        if (status === undefined) setNoLink(false)
      } finally {
        if (current) setLoading(false)
      }
    }
    void load()
    return () => { current = false }
  }, [attempt])

  async function complete() {
    if (passcode.length !== 6 || passcode !== confirm) return
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/staff/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'complete', token, passcode }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(messageOf(payload, 'לא הצלחנו להגדיר את החשבון. נסו שוב.'))
      haptic('impact')
      // The code exists: the link has done its job. Forget it here and take it out of the address bar and the history.
      clearInvite(storage())
      window.history.replaceState(null, '', window.location.pathname)
      setPerson(payload.staff); setPasscode(''); setConfirm(''); setToken(''); setCoded(true); setPrepared(true)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'בעיית חיבור. נסו שוב.') }
    finally { setBusy(false) }
  }

  const onGateReady = useCallback(() => setGateDone(true), [])
  const finish = useCallback(() => {
    clearInvite(storage())
    // keepalive: the request must complete even though the page is navigating away.
    try { void fetch('/api/staff/onboarding', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'finish' }) }) } catch { /* the walk is simply offered again next time */ }
  }, [])

  function usePasted(event: FormEvent) {
    event.preventDefault()
    const found = parseInvite(pasted)
    if (!found) { setError('לא מצאנו קישור הצטרפות בטקסט. הדביקו את כל ההודעה או את הקישור שקיבלתם.'); return }
    saveInvite(storage(), found, Date.now())
    window.history.replaceState(null, '', `${window.location.pathname}#invite=${found}`)
    setError(null); setPasted(''); setNoLink(false); setLoading(true); setAttempt((n) => n + 1)
  }

  useEffect(() => {
    try {
      const match = document.cookie.split('; ').find((part) => part.startsWith(`${THEME_COOKIE}=`))
      const saved = parseTheme(match?.slice(THEME_COOKIE.length + 1))
      if (saved) { setChosenLook(saved); setStyleDone(true) }
    } catch { /* no cookies: the step is simply asked */ }
  }, [])

  const step = wizardStep({ person: !!person, noLink, gateDone, coded, welcomed, hasGoogle: !!person?.hasGoogle, googleSkipped, continuing, detailsDone, styleDone })
  // Each screen is announced: focus moves to its heading so a screen-reader user lands on the new content.
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [step])
  const who = person?.firstName?.trim() || person?.name?.split(' ')[0] || 'חבר/ת צוות'

  if (loading) {
    return (
      <main id="main" className="onboard" dir="rtl">
        <nav className="onboard__nav" aria-label="ניווט"><span style={{ minWidth: 58 }} /><LogoMark size={30} /><span style={{ minWidth: 58 }} /></nav>
        <section className="onboard__content"><p className="onboard__intro" role="status">פותחים את החשבון שלך…</p></section>
      </main>
    )
  }

  // Setup is a full screen of its own (the same gate the staff pages use), before everything else.
  if (person && step === 'setup' && !tourOnly) {
    return (
      <SetupGate
        registrar={coded ? sessionPushRegistrar : invitePushRegistrar(token)}
        onReady={onGateReady}
        extra={!coded && (
          <p className="onboard__hint">אחרי ההתקנה נפתחת האפליקציה מהסמל. אם היא נפתחת בלי להמשיך, הדביקו בה את הקישור שקיבלתם בהודעה: הוא עדיין תקף.</p>
        )}
      />
    )
  }

  // ---- the walk ------------------------------------------------------------------------------------------------
  if (person && !tourOnly) {
    return (
      <main id="main" className="onboard" dir="rtl">
        <nav className="onboard__nav" aria-label="ניווט"><span style={{ minWidth: 58 }} /><LogoMark size={30} /><span style={{ minWidth: 58 }} /></nav>
        <section className="onboard__content">
          <ol className="ob-progress" aria-label="שלבים">
            {WIZARD_STEPS.map((item, index) => (
              <li key={item.id} aria-current={index === progressIndex(step) ? 'step' : undefined} className={index < progressIndex(step) ? 'ob-progress__done' : index === progressIndex(step) ? 'ob-progress__now' : ''}><span className="sr-only">{item.label}</span></li>
            ))}
          </ol>

          {error && <InlineError>{error}</InlineError>}

          {step === 'welcome' && (
            <div className="ob-step rise">
              <div className="onboard__symbol" aria-hidden="true"><Sparkles size={30} /></div>
              <h1 ref={headingRef} tabIndex={-1}>ברוכים הבאים, {who}</h1>
              <p className="onboard__intro">האפליקציה על מסך הבית וההתראות פעילות. עוד רגע תוכלו לראות את המשמרות שלכם ולעבוד עם הצ׳קליסטים.</p>
              <ol className="ob-steps">
                <li><span>1</span>בוחרים קוד אישי בן 6 ספרות</li>
                <li><span>2</span>מחברים חשבון Google (אפשר גם אחר כך)</li>
                <li><span>3</span>מעדכנים פרטים וצופים בסיור קצר</li>
              </ol>
              <div className="onboard__identity"><span>{person.name}</span><span className="onboard__number">מספר עובד HYP <bdi>{person.employeeNo}</bdi></span></div>
              <button type="button" className="sch-btn sch-btn--primary press" style={{ minHeight: 52 }} onClick={() => { haptic('select'); setWelcomed(true) }}>בואו נתחיל</button>
            </div>
          )}

          {step === 'code' && (
            <form className="onboard__form ob-step rise" onSubmit={(event) => { event.preventDefault(); void complete() }}>
              <div className="onboard__symbol" aria-hidden="true"><KeyRound size={30} /></div>
              <h1 ref={headingRef} tabIndex={-1}>בחרו קוד אישי</h1>
              <p className="onboard__intro">הקוד הוא הכניסה שלכם לצ׳קליסטים ולעבודה באירועים. רק אתם מכירים אותו.</p>
              <div className="onboard__group">
                <label htmlFor="onboard-pin"><span>קוד בן 6 ספרות</span><input id="onboard-pin" type="password" inputMode="numeric" pattern="[0-9]{6}" autoComplete="new-password" maxLength={6} value={passcode} onChange={(event) => setPasscode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" dir="ltr" required /></label>
                <label htmlFor="onboard-pin-confirm"><span>הקלידו את הקוד שוב</span><input id="onboard-pin-confirm" type="password" inputMode="numeric" pattern="[0-9]{6}" autoComplete="new-password" maxLength={6} value={confirm} onChange={(event) => setConfirm(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" dir="ltr" required aria-describedby="onboard-pin-help" /></label>
              </div>
              <p id="onboard-pin-help" className="onboard__hint">{confirm.length === 6 && passcode !== confirm ? 'שני הקודים אינם זהים.' : 'בחרו קוד שקשה לנחש, בלי רצף או ספרות שחוזרות.'}</p>
              <button type="submit" className="sch-btn sch-btn--primary press" disabled={busy || passcode.length !== 6 || confirm !== passcode}>{busy ? 'מכין את החשבון…' : 'שמירת הקוד האישי'}</button>
            </form>
          )}

          {step === 'google' && (
            <div className="onboard__form ob-step rise">
              <div className="onboard__symbol" aria-hidden="true"><CalendarDays size={30} /></div>
              <h1 ref={headingRef} tabIndex={-1}>קשרו חשבון Google</h1>
              <p className="onboard__intro">עם חשבון Google אישי רואים את לוח המשמרות, שולחים אילוצים ומחליפים משמרות. אנחנו מקבלים רק את השם והאימייל, ולא צריך סיסמה חדשה.</p>
              <GoogleLinkButton prepared={prepared} back="onboarding" />
              <button type="button" className="sch-btn press" onClick={() => { haptic('select'); setGoogleSkipped(true) }}>אחר כך, נמשיך בלי</button>
              <p className="onboard__hint">אפשר לקשר Google בכל זמן מהפרופיל. בלי Google עובדים עם הקוד האישי בצ׳קליסטים ובאירועים.</p>
            </div>
          )}

          {step === 'details' && <StaffProfileStep emoji={person.emoji ?? null} firstName={person.firstName ?? person.name.split(' ')[0] ?? ''} lastName={person.lastName ?? person.name.split(' ').slice(1).join(' ')} onDone={() => setDetailsDone(true)} />}
          {step === 'style' && <StaffStyleStep initial={chosenLook} onDone={() => setStyleDone(true)} />}
          {step === 'tour' && <StaffTour who={who} onFinish={finish} />}
        </section>
      </main>
    )
  }

  if (person && tourOnly) {
    return (
      <main id="main" className="onboard" dir="rtl">
        <nav className="onboard__nav" aria-label="ניווט"><Link href="/staff" className="onboard__navlink"><ArrowRight size={19} aria-hidden="true" />חזרה</Link><LogoMark size={30} /><span style={{ minWidth: 58 }} /></nav>
        <section className="onboard__content"><StaffTour who={who} /></section>
      </main>
    )
  }

  // ---- no link here / a link that does not work: two ways out, never a button to the main page ------------------
  return (
    <main id="main" className="onboard" dir="rtl">
      <nav className="onboard__nav" aria-label="ניווט"><span style={{ minWidth: 58 }} /><LogoMark size={30} /><span style={{ minWidth: 58 }} /></nav>
      <section className="onboard__content">
        <div className="onboard__symbol" aria-hidden="true"><ClipboardPaste size={30} /></div>
        <h1 ref={headingRef} tabIndex={-1}>{noLink ? 'איפה הקישור שלך?' : 'הקישור לא עובד'}</h1>
        <p className="onboard__intro">{noLink ? 'כדי להמשיך צריך את קישור ההצטרפות שהמנהל/ת שלחו לך. הדביקו אותו כאן, ואנחנו ממשיכים בדיוק מהמקום שעצרתם.' : 'ייתכן שהקישור כבר שימש, פג תוקפו או הוחלף בחדש. הדביקו כאן קישור אחר, או בקשו מהמנהל/ת קישור חדש.'}</p>
        {error && <InlineError>{error}</InlineError>}
        <form className="onboard__form" onSubmit={usePasted}>
          <div className="onboard__group">
            <label htmlFor="onboard-paste"><span>הקישור או ההודעה שקיבלתם</span><textarea id="onboard-paste" className="sch-input ob-paste" dir="ltr" rows={3} value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder="https://…/staff/onboarding#invite=…" /></label>
          </div>
          <button type="submit" className="sch-btn sch-btn--primary press" disabled={!pasted.trim()}>המשך עם הקישור</button>
        </form>
        <Link href="/login?next=/staff&quick=1" className="sch-btn press">כבר בחרתי קוד: כניסה עם מספר עובד וקוד</Link>
        {!noLink && <button type="button" className="sch-btn press" onClick={() => { setError(null); setLoading(true); setAttempt((n) => n + 1) }}><Check size={17} aria-hidden="true" />בדקתי, נסו שוב</button>}
      </section>
    </main>
  )
}
