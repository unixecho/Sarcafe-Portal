'use client'

import { useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { CalendarDays, ClipboardCheck, FileText, ShoppingBag, Upload, Download, LockKeyhole } from 'lucide-react'
import type { StaffRecords } from '@/lib/staff/records-types'
import EmojiAvatarPicker from '@/components/staff/EmojiAvatarPicker'
import './records.css'

const TABS = [
  { id: 'shifts', label: 'משמרות', Icon: CalendarDays },
  { id: 'checklists', label: 'צ׳קליסטים', Icon: ClipboardCheck },
  { id: 'orders', label: 'אירועים', Icon: ShoppingBag },
  { id: 'payslips', label: 'תלושים', Icon: FileText },
] as const
const kinds: Record<string, string> = { opening: 'פתיחה', handover: 'העברת משמרת', closing: 'סגירה' }
const status: Record<string, string> = { pending: 'ממתין', in_progress: 'במילוי', submitted: 'הוגש', open: 'בטיפול', completed: 'הושלמה', void: 'בוטלה' }
const date = (value: string) => new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeZone: 'Asia/Jerusalem' }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value))
const monthLabel = (value: string) => new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' }).format(new Date(`${value.slice(0, 7)}-15T12:00:00Z`))

export default function StaffRecordsView({ initial, owner = false, children }: { initial: StaffRecords; owner?: boolean; children?: React.ReactNode }) {
  const [records, setRecords] = useState(initial)
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('shifts')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [selectedFile, setSelectedFile] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const me = records.employee
  const name = [me.first_name, me.last_name].filter(Boolean).join(' ') || me.display_name || 'עובד חדש'

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setSuccess('')
    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch(`/api/owner/staff/${me.id}/payslips`, { method: 'POST', body: form })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message || 'לא הצלחנו להעלות את התלוש')
      formRef.current?.reset()
      setSelectedFile('')
      setSuccess('התלוש הועלה ונמצא בתיק העובד')
      const refreshed = await fetch(`/api/owner/staff/${me.id}/records`, { cache: 'no-store' })
      if (!refreshed.ok) throw new Error('התלוש נשמר. רעננו את העמוד כדי לראות אותו.')
      setRecords(await refreshed.json())
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'לא הצלחנו לשמור. נסו שוב.') }
    finally { setBusy(false) }
  }

  return <div className="staff-records" dir="rtl">
    <section className="sr-profile rise">
      <span className="sr-avatar" aria-hidden="true">{me.avatar_emoji || name.trim().slice(0, 1)}</span>
      <div><p className="sr-caption">{owner ? 'תיק עובד' : 'החשבון שלי'}</p><h1>{name}</h1>
        <p>{me.employee_no ? <>מספר עובד HYP <bdi>{me.employee_no}</bdi></> : 'מספר עובד עדיין לא הוגדר'}{!me.active && ' · לא פעיל'}</p>
      </div>
    </section>
    {!owner && <EmojiAvatarPicker value={me.avatar_emoji} onChange={(emoji) => setRecords((current) => ({ ...current, employee: { ...current.employee, avatar_emoji: emoji } }))} />}
    {children}
    <div className="sr-summary" aria-label="פעילות מתועדת">
      <div><strong>{records.shifts.length}</strong><span>שיבוצים שפורסמו</span></div>
      <div><strong>{records.checklists.filter((c) => c.status === 'submitted').length}</strong><span>צ׳קליסטים שהוגשו</span></div>
      <div><strong>{records.orders.length}</strong><span>הזמנות אירועים</span></div>
    </div>
    <nav className="sr-tabs" aria-label="חלקי תיק העובד">
      {TABS.map(({ id, label, Icon }) => <button key={id} type="button" className="press" aria-pressed={tab === id} onClick={() => setTab(id)}><Icon size={18} aria-hidden="true"/><span>{label}</span></button>)}
    </nav>
    <section className="sr-content" aria-label={TABS.find((t) => t.id === tab)?.label}>
      {tab === 'shifts' && <>
        <p className="sr-note">השיבוצים מתוך הלוחות שפורסמו. זמני נוכחות ושכר יתווספו עם חיבור HYP.</p>
        {records.shifts.length ? <ul className="sr-list">{records.shifts.map((s) => <li key={`${s.id}-${s.date}`}><span className="sr-row-icon"><CalendarDays size={20}/></span><div><strong>{date(s.date)}</strong><small>{s.branch} · {s.label}</small></div><bdi className="sr-meta">{s.start}–{s.end}</bdi></li>)}</ul> : <Empty>עדיין אין משמרות שפורסמו לעובד הזה</Empty>}
      </>}
      {tab === 'checklists' && (records.checklists.length ? <ul className="sr-list">{records.checklists.map((c) => <li key={c.id}><span className="sr-row-icon"><ClipboardCheck size={20}/></span><div><strong>{kinds[c.kind] || c.kind}</strong><small>{date(c.submitted_at || c.created_at)} · {status[c.status] || c.status}</small>{c.issues?.length > 0 && <details><summary>{c.issue_count} דיווחים</summary>{c.issues.map((issue, i) => <p key={i}>{issue.label || 'דיווח'}{issue.reason ? ` · ${issue.reason}` : ''}</p>)}</details>}</div><span className={`sr-meta${c.issue_count > 0 ? ' sr-attention' : ''}`}>{c.issue_count > 0 ? 'דורש תשומת לב' : status[c.status]}</span></li>)}</ul> : <Empty>הצ׳קליסט הראשון שיוגש יופיע כאן</Empty>)}
      {tab === 'orders' && <>
        <p className="sr-note">הזמנות שהעובד הזין בקופת האירועים. נתוני הקופה הרגילה יתווספו לאחר חיבור HYP. מוצגות עד 100 הזמנות אחרונות.</p>
        {records.orders.length ? <ul className="sr-list">{records.orders.map((o) => <li key={o.id}><span className="sr-row-icon"><ShoppingBag size={20}/></span><div><strong>הזמנה <bdi>#{o.ticket_no}</bdi></strong><small>{date(o.created_at)} · {status[o.status] || o.status}</small></div><bdi className="sr-meta">{new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(o.total_agorot / 100)}</bdi></li>)}</ul> : <Empty>כשיוזנו הזמנות באירוע הן יופיעו כאן</Empty>}
      </>}
      {tab === 'payslips' && <>
        {!records.canReadPayslips ? <div className="sr-empty"><LockKeyhole size={28}/><p>תלושי השכר נשמרים פרטיים. התחברו עם Google כדי לפתוח אותם.</p><Link className="sr-action press" href="/login?next=/staff/profile">כניסה עם Google</Link></div> : <>
          {owner && <form ref={formRef} className="sr-upload" onSubmit={upload}>
            <h2>העלאת תלוש שכר</h2>
            <div className="sr-upload-fields"><label>חודש שכר<input name="month" type="month" required disabled={busy}/></label><label>קובץ תלוש<span className="sr-file-control"><FileText size={19} aria-hidden="true"/><span>{selectedFile || 'בחירת PDF או תמונה'}</span><input name="file" type="file" accept="application/pdf,image/png,image/jpeg" required disabled={busy} onChange={(event) => setSelectedFile(event.target.files?.[0]?.name || '')}/></span></label></div>
            <p className="sr-note">PDF, PNG או JPG עד 4MB. זמין לבעלים ולעובד בלבד.</p>
            <button type="submit" className="sr-action press" disabled={busy}><Upload size={18}/>{busy ? 'מעלה את התלוש…' : 'העלאת תלוש'}</button>
            {error && <p role="alert" className="sr-attention">{error}</p>}{success && <p role="status">{success}</p>}
          </form>}
          {records.payslips.length ? <ul className="sr-list">{records.payslips.map((p) => <li key={p.id}><span className="sr-row-icon"><FileText size={20}/></span><div><strong>{monthLabel(p.pay_month)}</strong><small>{p.file_name} · הועלה {date(p.uploaded_at)}</small></div><a className="sr-download press" href={`/api/staff/payslips/${p.id}`} aria-label={`הורדת תלוש ${monthLabel(p.pay_month)}`}><Download size={20}/>הורדה</a></li>)}</ul> : <Empty>תלושי השכר שיועלו יופיעו כאן</Empty>}
        </>}
      </>}
    </section>
  </div>
}
function Empty({ children }: { children: React.ReactNode }) { return <p className="sr-empty">{children}</p> }
