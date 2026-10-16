'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Ban, Copy, Download, ExternalLink, Pencil, QrCode, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import QRCode from 'qrcode'
import BranchSwitcher from '@/components/BranchSwitcher'
import type { Branch, BranchSlug } from '@/lib/branches'
import { branchColor } from '@/lib/branches/color'
import { advanceClock, checklistPhase, dayLabel, type ChecklistPhase, type WallClock } from '@/lib/checklists/window'
import { KIND_LABELS, type ChecklistKind } from '@/lib/checklists/types'
import IssueReport from '@/components/checklists/IssueReport'
import { messageOf } from '@/components/staff/types'
import './checklists.css'

type AssignmentRow = {
  id: string
  /** Every copy of this checklist that is still asked of someone (more than one only when nobody was picked and two people share the shift). */
  ids: string[]
  /** The owner picked this person to do the shift's checklists. */
  lead: boolean
  staffId: string
  staffColor: string | null
  shiftId: string
  staffName: string
  employeeNo: string | null
  shiftDate: string
  startTime: string
  endTime: string
  kind: ChecklistKind
  status: 'pending' | 'in_progress' | 'submitted' | 'covered'
  /** The owner dismissed it before it was sent (see isDismissed in window.ts); managerNote is then the reason. */
  dismissed: boolean
  issueCount: number
  issues: { itemId: string; label: string; category: string; type: string; reason: string }[]
  submittedAt: string | null
  seenAt: string | null
  resolvedAt: string | null
  managerNote: string | null
}
type Payload = { branch: { id: string; slug: string; name: { he?: string } }; serverNow: WallClock; assignments: AssignmentRow[] }
type Tab = 'inbox' | 'coverage'

// What the owner reads in the status chip. A future checklist that was never started is greyed out and
// cannot be touched (the server refuses it too); a started one that is still open says so.
const STATUS_TEXT: Record<ChecklistPhase, string> = { submitted: 'נשלח', covered: 'מטופל ע״י עמית', dismissed: 'בוטל', upcoming: 'עתידי', open: 'פתוח להגשה', late: 'לא הוגש בזמן' }
const initialOf = (name: string) => Array.from(name.trim())[0] ?? '·'

// `focusId` is the checklist an alert named (/owner/checklists/<id>): the tracker opens on it and scrolls it into view.
export default function OwnerChecklistWorkspace({ branches, initialBranch, focusId = null }: { branches: Branch[]; initialBranch: BranchSlug; focusId?: string | null }) {
  const [branch, setBranch] = useState<BranchSlug>(initialBranch)
  const [tab, setTab] = useState<Tab>(focusId ? 'coverage' : 'inbox')
  const [openIssues, setOpenIssues] = useState(0)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const focused = useRef(false)
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [entryUrl, setEntryUrl] = useState('')
  const [entryQr, setEntryQr] = useState('')
  const [copied, setCopied] = useState(false)
  const fetchedAt = useRef(Date.now())
  const [, setTick] = useState(0)
  useEffect(() => {
    // Rows move from "future" to "open" on their own while the page stays open.
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const url = `${window.location.origin}/login?next=/staff/checklists&quick=1`
    setEntryUrl(url)
    void QRCode.toDataURL(url, { width: 420, margin: 2, errorCorrectionLevel: 'H', color: { dark: '#150f0c', light: '#ffffff' } }).then(setEntryQr)
  }, [])

  async function copyEntryUrl() {
    await navigator.clipboard.writeText(entryUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  async function load() {
    if (!branch) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/owner/checklists?branch=${encodeURIComponent(branch)}`, { cache: 'no-store' })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(messageOf(payload, 'לא הצלחנו לטעון את הצ׳קליסטים.'))
      fetchedAt.current = Date.now()
      setData(payload as Payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא הצלחנו לטעון את הצ׳קליסטים.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => void load(), [branch])

  const clock = data ? advanceClock(data.serverNow, Date.now() - fetchedAt.current) : null
  const tracked = (() => {
    if (!data || !clock) return { rows: [] as (AssignmentRow & { phase: ChecklistPhase })[], days: [] as { date: string; rows: (AssignmentRow & { phase: ChecklistPhase })[] }[], late: 0 }
    const hasOpening = new Set(data.assignments.filter((row) => row.kind === 'opening').map((row) => row.shiftId))
    const rows = data.assignments
      .filter((row) => row.shiftDate)
      .map((row) => ({ ...row, phase: checklistPhase({ date: row.shiftDate, startTime: row.startTime, endTime: row.endTime, kind: row.kind, status: row.status, dismissed: row.dismissed, shiftHasOpening: hasOpening.has(row.shiftId) }, clock) }))
    // Today and what is coming first (nearest first), then what already happened (latest first).
    const ahead = rows.filter((row) => row.shiftDate >= clock.date)
    const behind = rows.filter((row) => row.shiftDate < clock.date)
    const group = (list: typeof rows) => {
      const days: { date: string; rows: typeof rows }[] = []
      for (const row of list) {
        const last = days[days.length - 1]
        if (last && last.date === row.shiftDate) last.rows.push(row)
        else days.push({ date: row.shiftDate, rows: [row] })
      }
      return days
    }
    return { rows, days: [...group(ahead), ...group(behind).reverse()], late: rows.filter((row) => row.phase === 'late').length }
  })()


  async function act(action: 'seen' | 'resolve' | 'dismiss' | 'restore', assignmentId: string, note?: string) {
    setBusyId(assignmentId)
    try {
      const res = await fetch('/api/owner/checklists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, assignmentId, ...(note ? { note } : {}) }) })
      if (!res.ok) throw new Error(messageOf(await res.json().catch(() => null), 'לא הצלחנו לעדכן.'))
      setDismissing(null)
      setReason('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא הצלחנו לעדכן.')
    } finally {
      setBusyId(null)
    }
  }

  // The checklist an alert named: once the list has loaded, bring its row into the middle of the screen.
  useEffect(() => {
    if (!focusId || focused.current || tab !== 'coverage' || !data) return
    // An alert names one copy of a checklist; the tracker shows one line per checklist, so find the line that holds it.
    const line = data.assignments.find((candidate) => candidate.ids.includes(focusId))
    const row = line ? document.getElementById(`ck-row-${line.id}`) : null
    if (!row) return
    focused.current = true
    row.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [data, tab, focusId])

  return (
    <div className="ck-wrap">
      <BranchSwitcher branches={branches} value={branch} onChange={setBranch} />
      <section className="ck-hero">
        <div className="sch-row"><div style={{ flex: 1 }}><p className="sch-sub" style={{ margin: 0 }}>שליטה מלאה בטפסים ובדיווחים</p><h1 style={{ margin: '4px 0' }}>צ׳קליסטים לעובדים</h1></div>{openIssues > 0 && <button type="button" className="ck-status ck-status--pending press" onClick={() => setTab('inbox')}><AlertTriangle size={16} /> {openIssues === 1 ? 'דבר אחד לטיפול' : `${openIssues} דברים לטיפול`}</button>}</div>
        <p style={{ margin: '8px 0 0', color: 'var(--text-dim)' }}>כל טופס מחובר אוטומטית לשיבוץ בלוח המשמרות. את הטפסים עצמם עורכים בניהול הסניף: לכל סניף יש טפסים משלו.</p>
        <Link href={`/owner/branches/${branch}?tab=checklists`} className="bm-textlink" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8 }}><Pencil size={15} aria-hidden="true" />עריכת הטפסים של הסניף</Link>
      </section>
      <details className="ck-card ck-entry-card">
        <summary className="sch-row press" style={{ cursor: 'pointer', listStyle: 'none' }}>
          <QrCode size={21} color="var(--neon)" aria-hidden="true" />
          <span style={{ flex: 1 }}><strong>כניסת עובדים מהירה ב־QR</strong><span className="sch-sub" style={{ display: 'block' }}>קישור קבוע להדפסה על השלט בעגלה</span></span>
        </summary>
        <div className="ck-entry-grid">
          {entryQr && <img className="ck-entry-qr" src={entryQr} alt="QR לכניסה לצ׳קליסט העובדים" />}
          <div className="ck-wrap" style={{ gap: 9 }}>
            <p className="sch-sub">הסריקה פותחת ישירות את כניסת מספר העובד והקוד, ואחרי ההתחברות מחזירה לצ׳קליסט.</p>
            <code className="ck-entry-url">{entryUrl}</code>
            <div className="sch-row" style={{ flexWrap: 'wrap' }}>
              <button className="sch-btn sch-btn--sm press" type="button" onClick={() => void copyEntryUrl()}><Copy size={16} />{copied ? 'הועתק ✓' : 'העתקת קישור'}</button>
              {entryQr && <a className="sch-btn sch-btn--sm press" href={entryQr} download="sarcafe-checklist-qr.png"><Download size={16} />הורדת QR</a>}
              <a className="sch-btn sch-btn--sm press" href="/login?next=/staff/checklists&quick=1" target="_blank" rel="noreferrer"><ExternalLink size={16} />בדיקת הקישור</a>
            </div>
          </div>
        </div>
      </details>
      <div className="ck-tabs" role="tablist" aria-label="ניהול צ׳קליסטים">
        <button role="tab" aria-selected={tab === 'inbox'} onClick={() => setTab('inbox')}>חוסרים ותקלות {openIssues ? `(${openIssues})` : ''}</button>
        <button role="tab" aria-selected={tab === 'coverage'} onClick={() => setTab('coverage')}>מעקב משמרות</button>
      </div>
      {error && <div className="sch-error" role="alert">{error}<button className="sch-btn sch-btn--sm press" onClick={() => void load()}>ניסיון נוסף</button></div>}
      {loading && !data ? <div className="sk" style={{ height: 180 }} /> : null}

      {/* Always mounted (hidden on other tabs) so the count in the tab and the header is known from the start. */}
      <div hidden={tab !== 'inbox'}><IssueReport branch={branch} onCount={setOpenIssues} /></div>

      {tab === 'coverage' && data && clock && <div className="ck-wrap ck-track" dir="rtl">
        {tracked.late > 0 && <div className="sch-error"><AlertTriangle size={18} /> {tracked.late === 1 ? 'צ׳קליסט אחד לא הוגש בזמן.' : `${tracked.late} צ׳קליסטים לא הוגשו בזמן.`}</div>}
        {tracked.days.map((day) => <section key={day.date} className="ck-track-day" aria-label={dayLabel(day.date)}>
          <div className={`ck-spacer${day.date === clock.date ? ' ck-spacer--today' : ''}`} role="separator"><span>{dayLabel(day.date)}{day.date === clock.date ? ' · היום' : ''}</span></div>
          {day.rows.map((row) => {
            const future = row.phase === 'upcoming'
            const started = row.status === 'in_progress' && row.phase !== 'submitted'
            // Only a checklist that is due (open or late) can be dismissed; a future one stays untouchable, as asked.
            const canDismiss = row.phase === 'open' || row.phase === 'late'
            const confirming = dismissing === row.id
            return <article key={row.id} id={`ck-row-${row.id}`} className={`ck-track-row ck-track-row--${row.phase}${focusId && row.ids.includes(focusId) ? ' ck-track-row--focus' : ''}`} aria-disabled={future || undefined} inert={future || undefined} style={{ '--emp': row.staffColor ?? 'var(--line)' } as React.CSSProperties}>
              <span className="ck-person-dot" aria-hidden="true">{initialOf(row.staffName)}</span>
              <div className="ck-track-main">
                <strong>{row.staffName}</strong>
                <div className="ck-track-meta">
                  <span className="ck-branch-pill" style={{ '--branch': branchColor(data.branch.slug, branches) } as React.CSSProperties}><i aria-hidden="true" />{data.branch.name?.he ?? data.branch.slug}</span>
                  <span>{KIND_LABELS[row.kind]}</span>
                  <span dir="ltr">{row.startTime}–{row.endTime}</span>
                  {row.lead && <span className="ck-lead-tag" title="נבחר/ה על ידי הנהלה למלא את הצ׳קליסטים של המשמרת">אחראי/ת צ׳קליסטים</span>}
                </div>
              </div>
              <div className="ck-track-state">
                <span className={`ck-status ck-status--${row.phase}`}>{started && row.phase !== 'late' ? 'בתהליך' : STATUS_TEXT[row.phase]}</span>
                {row.issueCount > 0 && <span className="ck-status ck-status--pending">{row.issueCount} ליקויים</span>}
              </div>
              {row.phase === 'dismissed' && <div className="ck-track-note">בוטל על ידי הנהלה, העובד/ת לא צריכ/ה להגיש{row.managerNote ? ` · ${row.managerNote}` : ''}.</div>}
              {(canDismiss || row.phase === 'dismissed') && <div className="ck-track-actions">
                {row.phase === 'dismissed'
                  ? <button type="button" className="sch-btn sch-btn--sm press" disabled={busyId === row.id} onClick={() => void act('restore', row.id)}><RotateCcw size={16} aria-hidden="true" /> החזרת הצ׳קליסט</button>
                  : confirming
                    ? <>
                        <input className="sch-input" value={reason} maxLength={300} placeholder="סיבה (לא חובה)" aria-label="סיבת הביטול" onChange={(event) => setReason(event.target.value)} />
                        <button type="button" className="sch-btn sch-btn--sm sch-btn--ok press" disabled={busyId === row.id} onClick={() => void act('dismiss', row.id, reason.trim() || undefined)}><Ban size={16} aria-hidden="true" /> {busyId === row.id ? 'מבטל…' : 'אישור ביטול'}</button>
                        <button type="button" className="sch-btn sch-btn--sm sch-btn--ghost press" onClick={() => { setDismissing(null); setReason('') }}>חזרה</button>
                      </>
                    : <button type="button" className="sch-btn sch-btn--sm press" onClick={() => { setDismissing(row.id); setReason('') }}><Ban size={16} aria-hidden="true" /> ביטול הצ׳קליסט</button>}
              </div>}
            </article>
          })}
        </section>)}
        {tracked.rows.length === 0 && <section className="ck-card"><strong>עוד אין משמרות עם צ׳קליסטים</strong><span className="sch-sub">לאחר פרסום לוח המשמרות, הדרישות יופיעו כאן אוטומטית.</span></section>}
      </div>}

    </div>
  )
}
