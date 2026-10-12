'use client'

import { useCallback, useEffect, useState } from 'react'
import { Beaker, RefreshCw } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import '@/components/app/app.css'

// Developer-only test bench for staff push, shown on the owner dashboard (the page decides who sees
// it; the API checks again). Each button writes a real inbox row for the signed-in developer and
// pushes it through the production road, so "it arrived on my phone" means the real pipeline works.

type Cron = { available?: boolean; scheduled?: boolean; schedule?: string | null; active?: boolean | null; lastRunAt?: string | null; lastRunStatus?: string | null; lastHttpStatus?: number | null; lastHttpAt?: string | null; lastHttpError?: string | null }
type Status = { vapidConfigured: boolean; devices: { userAgent: string; createdAt: string; lastSeenAt: string }[]; waiting: number; cron: Cron }
type SendResult = { inserted: number; claimed: number; sent: number; devices: number }

const TEMPLATES: { id: string; label: string; hint: string }[] = [
  { id: 'schedule', label: 'סידור פורסם', hint: 'מוביל ללוח המשמרות' },
  { id: 'shift_soon', label: 'משמרת מתחילה', hint: 'תזכורת שעה לפני' },
  { id: 'checklist_late', label: 'צ׳קליסט לא הוגש', hint: 'מוביל לצ׳קליסטים' },
  { id: 'checklist_gap', label: 'צ׳קליסט חסר (בעלים)', hint: 'מוביל לתיבת הצ׳קליסטים' },
  { id: 'open_shift', label: 'משמרת מוצעת לכולם', hint: 'מוסרים משמרת' },
  { id: 'swap_request', label: 'בקשת החלפה', hint: 'מחכה לתשובה' },
  { id: 'digest', label: 'ארבע התראות ביחד', hint: 'אמור להתכנס להודעה אחת' },
]

const time = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso)) : '—')
const device = (ua: string) => (/iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Edg\//.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'מכשיר')

async function call(payload: Record<string, unknown>): Promise<Response | null> {
  try {
    return await fetch('/api/staff/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  } catch {
    return null
  }
}

export default function DevPushPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    const res = await call({ action: 'dev_status' })
    if (!res?.ok) { setFailed(true); return }
    setStatus((await res.json()) as Status)
    setFailed(false)
  }, [])
  useEffect(() => { void load() }, [load])

  async function send(template: string) {
    haptic('select')
    setBusy(template)
    setMessage(null)
    const res = await call({ action: 'dev_send', template })
    setBusy(null)
    if (!res?.ok) { setMessage('השליחה נכשלה. בדקו חיבור ונסו שוב.'); return }
    const r = (await res.json()) as SendResult
    setMessage(
      r.devices === 0
        ? 'אין מכשיר רשום. הפעילו התראות בכרטיס למעלה, במכשיר שבו רוצים לבדוק.'
        : r.sent > 0
          ? `נשלח ל-${r.sent} ${r.sent === 1 ? 'מכשיר' : 'מכשירים'}. אמורה להגיע התראה תוך שניות.`
          : 'השרת ניסה לשלוח ושירות ההתראות סירב. נסו "שליחה ישירה" כדי לראות את הסיבה.'
    )
    void load()
  }

  async function direct() {
    haptic('select')
    setBusy('direct')
    setMessage(null)
    const res = await call({ action: 'test' })
    setBusy(null)
    if (!res?.ok) { setMessage('השליחה נכשלה.'); return }
    const r = (await res.json()) as { configured: boolean; subscriptions: number; sent: number; error: { statusCode: number | null; detail: string } | null }
    setMessage(!r.configured ? `מפתחות VAPID חסרים בשרת. ${r.error?.detail ?? ''}` : r.subscriptions === 0 ? 'אין מכשיר רשום.' : r.sent > 0 ? 'נשלחה בדיקה ישירה.' : `שירות ההתראות סירב: ${r.error?.statusCode ?? '?'} — ${r.error?.detail ?? ''}`)
  }

  const cron = status?.cron
  return (
    <section className="app-dev" aria-label="כלי מפתח להתראות">
      <div className="app-dev__head">
        <Beaker size={20} aria-hidden="true" />
        <div><h2>כלי מפתח · התראות</h2><p>שולח התראה אמיתית אליך בלבד, דרך אותו מסלול של התראות העבודה.</p></div>
        <button type="button" className="app-push__icon-button press" onClick={() => void load()} aria-label="רענון מצב"><RefreshCw size={17} aria-hidden="true" /></button>
      </div>

      {failed && <p className="app-notifications__error" role="alert">לא הצלחנו לטעון את המצב.</p>}
      {status && (
        <dl className="app-dev__status">
          <div><dt>מפתחות VAPID</dt><dd>{status.vapidConfigured ? 'מוגדרים' : 'חסרים בשרת'}</dd></div>
          <div><dt>מכשירים שלי</dt><dd>{status.devices.length === 0 ? 'אין. הפעילו התראות בכרטיס' : status.devices.map((d) => `${device(d.userAgent)} (${time(d.lastSeenAt)})`).join(' · ')}</dd></div>
          <div><dt>מחכות לשליחה</dt><dd>{status.waiting}</dd></div>
          <div>
            <dt>תזמון (Supabase)</dt>
            <dd>
              {!cron?.available ? 'לא זמין' : !cron.scheduled ? 'לא מתוזמן' : `${cron.active === false ? 'מושהה' : 'פעיל'} · ${cron.schedule} · ריצה אחרונה ${time(cron.lastRunAt)} (${cron.lastRunStatus ?? '—'})`}
              {cron?.available && cron.scheduled && <small> · תשובת האפליקציה {cron.lastHttpStatus ?? '—'} ב־{time(cron.lastHttpAt)}{cron.lastHttpError ? ` · ${cron.lastHttpError}` : ''}</small>}
            </dd>
          </div>
        </dl>
      )}

      <div className="app-dev__grid">
        {TEMPLATES.map((t) => (
          <button key={t.id} type="button" className="app-dev__button press" disabled={busy !== null} onClick={() => void send(t.id)}>
            <strong>{busy === t.id ? 'שולח…' : t.label}</strong><small>{t.hint}</small>
          </button>
        ))}
        <button type="button" className="app-dev__button app-dev__button--quiet press" disabled={busy !== null} onClick={() => void direct()}>
          <strong>{busy === 'direct' ? 'שולח…' : 'שליחה ישירה'}</strong><small>בלי תיבת הדואר, מציג שגיאה אמיתית</small>
        </button>
      </div>
      {message && <p className="app-push__note" role="status">{message}</p>}
    </section>
  )
}
