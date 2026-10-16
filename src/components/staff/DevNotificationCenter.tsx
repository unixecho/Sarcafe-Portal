'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Building2, CheckCheck, CheckCircle2, ChevronDown, ClipboardCheck, Terminal } from 'lucide-react'
import { AlertText } from '@/components/app/DashboardNotifications'
import type { Centre, CentreRow } from '@/lib/push/dev-centre'
import type { AlertAudience } from '@/lib/push/staff-rules'
import './dev-centre.css'

// The developer's notification centre (owner, 2026-10-16: "a custom notification centre just for me, 3 containers: notifications
// for devs, for manager/owner, and for me as an employee"). The developer account receives all three kinds of alert in one
// inbox; here each kind has its own container, so a test of the system never hides a missing checklist and a missing checklist
// never hides your own shift. Every alert opens the thing it is about (the same resolver as the phone push), and each shows
// what the push service said about it, which is the answer to "did it reach my phone?".

const POLL_MS = 30_000
const SHOWN = 6

const BOXES: { id: AlertAudience; icon: typeof Terminal; title: string; who: string; empty: string }[] = [
  { id: 'developer', icon: Terminal, title: 'התראות מפתח', who: 'בדיקות מלוח המפתח והודעות מערכת', empty: 'אין התראות מערכת. התראות בדיקה שתשלחו לעצמכם ותקלות שהמערכת תדווח יופיעו כאן.' },
  { id: 'owner', icon: Building2, title: 'התראות הנהלה', who: 'מה שמגיע לבעלים ולמנהלים: חוסרים ופערים, צ׳קליסט שלא הוגש, אילוצים ובקשות להחלטה', empty: 'אין התראות הנהלה. דוח הבוקר, צ׳קליסטים שלא הוגשו ובקשות שמחכות להחלטה יופיעו כאן.' },
  { id: 'employee', icon: ClipboardCheck, title: 'התראות עובד', who: 'המשמרות והצ׳קליסטים שלך כעובד/ת', empty: 'אין התראות עובד. תזכורות למשמרת, צ׳קליסטים והחלפות יופיעו כאן.' },
]

const timeFormat = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function unreadOf(rows: CentreRow[]): Record<AlertAudience, number> {
  const unread: Record<AlertAudience, number> = { developer: 0, owner: 0, employee: 0 }
  for (const row of rows) if (!row.read_at) unread[row.audience] += 1
  return unread
}

/** What the push service said, in words: "reached 2 of 2 phones", "no phone registered". Null when the alert was never pushed. */
function deliveryText(push: CentreRow['push']): string | null {
  if (!push) return null
  if (push.devices === 0) return 'אין מכשיר רשום'
  return push.accepted === push.devices ? (push.devices === 1 ? 'נשלח למכשיר' : `נשלח ל־${push.devices} מכשירים`) : `נשלח ל־${push.accepted} מתוך ${push.devices} מכשירים`
}

export default function DevNotificationCenter({ initial, health }: { initial: Centre; /** problems the system health check found (shown in the first container) */ health: { problems: number } }) {
  const [rows, setRows] = useState(initial.rows)
  const [error, setError] = useState(false)
  const [saving, setSaving] = useState<AlertAudience | null>(null)
  const [expanded, setExpanded] = useState<Partial<Record<AlertAudience, boolean>>>({})
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/staff/dev/notifications', { cache: 'no-store' })
      if (!response.ok) throw new Error('centre')
      const data = await response.json() as Centre
      if (alive.current) { setRows(data.rows); setError(false) }
    } catch { if (alive.current) setError(true) }
  }, [])
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') void load() }
    const timer = window.setInterval(visible, POLL_MS)
    document.addEventListener('visibilitychange', visible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [load])

  const unread = useMemo(() => unreadOf(rows), [rows])
  const total = unread.developer + unread.owner + unread.employee
  // The tab in the slider shows the same number.
  useEffect(() => { window.dispatchEvent(new CustomEvent('sarcafe:lens-badge', { detail: { lens: 'alerts', count: total } })) }, [total])

  async function markRead(ids: string[], box: AlertAudience | null) {
    if (!ids.length) return
    if (box) setSaving(box)
    try {
      const response = await fetch('/api/staff/dev/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }), keepalive: true })
      if (!response.ok) throw new Error('read')
      const now = new Date().toISOString()
      setRows((current) => current.map((row) => (ids.includes(row.id) ? { ...row, read_at: now } : row)))
      setError(false)
    } catch { setError(true) }
    finally { setSaving(null) }
  }

  return (
    <section className="dnc" aria-label="מרכז ההתראות שלך">
      {error && <p className="dnc-error" role="alert">לא הצלחנו לרענן את ההתראות. <button type="button" onClick={() => void load()}>ניסיון נוסף</button></p>}
      <div className="dnc-grid">
        {BOXES.map((box) => {
          const mine = rows.filter((row) => row.audience === box.id)
          const open = expanded[box.id] === true
          const visible = open ? mine : mine.slice(0, SHOWN)
          const waiting = unread[box.id]
          const unreadIds = mine.filter((row) => !row.read_at).map((row) => row.id)
          return (
            <section key={box.id} className={`dnc-box dnc-box--${box.id}`} aria-labelledby={`dnc-${box.id}`}>
              <header className="dnc-head">
                <span className="dnc-icon" aria-hidden="true"><box.icon size={21} strokeWidth={1.9} /></span>
                <div className="dnc-title">
                  <h2 id={`dnc-${box.id}`}>{box.title}</h2>
                  <p>{box.who}</p>
                </div>
                {waiting > 0 && <span className="dnc-count" aria-label={`${waiting} שלא נקראו`}>{waiting}</span>}
              </header>

              {box.id === 'developer' && (
                <Link href="/staff/dev?view=dev" className={`dnc-health${health.problems > 0 ? ' dnc-health--bad' : ''}`}>
                  {health.problems > 0 ? <AlertTriangle size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
                  <span>{health.problems > 0 ? (health.problems === 1 ? 'דבר אחד דורש טיפול בבריאות המערכת' : `${health.problems} דברים דורשים טיפול בבריאות המערכת`) : 'בריאות המערכת תקינה'}</span>
                </Link>
              )}

              {mine.length === 0 ? (
                <p className="dnc-empty"><CheckCheck size={18} aria-hidden="true" />{box.empty}</p>
              ) : (
                <ul className="dnc-list">
                  {visible.map((row) => {
                    const delivery = deliveryText(row.push)
                    return (
                      <li key={row.id}>
                        <Link href={row.href} className={`dnc-item${row.read_at ? '' : ' dnc-item--unread'}`} onClick={() => { if (!row.read_at) void markRead([row.id], null) }}>
                          <span className="dnc-dot" aria-hidden="true" />
                          <span className="dnc-text">
                            <strong><AlertText text={row.title} />{!row.read_at && <span className="sr-only"> (חדש)</span>}</strong>
                            {row.body && <small><AlertText text={row.body} /></small>}
                            <time dateTime={row.created_at}>{timeFormat.format(new Date(row.created_at))}{delivery ? ` · ${delivery}` : ''}</time>
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}

              {(waiting > 0 || mine.length > SHOWN) && (
                <footer className="dnc-foot">
                  {waiting > 0 && <button type="button" className="dnc-link press" disabled={saving === box.id} onClick={() => void markRead(unreadIds, box.id)}><CheckCheck size={16} aria-hidden="true" />{saving === box.id ? 'שומר…' : 'סימון הכול כנקרא'}</button>}
                  {mine.length > SHOWN && <button type="button" className="dnc-link press" aria-expanded={open} onClick={() => setExpanded((current) => ({ ...current, [box.id]: !open }))}><ChevronDown size={16} aria-hidden="true" className={open ? 'dnc-flip' : ''} />{open ? 'הצגת פחות' : `הצגת עוד ${mine.length - SHOWN}`}</button>}
                </footer>
              )}
            </section>
          )
        })}
      </div>
    </section>
  )
}
