'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell, BellRing, CheckCheck } from 'lucide-react'
import { pushPathFor } from '@/lib/push/staff-rules'

// A range such as 13:00–19:00 or 18/10–24/10 inside Hebrew text is flipped by the bidi rules (it would read 19:00–13:00).
// The rest of the app isolates ranges left-to-right; the alert text does the same.
const RANGE = /(\d{1,2}[:/]\d{1,2}[–-]\d{1,2}[:/]\d{1,2})/
export function AlertText({ text }: { text: string }) {
  return <>{text.split(RANGE).map((part, index) => (index % 2 === 1 ? <span key={index} dir="ltr" style={{ whiteSpace: 'nowrap' }}>{part}</span> : part))}</>
}

export type DashboardNotification = { id: string; kind?: string; title: string; body: string | null; link?: Record<string, unknown> | null; created_at: string; read_at: string | null }

// `googleSignedIn`: the schedule needs a Google sign-in, so a number + code employee is sent through the door instead.
// `manager`: can open the manager's schedule (an owner or general manager), which decides where a swap alert goes.
type Props = { initialNotifications?: DashboardNotification[]; initialUnread?: number; initialError?: boolean; scheduleHref?: string; googleSignedIn?: boolean; manager?: boolean }

export default function DashboardNotifications({ initialNotifications = [], initialUnread = 0, initialError = false, scheduleHref = '/staff/schedule', googleSignedIn = true, manager = false }: Props) {
  const [notifications, setNotifications] = useState(initialNotifications)
  const [unread, setUnread] = useState(initialUnread)
  const [error, setError] = useState(initialError)
  const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/staff/notifications', { cache: 'no-store' })
      if (!response.ok) throw new Error('notifications')
      const data = await response.json() as { notifications: DashboardNotification[]; unread: number }
      setNotifications(data.notifications)
      setUnread(data.unread)
      setError(false)
    } catch { setError(true) }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30000)
    const visible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', visible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [load])

  async function markRead(ids: string[]) {
    if (!ids.length || saving) return
    setSaving(true)
    try {
      const response = await fetch('/api/staff/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }), keepalive: true })
      if (!response.ok) throw new Error('read')
      const now = new Date().toISOString()
      setNotifications((current) => current.map((item) => ids.includes(item.id) ? { ...item, read_at: now } : item))
      setUnread((count) => Math.max(0, count - ids.length))
      setError(false)
    } catch { setError(true) }
    finally { setSaving(false) }
  }

  // Each alert opens what it is about: the exact checklist, the requests tab, the availability tab… (the same
  // resolver the phone push uses, so a tap on the push and a tap on this list land in the same place).
  const hrefFor = (item: DashboardNotification) => {
    const path = pushPathFor(item.kind ?? '', item.link ?? null, { manager, title: item.title })
    return !googleSignedIn && (path.startsWith('/staff/schedule') || path.startsWith('/owner/')) ? '/login?next=/staff/schedule' : path
  }
  const shown = notifications.slice(0, 5)
  const unreadIds = shown.filter((item) => !item.read_at).map((item) => item.id)
  return (
    <section className="app-section app-notifications" aria-label="עדכונים">
      <div className="app-section__heading">
        <div className="app-notifications__head"><Bell size={17} aria-hidden="true" /><h2>עדכונים בשבילך</h2>{unread > 0 && <span className="app-notifications__count" aria-label={`${unread} עדכונים שלא נקראו`}>{unread}</span>}</div>
        {unreadIds.length > 0 && <button className="app-notifications__action press" disabled={saving} onClick={() => void markRead(unreadIds)}>{saving ? 'שומר…' : 'סימון כנקרא'}</button>}
      </div>
      <div className="app-group">
        {error && <p className="app-notifications__error" role="alert">לא הצלחנו לרענן את העדכונים. <button className="app-notifications__action" onClick={() => void load()}>ניסיון נוסף</button></p>}
        {shown.map((item) => (
          <article key={item.id} className={`app-notice${item.read_at ? '' : ' app-notice--unread'}`}>
            <Link href={hrefFor(item)} onClick={() => { if (!item.read_at) void markRead([item.id]) }}>
              <strong><AlertText text={item.title} /></strong>{item.body && <p><AlertText text={item.body} /></p>}
              <time dateTime={item.created_at}>{new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(item.created_at))}</time>
            </Link>
          </article>
        ))}
        {!error && shown.length === 0 && <div className="app-notifications__empty"><CheckCheck size={20} aria-hidden="true" /><span>אין עדכונים חדשים. שיבוצים ואישורי החלפות יופיעו כאן.</span></div>}
        {unread > shown.filter((item) => !item.read_at).length && <Link className="app-row" href={scheduleHref}><BellRing size={18} aria-hidden="true" /><span className="app-row__copy"><strong>לכל העדכונים בלוח המשמרות</strong></span></Link>}
      </div>
    </section>
  )
}