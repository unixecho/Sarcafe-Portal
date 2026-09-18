'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { Bell, BellOff, Share, CheckCircle2, Smartphone } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import {
  isIosDevice,
  isPushSupported,
  isStandaloneDisplay,
  subscribeToOrderPush,
  unsubscribeFromOrderPush,
} from '@/lib/push/client'

function dismissedKey(token: string): string {
  return `sarcafe.order-notify-dismissed.${token}`
}

type Stage =
  | 'checking'
  | 'ios-needs-install'
  | 'unsupported'
  | 'ask'
  | 'dismissed'
  | 'requesting'
  | 'granted'
  | 'denied'

/**
 * The permission onboarding for order-ready push notifications — the
 * "iOS-grade" pattern: a soft, in-page ask FIRST (Bell icon, plain-
 * language benefit, an explicit "not now"), and the real OS permission
 * prompt is only triggered after the visitor already said yes here.
 * Browsers remember a denial forever and refuse to re-prompt, so a raw
 * `Notification.requestPermission()` on page load burns that one shot
 * before the visitor has any reason to say yes — exactly what this
 * avoids. iOS Safari's real constraint (Push only works in a
 * home-screen-installed PWA) is surfaced honestly instead of presenting
 * a button that would silently do nothing.
 */
type TestState = 'idle' | 'sending' | 'sent' | 'no-sub' | 'error'

const TEST_RESULT_TEXT: Record<Exclude<TestState, 'idle' | 'sending'>, string> = {
  sent: 'נשלחה בדיקה — אם לא הגיעה תוך כמה שניות, ההתראות לא באמת פעילות במכשיר הזה.',
  'no-sub': 'לא נמצא מנוי פעיל — נסו לכבות ולהפעיל את ההתראות שוב.',
  error: 'שליחת הבדיקה נכשלה — נסו שוב בעוד רגע.',
}

export default function NotificationPrimer({ token }: { token: string }) {
  const [stage, setStage] = useState<Stage>('checking')
  const [testState, setTestState] = useState<TestState>('idle')

  useEffect(() => {
    // Checked BEFORE feature detection on purpose — this is the actual bug
    // that shipped: iOS Safari 16.4+ exposes `Notification`/`PushManager`/
    // `serviceWorker` even in a plain browser tab (so isPushSupported()
    // below returns true), but `pushManager.subscribe()` throws
    // NotAllowedError unless the page was added to the Home Screen first.
    // Checking feature presence alone let a visitor sail through
    // Notification.requestPermission() (which DOES succeed at the origin
    // level in a regular tab — that's why it looked like it worked) only
    // to have the actual subscription silently fail right after, so no
    // push ever arrived. iOS + not-standalone must short-circuit first,
    // regardless of what the feature-detection APIs claim.
    if (isIosDevice() && !isStandaloneDisplay()) {
      setStage('ios-needs-install')
      return
    }

    if (!isPushSupported()) {
      setStage('unsupported')
      return
    }

    if (Notification.permission === 'denied') {
      setStage('denied')
      return
    }

    if (Notification.permission === 'granted') {
      setStage('granted')
      // Already granted (maybe from a previous order on this device) —
      // re-subscribe silently for THIS order's token, no need to ask
      // again. Best-effort: a failure here just leaves the "granted"
      // badge showing without an active subscription, no worse than not
      // trying.
      void subscribeToOrderPush(token, `/order/${token}`)
      return
    }

    let dismissed = false
    try {
      dismissed = window.localStorage.getItem(dismissedKey(token)) === '1'
    } catch {
      dismissed = false
    }
    setStage(dismissed ? 'dismissed' : 'ask')
  }, [token])

  async function enable() {
    haptic('select')
    setStage('requesting')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStage(permission === 'denied' ? 'denied' : 'ask')
        return
      }
      const ok = await subscribeToOrderPush(token, `/order/${token}`)
      setStage(ok ? 'granted' : 'denied')
      if (ok) haptic('impact')
    } catch {
      setStage('ask')
    }
  }

  function dismiss() {
    haptic('tick')
    try {
      window.localStorage.setItem(dismissedKey(token), '1')
    } catch {
      // Private browsing / quota — worst case it asks again next visit.
    }
    setStage('dismissed')
  }

  async function sendTest() {
    haptic('select')
    setTestState('sending')
    try {
      const res = await fetch('/api/order/test-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const payload = await res.json()
      if (!res.ok || !payload.configured) {
        setTestState('error')
      } else if (payload.subscriptions === 0) {
        setTestState('no-sub')
      } else {
        setTestState('sent')
      }
    } catch {
      setTestState('error')
    }
  }

  function turnOff() {
    haptic('tick')
    void unsubscribeFromOrderPush(token)
    try {
      window.localStorage.setItem(dismissedKey(token), '1')
    } catch {
      // Non-fatal.
    }
    setStage('dismissed')
  }

  if (stage === 'checking' || stage === 'unsupported') return null

  if (stage === 'ios-needs-install') {
    return (
      <div style={{ ...cardStyle, borderColor: 'var(--line-interactive)' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
          <Smartphone size={20} aria-hidden="true" style={iconStyle} />
          <div style={{ flex: 1 }}>
            <p style={titleStyle}>הוסיפו את SARCafe למסך הבית</p>
            <p style={bodyStyle}>
              ככה תוכלו לקבל התראה מיידית ברגע שההזמנה מוכנה — ולא לפספס אותה. זה גם הופך את המעקב לתחושה של
              אפליקציה אמיתית, לא רק עמוד באינטרנט.
            </p>
          </div>
        </div>
        <ol style={stepListStyle}>
          <li>
            הקישו על כפתור השיתוף{' '}
            <Share size={14} aria-hidden="true" style={{ verticalAlign: 'middle', display: 'inline' }} /> בסרגל
            הדפדפן
          </li>
          <li>גללו ובחרו &quot;הוספה למסך הבית&quot;</li>
          <li>פתחו את SARCafe ממסך הבית וחזרו לכאן להפעלת התראות</li>
        </ol>
      </div>
    )
  }

  if (stage === 'dismissed') {
    return (
      <button type="button" className="press" onClick={() => setStage('ask')} style={reopenBtnStyle}>
        <Bell size={14} aria-hidden="true" /> הפעלת התראות כשההזמנה מוכנה
      </button>
    )
  }

  if (stage === 'granted') {
    return (
      <div style={{ ...cardStyle, borderColor: 'rgba(87,217,192,0.35)' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <CheckCircle2 size={20} aria-hidden="true" style={{ color: 'var(--neon-2)', flexShrink: 0 }} />
          <p style={{ ...bodyStyle, flex: 1, color: 'var(--text)' }}>התראות פעילות — נעדכן אתכם כשההזמנה מוכנה.</p>
          <button type="button" className="press" onClick={turnOff} aria-label="כיבוי התראות" style={iconBtnStyle}>
            <BellOff size={16} aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className="press"
          onClick={sendTest}
          disabled={testState === 'sending'}
          style={{ ...testBtnStyle, marginTop: 10 }}
        >
          {testState === 'sending' ? 'שולח…' : 'שליחת התראת בדיקה'}
        </button>
        {testState !== 'idle' && testState !== 'sending' && (
          <p role="status" style={{ ...bodyStyle, marginTop: 6, fontSize: '0.78rem' }}>
            {TEST_RESULT_TEXT[testState]}
          </p>
        )}
      </div>
    )
  }

  if (stage === 'denied') {
    return (
      <div style={cardStyle}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <BellOff size={20} aria-hidden="true" style={{ ...iconStyle, color: 'var(--text-faint)' }} />
          <p style={bodyStyle}>
            התראות חסומות בדפדפן. אפשר להפעיל אותן דרך הגדרות האתר בדפדפן, או פשוט להשאיר את הדף הזה פתוח — הוא
            מתעדכן לבד.
          </p>
        </div>
      </div>
    )
  }

  // stage === 'ask' | 'requesting'
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Bell size={20} aria-hidden="true" style={iconStyle} />
        <div style={{ flex: 1 }}>
          <p style={titleStyle}>לקבל התראה כשההזמנה מוכנה?</p>
          <p style={bodyStyle}>נשלח התראה אחת לטלפון הזה ברגע שההזמנה תהיה מוכנה לאיסוף — אין צורך לרענן את הדף.</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" className="press" disabled={stage === 'requesting'} onClick={enable} style={primaryBtnStyle}>
              {stage === 'requesting' ? 'מפעיל…' : 'הפעלת התראות'}
            </button>
            <button type="button" className="press" disabled={stage === 'requesting'} onClick={dismiss} style={secondaryBtnStyle}>
              לא עכשיו
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const cardStyle: CSSProperties = {
  padding: '14px 14px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elev)',
  border: '1px solid var(--line-strong)',
}
const iconStyle: CSSProperties = { color: 'var(--neon-soft)', flexShrink: 0, marginTop: 2 }
const titleStyle: CSSProperties = { margin: '0 0 4px', fontSize: '0.92rem', fontWeight: 800 }
const bodyStyle: CSSProperties = { margin: 0, fontSize: '0.82rem', color: 'var(--text-dim)', lineHeight: 1.5 }
const stepListStyle: CSSProperties = {
  margin: 0,
  paddingInlineStart: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: '0.82rem',
  color: 'var(--text-dim)',
  lineHeight: 1.5,
}
const primaryBtnStyle: CSSProperties = {
  flex: 1,
  minHeight: 40,
  borderRadius: 12,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontSize: '0.84rem',
  fontWeight: 800,
  cursor: 'pointer',
}
const secondaryBtnStyle: CSSProperties = {
  minHeight: 40,
  padding: '0 14px',
  borderRadius: 12,
  border: '1px solid var(--line-strong)',
  background: 'transparent',
  color: 'var(--text-dim)',
  fontSize: '0.84rem',
  fontWeight: 600,
  cursor: 'pointer',
}
const reopenBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 36,
  padding: '0 12px',
  borderRadius: 999,
  border: '1px solid var(--line)',
  background: 'transparent',
  color: 'var(--text-faint)',
  fontSize: '0.78rem',
  fontWeight: 600,
  cursor: 'pointer',
  alignSelf: 'flex-start',
}
const testBtnStyle: CSSProperties = {
  width: '100%',
  minHeight: 34,
  borderRadius: 10,
  border: '1px solid var(--line-strong)',
  background: 'transparent',
  color: 'var(--text-dim)',
  fontSize: '0.78rem',
  fontWeight: 600,
  cursor: 'pointer',
}
const iconBtnStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: '50%',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-faint)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  flexShrink: 0,
}
