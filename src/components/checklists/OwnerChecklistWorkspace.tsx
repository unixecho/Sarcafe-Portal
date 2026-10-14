'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Ban, CheckCircle2, ClipboardList, Copy, Download, ExternalLink, Eye, FilePlus2, Plus, QrCode, RotateCcw, Send, Trash2 } from 'lucide-react'
import QRCode from 'qrcode'
import BranchSwitcher from '@/components/BranchSwitcher'
import type { Branch, BranchSlug } from '@/lib/branches'
import { branchColor } from '@/lib/branches/color'
import { advanceClock, checklistPhase, dayLabel, type ChecklistPhase, type WallClock } from '@/lib/checklists/window'
import { KIND_LABELS, type ChecklistDefinition, type ChecklistKind } from '@/lib/checklists/types'
import IssueReport from '@/components/checklists/IssueReport'
import { messageOf } from '@/components/staff/types'
import './checklists.css'

type TemplateRow = { id: string; kind: ChecklistKind; name: string; version: number; definition: ChecklistDefinition; published_at: string }
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
type Payload = { branch: { id: string; slug: string; name: { he?: string } }; serverNow: WallClock; templates: TemplateRow[]; assignments: AssignmentRow[] }
type Tab = 'inbox' | 'coverage' | 'builder'

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
  const [kind, setKind] = useState<ChecklistKind>('opening')
  const [draft, setDraft] = useState<ChecklistDefinition | null>(null)
  const [draftName, setDraftName] = useState('')
  const [publishing, setPublishing] = useState(false)
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

  const selected = data?.templates.find((template) => template.kind === kind) ?? null
  useEffect(() => {
    if (!selected || !branch) return setDraft(null)
    const saved = localStorage.getItem(`sarcafe:checklist-draft:${branch}:${selected.kind}:${selected.version}`)
    try {
      const parsed = saved ? JSON.parse(saved) as ChecklistDefinition | { name?: string; definition?: ChecklistDefinition } : null
      if (parsed && 'definition' in parsed && parsed.definition) {
        setDraft(parsed.definition)
        setDraftName(parsed.name || selected.name)
      } else {
        setDraft(parsed && 'categories' in parsed ? parsed : structuredClone(selected.definition))
        setDraftName(selected.name)
      }
    } catch { setDraft(structuredClone(selected.definition)); setDraftName(selected.name) }
  }, [selected?.id, branch])
  useEffect(() => {
    if (!draft || !selected || !branch) return
    localStorage.setItem(`sarcafe:checklist-draft:${branch}:${selected.kind}:${selected.version}`, JSON.stringify({ name: draftName, definition: draft }))
  }, [draft, draftName, selected?.id, branch])
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
  const builderDirty = Boolean(selected && draft && (draftName !== selected.name || JSON.stringify(draft) !== JSON.stringify(selected.definition)))

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

  function changeCategory(index: number, patch: Partial<ChecklistDefinition['categories'][number]>) {
    setDraft((current) => current ? { categories: current.categories.map((category, i) => i === index ? { ...category, ...patch } : category) } : current)
  }
  function changeItem(categoryIndex: number, itemIndex: number, patch: Partial<ChecklistDefinition['categories'][number]['items'][number]>) {
    setDraft((current) => {
      if (!current) return current
      const categories = structuredClone(current.categories)
      categories[categoryIndex]!.items[itemIndex] = { ...categories[categoryIndex]!.items[itemIndex]!, ...patch }
      return { categories }
    })
  }
  function addItem(categoryIndex: number) {
    setDraft((current) => {
      if (!current) return current
      const categories = structuredClone(current.categories)
      categories[categoryIndex]!.items.push({ id: `custom-${crypto.randomUUID()}`, label: 'בדיקה חדשה', kind: 'status', issueType: 'other', required: true })
      return { categories }
    })
  }
  function duplicateItem(categoryIndex: number, itemIndex: number) {
    setDraft((current) => {
      if (!current) return current
      const categories = structuredClone(current.categories)
      const copy = { ...categories[categoryIndex]!.items[itemIndex]!, id: `custom-${crypto.randomUUID()}` }
      categories[categoryIndex]!.items.splice(itemIndex + 1, 0, copy)
      return { categories }
    })
  }
  function removeItem(categoryIndex: number, itemIndex: number) {
    setDraft((current) => {
      if (!current) return current
      const categories = structuredClone(current.categories)
      categories[categoryIndex]!.items.splice(itemIndex, 1)
      return { categories }
    })
  }
  function moveCategory(index: number, direction: -1 | 1) {
    setDraft((current) => {
      if (!current) return current
      const categories = structuredClone(current.categories)
      const target = index + direction
      if (target < 0 || target >= categories.length) return current
      ;[categories[index], categories[target]] = [categories[target]!, categories[index]!]
      return { categories }
    })
  }
  function moveItem(categoryIndex: number, itemIndex: number, direction: -1 | 1) {
    setDraft((current) => {
      if (!current) return current
      const categories = structuredClone(current.categories)
      const items = categories[categoryIndex]!.items
      const target = itemIndex + direction
      if (target < 0 || target >= items.length) return current
      ;[items[itemIndex], items[target]] = [items[target]!, items[itemIndex]!]
      return { categories }
    })
  }
  function addCategory() {
    setDraft((current) => ({ categories: [...(current?.categories ?? []), { id: `category-${crypto.randomUUID()}`, title: 'קטגוריה חדשה', items: [{ id: `custom-${crypto.randomUUID()}`, label: 'בדיקה חדשה', kind: 'status', issueType: 'other', required: true }] }] }))
  }
  function removeCategory(index: number) {
    setDraft((current) => current ? { categories: current.categories.filter((_, categoryIndex) => categoryIndex !== index) } : current)
  }
  function duplicateCategory(index: number) {
    setDraft((current) => {
      if (!current) return current
      const categories = structuredClone(current.categories)
      const source = categories[index]!
      categories.splice(index + 1, 0, { ...source, id: `category-${crypto.randomUUID()}`, title: `${source.title} — עותק`, items: source.items.map((item) => ({ ...item, id: `custom-${crypto.randomUUID()}` })) })
      return { categories }
    })
  }
  function startBlank() {
    setDraft({ categories: [{ id: `category-${crypto.randomUUID()}`, title: 'קטגוריה חדשה', items: [{ id: `custom-${crypto.randomUUID()}`, label: 'בדיקה חדשה', kind: 'status', issueType: 'other', required: true }] }] })
    setDraftName(`טופס ${KIND_LABELS[kind]}`)
  }
  function resetDraft() {
    if (!selected) return
    setDraft(structuredClone(selected.definition))
    setDraftName(selected.name)
  }

  async function publish() {
    if (!data || !selected || !draft) return
    if (!draftName.trim() || draft.categories.length === 0 || draft.categories.some((category) => !category.title.trim() || category.items.length === 0 || category.items.some((item) => !item.label.trim()))) return setError('צריך שם לטופס ולפחות קטגוריה אחת עם בדיקה אחת לפני הפרסום.')
    setPublishing(true)
    setError(null)
    try {
      const res = await fetch('/api/owner/checklists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish', branchId: data.branch.id, kind, name: draftName.trim(), definition: draft }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(messageOf(payload, 'לא הצלחנו לפרסם.'))
      localStorage.removeItem(`sarcafe:checklist-draft:${branch}:${selected.kind}:${selected.version}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא הצלחנו לפרסם.')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="ck-wrap">
      <BranchSwitcher branches={branches} value={branch} onChange={setBranch} />
      <section className="ck-hero">
        <div className="sch-row"><div style={{ flex: 1 }}><p className="sch-sub" style={{ margin: 0 }}>שליטה מלאה בטפסים ובדיווחים</p><h1 style={{ margin: '4px 0' }}>צ׳קליסטים לעובדים</h1></div>{openIssues > 0 && <button type="button" className="ck-status ck-status--pending press" onClick={() => setTab('inbox')}><AlertTriangle size={16} /> {openIssues === 1 ? 'דבר אחד לטיפול' : `${openIssues} דברים לטיפול`}</button>}</div>
        <p style={{ margin: '8px 0 0', color: 'var(--text-dim)' }}>כל טופס מחובר אוטומטית לשיבוץ בלוח המשמרות. שינוי תבנית יוצר גרסה חדשה ולא משנה דיווחים ישנים.</p>
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
        <button role="tab" aria-selected={tab === 'builder'} onClick={() => setTab('builder')}>בניית טפסים</button>
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

      {tab === 'builder' && data && <div className="ck-wrap">
        <div className="sch-segment" role="group" aria-label="סוג טופס">{(['opening', 'handover', 'closing'] as const).map((value) => <button key={value} className="press" aria-pressed={kind === value} onClick={() => setKind(value)}>{KIND_LABELS[value]}</button>)}</div>
        <div className="ck-builder-publish">
          <label style={{ flex: 1, minWidth: 220 }}><span className="sch-label">שם הטופס</span><input className="sch-input" value={draftName} maxLength={200} onChange={(event) => setDraftName(event.target.value)} /></label>
          <div className="ck-builder-toolbar">
            <button type="button" className="sch-btn sch-btn--sm press" onClick={startBlank}><FilePlus2 size={16} /> התחלה מטופס ריק</button>
            <button type="button" className="sch-btn sch-btn--sm press" disabled={!builderDirty} onClick={resetDraft}><RotateCcw size={16} /> שחזור הגרסה שפורסמה</button>
            <button className="sch-btn sch-btn--primary press" disabled={!draft || publishing || !builderDirty} onClick={() => void publish()}><Send size={17} /> {publishing ? 'מפרסם…' : 'פרסום לעובדים'}</button>
          </div>
          <div className="sch-sub" style={{ width: '100%' }}>גרסה {selected?.version} · הטיוטה נשמרת אוטומטית בדפדפן · פרסום יוצר גרסה חדשה ומעדכן רק טפסים שעדיין לא התחילו</div>
        </div>
        {draft?.categories.map((category, categoryIndex) => <section key={category.id} className="ck-builder-category">
          <div className="ck-builder-category__head"><label><span className="sch-label">שם הקטגוריה</span><input className="sch-input" value={category.title} onChange={(event) => changeCategory(categoryIndex, { title: event.target.value })} /></label><div className="ck-builder-actions"><button className="sch-iconbtn press" disabled={categoryIndex === 0} onClick={() => moveCategory(categoryIndex, -1)} aria-label="העלאת הקטגוריה"><ArrowUp size={17} /></button><button className="sch-iconbtn press" disabled={categoryIndex === draft.categories.length - 1} onClick={() => moveCategory(categoryIndex, 1)} aria-label="הורדת הקטגוריה"><ArrowDown size={17} /></button><button className="sch-iconbtn press" onClick={() => duplicateCategory(categoryIndex)} aria-label="שכפול הקטגוריה"><Copy size={16} /></button><button className="sch-iconbtn press" onClick={() => removeCategory(categoryIndex)} aria-label="מחיקת הקטגוריה"><Trash2 size={17} /></button></div></div>
          {category.items.map((item, itemIndex) => <div className="ck-builder-item" key={item.id}>
            <div className="ck-builder-item__head"><span className="ck-builder-item__number">{itemIndex + 1}</span><div className="ck-builder-actions"><button className="sch-iconbtn press" disabled={itemIndex === 0} aria-label="העלאת הבדיקה" onClick={() => moveItem(categoryIndex, itemIndex, -1)}><ArrowUp size={16} /></button><button className="sch-iconbtn press" disabled={itemIndex === category.items.length - 1} aria-label="הורדת הבדיקה" onClick={() => moveItem(categoryIndex, itemIndex, 1)}><ArrowDown size={16} /></button><button className="sch-iconbtn press" aria-label="שכפול הבדיקה" onClick={() => duplicateItem(categoryIndex, itemIndex)}><Copy size={16} /></button><button className="sch-iconbtn press" aria-label="מחיקת הבדיקה" onClick={() => removeItem(categoryIndex, itemIndex)}><Trash2 size={17} /></button></div></div>
            <label><span className="sch-label">מה העובד צריך לבדוק?</span><input className="sch-input" value={item.label} onChange={(event) => changeItem(categoryIndex, itemIndex, { label: event.target.value })} /></label>
            <label><span className="sch-label">הסבר קצר לעובד/ת (לא חובה)</span><input className="sch-input" value={item.help ?? ''} onChange={(event) => changeItem(categoryIndex, itemIndex, { help: event.target.value || undefined })} placeholder="לדוגמה: איפה נמצא המלאי החלופי" /></label>
            <div className="ck-builder-fields">
              <label><span className="sch-label">איך העובד עונה?</span><select className="sch-input" value={item.kind} onChange={(event) => changeItem(categoryIndex, itemIndex, { kind: event.target.value as typeof item.kind })}><option value="status">תקין / לא תקין</option><option value="action">בוצע / לא בוצע</option><option value="number">הזנת מספר</option></select></label>
              <label><span className="sch-label">לאן ליקוי משויך?</span><select className="sch-input" value={item.issueType} onChange={(event) => changeItem(categoryIndex, itemIndex, { issueType: event.target.value as typeof item.issueType })}><option value="inventory">מלאי</option><option value="cleanliness">ניקיון</option><option value="equipment">ציוד / מכונה</option><option value="cash">קופה</option><option value="other">אחר</option></select></label>
              {item.kind === 'number' && <><label><span className="sch-label">מה היעד התקין?</span><input className="sch-input" type="number" value={item.target ?? ''} onChange={(event) => changeItem(categoryIndex, itemIndex, { target: event.target.value === '' ? undefined : Number(event.target.value) })} /></label><label><span className="sch-label">יחידת מידה</span><input className="sch-input" maxLength={20} value={item.unit ?? ''} onChange={(event) => changeItem(categoryIndex, itemIndex, { unit: event.target.value || undefined })} placeholder="יח׳ / ₪ / מעלות" /></label></>}
            </div>
            <label className="ck-builder-required"><input type="checkbox" checked={item.required !== false} onChange={(event) => changeItem(categoryIndex, itemIndex, { required: event.target.checked })} /><span><strong>בדיקה חובה</strong><small>כשכבוי, העובד/ת יכול/ה לדלג על הסעיף.</small></span></label>
          </div>)}
          <button className="sch-btn sch-btn--sm press" onClick={() => addItem(categoryIndex)}><Plus size={16} /> הוספת בדיקה לקטגוריה</button>
        </section>)}
        <button className="sch-btn press" onClick={addCategory}><Plus size={17} /> הוספת קטגוריה</button>
        <div className="ck-card"><div className="sch-row"><ClipboardList size={20} /><strong>מה העובד יראה?</strong></div><span className="sch-sub">העובד מקבל קטגוריה אחת בכל מסך, כפתורים גדולים של תקין/לא תקין, וחובת סיבה לכל ליקוי. כל קטגוריה נשמרת לפני המעבר.</span></div>
      </div>}
    </div>
  )
}
