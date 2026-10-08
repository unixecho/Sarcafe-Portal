'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ClipboardList, Copy, Download, ExternalLink, Eye, Plus, QrCode, Send, Trash2 } from 'lucide-react'
import QRCode from 'qrcode'
import BranchSwitcher from '@/components/BranchSwitcher'
import type { Branch, BranchSlug } from '@/lib/branches'
import { KIND_LABELS, type ChecklistDefinition, type ChecklistKind } from '@/lib/checklists/types'
import { messageOf } from '@/components/staff/types'
import './checklists.css'

type TemplateRow = { id: string; kind: ChecklistKind; name: string; version: number; definition: ChecklistDefinition; published_at: string }
type AssignmentRow = {
  id: string
  staffName: string
  employeeNo: number | null
  shiftDate: string
  startTime: string
  endTime: string
  kind: ChecklistKind
  status: 'pending' | 'in_progress' | 'submitted'
  issueCount: number
  issues: { itemId: string; label: string; category: string; type: string; reason: string }[]
  submittedAt: string | null
  seenAt: string | null
  resolvedAt: string | null
  managerNote: string | null
}
type Payload = { branch: { id: string; slug: string; name: { he?: string } }; templates: TemplateRow[]; assignments: AssignmentRow[] }
type Tab = 'inbox' | 'coverage' | 'builder'

const statusText = (row: AssignmentRow) => row.status === 'submitted' ? 'נשלח' : row.status === 'in_progress' ? 'בתהליך' : 'טרם התחיל'

export default function OwnerChecklistWorkspace({ branches, initialBranch }: { branches: Branch[]; initialBranch: BranchSlug }) {
  const [branch, setBranch] = useState<BranchSlug>(initialBranch)
  const [tab, setTab] = useState<Tab>('inbox')
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<ChecklistKind>('opening')
  const [draft, setDraft] = useState<ChecklistDefinition | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [entryUrl, setEntryUrl] = useState('')
  const [entryQr, setEntryQr] = useState('')
  const [copied, setCopied] = useState(false)

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
    try { setDraft(saved ? JSON.parse(saved) as ChecklistDefinition : structuredClone(selected.definition)) }
    catch { setDraft(structuredClone(selected.definition)) }
  }, [selected?.id, branch])
  useEffect(() => {
    if (!draft || !selected || !branch) return
    localStorage.setItem(`sarcafe:checklist-draft:${branch}:${selected.kind}:${selected.version}`, JSON.stringify(draft))
  }, [draft, selected?.id, branch])
  const inbox = useMemo(() => (data?.assignments ?? []).filter((row) => row.status === 'submitted' && row.issueCount > 0 && !row.resolvedAt), [data])
  const overdue = useMemo(() => (data?.assignments ?? []).filter((row) => row.status !== 'submitted' && row.shiftDate && new Date(`${row.shiftDate}T${row.endTime || '23:59'}:00`).getTime() < Date.now()), [data])

  async function act(action: 'seen' | 'resolve', assignmentId: string, note?: string) {
    try {
      const res = await fetch('/api/owner/checklists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, assignmentId, ...(note ? { note } : {}) }) })
      if (!res.ok) throw new Error(messageOf(await res.json().catch(() => null), 'לא הצלחנו לעדכן.'))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא הצלחנו לעדכן.')
    }
  }

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
    setDraft((current) => ({ categories: [...(current?.categories ?? []), { id: `category-${crypto.randomUUID()}`, title: 'קטגוריה חדשה', items: [] }] }))
  }

  async function publish() {
    if (!data || !selected || !draft) return
    if (draft.categories.some((category) => !category.title.trim() || category.items.some((item) => !item.label.trim()))) return setError('מלאו שם לכל קטגוריה ולכל בדיקה לפני הפרסום.')
    setPublishing(true)
    setError(null)
    try {
      const res = await fetch('/api/owner/checklists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish', branchId: data.branch.id, kind, name: selected.name, definition: draft }),
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
        <div className="sch-row"><div style={{ flex: 1 }}><p className="sch-sub" style={{ margin: 0 }}>שליטה מלאה בטפסים ובדיווחים</p><h1 style={{ margin: '4px 0' }}>צ׳קליסטים לעובדים</h1></div>{inbox.length > 0 && <span className="ck-status ck-status--pending"><AlertTriangle size={16} /> {inbox.length} דיווחים לטיפול</span>}</div>
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
        <button role="tab" aria-selected={tab === 'inbox'} onClick={() => setTab('inbox')}>תיבת ליקויים {inbox.length ? `(${inbox.length})` : ''}</button>
        <button role="tab" aria-selected={tab === 'coverage'} onClick={() => setTab('coverage')}>מעקב משמרות</button>
        <button role="tab" aria-selected={tab === 'builder'} onClick={() => setTab('builder')}>בניית טפסים</button>
      </div>
      {error && <div className="sch-error" role="alert">{error}<button className="sch-btn sch-btn--sm press" onClick={() => void load()}>ניסיון נוסף</button></div>}
      {loading && !data ? <div className="sk" style={{ height: 180 }} /> : null}

      {tab === 'inbox' && data && <div className="ck-inbox">
        {inbox.map((row) => <article key={row.id} className="ck-card ck-issue-row">
          <div className="sch-row"><AlertTriangle size={20} color="var(--danger)" /><strong style={{ flex: 1 }}>{row.staffName} · {KIND_LABELS[row.kind]}</strong><span className="sch-sub">{row.submittedAt ? new Date(row.submittedAt).toLocaleString('he-IL') : ''}</span></div>
          <div className="sch-sub">משמרת {row.shiftDate} · <span dir="ltr">{row.startTime}–{row.endTime}</span>{row.employeeNo ? ` · עובד ${row.employeeNo}` : ''}</div>
          {row.issues.map((issue) => <div key={issue.itemId} className="ck-card" style={{ padding: 10, background: 'var(--bg)' }}><strong>{issue.label}</strong><span>{issue.reason}</span><span className="sch-sub">{issue.category}</span></div>)}
          <div className="sch-row" style={{ flexWrap: 'wrap' }}>{!row.seenAt && <button className="sch-btn sch-btn--sm press" onClick={() => void act('seen', row.id)}><Eye size={16} /> סימון כנקרא</button>}<button className="sch-btn sch-btn--ok press" onClick={() => void act('resolve', row.id)}><CheckCircle2 size={16} /> טופל</button></div>
        </article>)}
        {inbox.length === 0 && <section className="ck-card" style={{ alignItems: 'center', textAlign: 'center', padding: 30 }}><CheckCircle2 size={38} color="var(--success, #48b978)" /><strong>אין ליקויים פתוחים</strong><span className="sch-sub">דיווח חדש על מלאי, ניקיון או ציוד יופיע כאן מיד לאחר השליחה.</span></section>}
      </div>}

      {tab === 'coverage' && data && <div className="ck-wrap">
        {overdue.length > 0 && <div className="sch-error"><AlertTriangle size={18} /> {overdue.length} צ׳קליסטים ממשמרות שעברו עדיין לא נשלחו.</div>}
        {(data.assignments ?? []).map((row) => <article key={row.id} className="ck-card" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180 }}><strong>{row.staffName}</strong><div className="sch-sub">{row.shiftDate} · <span dir="ltr">{row.startTime}–{row.endTime}</span> · {KIND_LABELS[row.kind]}</div></div>
          <span className={`ck-status ck-status--${row.status === 'submitted' ? 'submitted' : 'pending'}`}>{statusText(row)}</span>
          {row.issueCount > 0 && <span className="ck-status ck-status--pending">{row.issueCount} ליקויים</span>}
        </article>)}
        {data.assignments.length === 0 && <section className="ck-card"><strong>עוד אין משמרות עם צ׳קליסטים</strong><span className="sch-sub">לאחר פרסום לוח המשמרות, הדרישות יופיעו כאן אוטומטית.</span></section>}
      </div>}

      {tab === 'builder' && data && <div className="ck-wrap">
        <div className="sch-segment" role="group" aria-label="סוג טופס">{(['opening', 'handover', 'closing'] as const).map((value) => <button key={value} className="press" aria-pressed={kind === value} onClick={() => setKind(value)}>{KIND_LABELS[value]}</button>)}</div>
        <div className="ck-builder-publish"><div style={{ flex: 1, minWidth: 220 }}><strong>{selected?.name}</strong><div className="sch-sub">גרסה {selected?.version} · הגרסה החדשה תחליף רק טפסים שעדיין לא התחילו</div></div><button className="sch-btn sch-btn--primary press" disabled={!draft || publishing} onClick={() => void publish()}><Send size={17} /> {publishing ? 'מפרסם…' : 'פרסום לעובדים'}</button></div>
        {draft?.categories.map((category, categoryIndex) => <section key={category.id} className="ck-builder-category">
          <div className="ck-builder-category__head"><label><span className="sch-label">שם הקטגוריה</span><input className="sch-input" value={category.title} onChange={(event) => changeCategory(categoryIndex, { title: event.target.value })} /></label><div className="ck-builder-actions"><button className="sch-iconbtn press" disabled={categoryIndex === 0} onClick={() => moveCategory(categoryIndex, -1)} aria-label="העלאת הקטגוריה"><ArrowUp size={17} /></button><button className="sch-iconbtn press" disabled={categoryIndex === draft.categories.length - 1} onClick={() => moveCategory(categoryIndex, 1)} aria-label="הורדת הקטגוריה"><ArrowDown size={17} /></button></div></div>
          {category.items.map((item, itemIndex) => <div className="ck-builder-item" key={item.id}>
            <div className="ck-builder-item__head"><span className="ck-builder-item__number">{itemIndex + 1}</span><div className="ck-builder-actions"><button className="sch-iconbtn press" disabled={itemIndex === 0} aria-label="העלאת הבדיקה" onClick={() => moveItem(categoryIndex, itemIndex, -1)}><ArrowUp size={16} /></button><button className="sch-iconbtn press" disabled={itemIndex === category.items.length - 1} aria-label="הורדת הבדיקה" onClick={() => moveItem(categoryIndex, itemIndex, 1)}><ArrowDown size={16} /></button><button className="sch-iconbtn press" aria-label="מחיקת הבדיקה" onClick={() => removeItem(categoryIndex, itemIndex)}><Trash2 size={17} /></button></div></div>
            <label><span className="sch-label">מה העובד צריך לבדוק?</span><input className="sch-input" value={item.label} onChange={(event) => changeItem(categoryIndex, itemIndex, { label: event.target.value })} /></label>
            <label><span className="sch-label">הסבר קצר לעובד/ת (לא חובה)</span><input className="sch-input" value={item.help ?? ''} onChange={(event) => changeItem(categoryIndex, itemIndex, { help: event.target.value || undefined })} placeholder="לדוגמה: איפה נמצא המלאי החלופי" /></label>
            <div className="ck-builder-fields">
              <label><span className="sch-label">איך העובד עונה?</span><select className="sch-input" value={item.kind} onChange={(event) => changeItem(categoryIndex, itemIndex, { kind: event.target.value as typeof item.kind })}><option value="status">תקין / לא תקין</option><option value="action">בוצע / לא בוצע</option><option value="number">הזנת מספר</option></select></label>
              <label><span className="sch-label">לאן ליקוי משויך?</span><select className="sch-input" value={item.issueType} onChange={(event) => changeItem(categoryIndex, itemIndex, { issueType: event.target.value as typeof item.issueType })}><option value="inventory">מלאי</option><option value="cleanliness">ניקיון</option><option value="equipment">ציוד / מכונה</option><option value="cash">קופה</option><option value="other">אחר</option></select></label>
              {item.kind === 'number' && <label><span className="sch-label">מה היעד התקין?</span><input className="sch-input" type="number" value={item.target ?? ''} onChange={(event) => changeItem(categoryIndex, itemIndex, { target: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>}
            </div>
          </div>)}
          <button className="sch-btn sch-btn--sm press" onClick={() => addItem(categoryIndex)}><Plus size={16} /> הוספת בדיקה לקטגוריה</button>
        </section>)}
        <button className="sch-btn press" onClick={addCategory}><Plus size={17} /> הוספת קטגוריה</button>
        <div className="ck-card"><div className="sch-row"><ClipboardList size={20} /><strong>מה העובד יראה?</strong></div><span className="sch-sub">העובד מקבל בדיקה אחת בכל מסך, כפתורים גדולים של תקין/לא תקין, וחובת סיבה לכל ליקוי. כל תשובה נשמרת לפני המעבר.</span></div>
      </div>}
    </div>
  )
}
