'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, ClipboardList, Copy, CopyPlus, FilePlus2, Plus, RotateCcw, Send, Trash2, TriangleAlert } from 'lucide-react'
import { branchChecklistBuilderPath } from '@/lib/checklists/links'
import { KIND_LABELS, type ChecklistDefinition, type ChecklistKind } from '@/lib/checklists/types'
import { messageOf } from '@/components/staff/types'
import '@/components/shifts/schedule.css'
import './checklists.css'

export type BuilderTemplate = { id: string; kind: ChecklistKind; name: string; version: number; definition: ChecklistDefinition; published_at: string }
/** Another branch's current forms, offered as a starting point (a new branch starts from the one that works). */
export type BuilderSource = { slug: string; name: string; templates: { kind: ChecklistKind; name: string; definition: ChecklistDefinition }[] }

const KINDS: readonly ChecklistKind[] = ['opening', 'handover', 'closing']
const draftKey = (slug: string, template: Pick<BuilderTemplate, 'kind' | 'version'>) => `sarcafe:checklist-draft:${slug}:${template.kind}:${template.version}`

// One branch's checklist builder (owner, 2026-10-16: "the builder should exist under each branch's manager and not in the main
// page, so each branch has its own"; "it shouldn't look like Maor's Morning Checklist but Morning Checklist, or whatever name they
// come up with in the builder"). It edits ONE form of ONE branch. Publishing saves it as THAT branch's form (a new version, only
// forms nobody has started yet pick it up) and never touches another branch's. The draft lives in the browser until it is published.
export default function ChecklistBuilder({ branch, initialKind, templates: initialTemplates, sources, enabled, backHref }: {
  branch: { id: string; slug: string; name: string }
  initialKind: ChecklistKind
  templates: BuilderTemplate[]
  sources: BuilderSource[]
  /** which of the branch's three forms are switched on (the switch lives in the branch manager) */
  enabled: Record<ChecklistKind, boolean>
  backHref: string
}) {
  const [templates, setTemplates] = useState(initialTemplates)
  const [kind, setKind] = useState<ChecklistKind>(initialKind)
  const [draft, setDraft] = useState<ChecklistDefinition | null>(null)
  const [draftName, setDraftName] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copyFrom, setCopyFrom] = useState('')

  const selected = templates.find((template) => template.kind === kind) ?? null
  const dirty = Boolean(selected && draft && (draftName.trim() !== selected.name || JSON.stringify(draft) !== JSON.stringify(selected.definition)))

  // Load the draft for the form on screen: the one saved in this browser (if any), else the published form.
  useEffect(() => {
    if (!selected) { setDraft(null); return }
    try {
      const saved = localStorage.getItem(draftKey(branch.slug, selected))
      const parsed = saved ? JSON.parse(saved) as ChecklistDefinition | { name?: string; definition?: ChecklistDefinition } : null
      if (parsed && 'definition' in parsed && parsed.definition) { setDraft(parsed.definition); setDraftName(parsed.name || selected.name) }
      else { setDraft(parsed && 'categories' in parsed ? parsed : structuredClone(selected.definition)); setDraftName(selected.name) }
    } catch { setDraft(structuredClone(selected.definition)); setDraftName(selected.name) }
    setNotice(null); setError(null); setCopyFrom('')
  }, [selected?.id, branch.slug])
  useEffect(() => {
    if (!draft || !selected) return
    try { localStorage.setItem(draftKey(branch.slug, selected), JSON.stringify({ name: draftName, definition: draft })) } catch { /* no storage: the draft lasts as long as the page */ }
  }, [draft, draftName, selected?.id, branch.slug])
  // Unpublished edits are the one thing a closed tab loses for good.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function chooseKind(next: ChecklistKind) {
    setKind(next)
    try { window.history.replaceState(null, '', branchChecklistBuilderPath(branch.slug, next)) } catch { /* the form still switches */ }
  }

  const donors = useMemo(() => sources.filter((source) => source.templates.some((template) => template.kind === kind)), [sources, kind])
  function copyFromBranch() {
    const source = sources.find((candidate) => candidate.slug === copyFrom)
    const template = source?.templates.find((candidate) => candidate.kind === kind)
    if (!source || !template) return
    setDraft(structuredClone(template.definition))
    setDraftName(template.name)
    setNotice(`הטופס של ${source.name} הועתק לטיוטה. עדיין לא פורסם: אפשר לערוך אותו ל${branch.name} ואז לפרסם.`)
    setCopyFrom('')
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
    setDraftName(KIND_LABELS[kind])
  }
  function resetDraft() {
    if (!selected) return
    setDraft(structuredClone(selected.definition))
    setDraftName(selected.name)
    setNotice(null)
  }

  async function publish() {
    if (!selected || !draft) return
    if (!draftName.trim() || draft.categories.length === 0 || draft.categories.some((category) => !category.title.trim() || category.items.length === 0 || category.items.some((item) => !item.label.trim()))) {
      setError('צריך שם לטופס ולפחות קטגוריה אחת עם בדיקה אחת לפני הפרסום.')
      return
    }
    setPublishing(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/owner/checklists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish', branchId: branch.id, kind, name: draftName.trim(), definition: draft }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(messageOf(payload, 'לא הצלחנו לפרסם.'))
      try { localStorage.removeItem(draftKey(branch.slug, selected)) } catch { /* nothing stored */ }
      const published: BuilderTemplate = { id: String(payload.id), kind, name: draftName.trim(), version: Number(payload.version) || selected.version + 1, definition: structuredClone(draft), published_at: String(payload.publishedAt ?? new Date().toISOString()) }
      setTemplates((current) => current.map((template) => (template.kind === kind ? published : template)))
      setNotice(`הטופס ״${published.name}״ פורסם ב${branch.name} (גרסה ${published.version}). עובדים שכבר התחילו אותו ממשיכים עם הגרסה הקודמת.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא הצלחנו לפרסם.')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="ck-wrap">
      <section className="ck-hero">
        <p className="sch-sub" style={{ margin: 0 }}>טפסי הצ׳קליסט של {branch.name}</p>
        <h1 style={{ margin: '4px 0' }}>{selected?.name ?? KIND_LABELS[kind]}</h1>
        <p style={{ margin: '8px 0 0', color: 'var(--text-dim)' }}>
          הטופס הזה שייך רק ל{branch.name}. שינוי שתפרסמו כאן לא משנה את הטפסים של סניפים אחרים, ואת מה שעובדים כבר מילאו.{' '}
          <Link href={backHref} className="bm-textlink">חזרה לניהול הסניף</Link>
        </p>
      </section>

      <div className="sch-segment" role="group" aria-label="איזה טופס לערוך">
        {KINDS.map((value) => {
          const own = templates.find((template) => template.kind === value)
          return <button key={value} type="button" className="press" aria-pressed={kind === value} onClick={() => chooseKind(value)}>{own?.name ?? KIND_LABELS[value]}{!enabled[value] && <small className="ck-off-tag"> · כבוי</small>}</button>
        })}
      </div>
      {!enabled[kind] && <p className="ck-builder-warn" role="note"><TriangleAlert size={17} aria-hidden="true" />הצ׳קליסט הזה כבוי כרגע ב{branch.name}, ולכן עובדים לא מקבלים אותו. אפשר לערוך אותו כבר עכשיו ולהדליק אותו בניהול הסניף.</p>}

      {error && <div className="sch-error" role="alert">{error}</div>}
      {notice && <div className="ck-builder-ok" role="status">{notice}</div>}

      <div className="ck-builder-publish">
        <label style={{ flex: 1, minWidth: 220 }}><span className="sch-label">שם הטופס</span><input className="sch-input" value={draftName} maxLength={200} onChange={(event) => setDraftName(event.target.value)} /></label>
        <div className="ck-builder-toolbar">
          <button type="button" className="sch-btn sch-btn--sm press" onClick={startBlank}><FilePlus2 size={16} aria-hidden="true" /> התחלה מטופס ריק</button>
          <button type="button" className="sch-btn sch-btn--sm press" disabled={!dirty} onClick={resetDraft}><RotateCcw size={16} aria-hidden="true" /> שחזור הגרסה שפורסמה</button>
          <button type="button" className="sch-btn sch-btn--primary press" disabled={!draft || publishing || !dirty} onClick={() => void publish()}><Send size={17} aria-hidden="true" /> {publishing ? 'מפרסם…' : `פרסום ב${branch.name}`}</button>
        </div>
        <div className="sch-sub" style={{ width: '100%' }}>
          {selected ? <>גרסה {selected.version} · {dirty ? 'יש שינויים שלא פורסמו' : 'אין שינויים'} · הטיוטה נשמרת בדפדפן עד הפרסום</> : 'אין עדיין טופס לסניף הזה'}
        </div>
        {donors.length > 0 && (
          <div className="ck-builder-copy">
            <label><span className="sch-label">להתחיל מהטופס של סניף אחר</span>
              <select className="sch-input" value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)}>
                <option value="">בחרו סניף…</option>
                {donors.map((source) => <option key={source.slug} value={source.slug}>{source.name}</option>)}
              </select>
            </label>
            <button type="button" className="sch-btn sch-btn--sm press" disabled={!copyFrom} onClick={copyFromBranch}><CopyPlus size={16} aria-hidden="true" /> העתקה לטיוטה</button>
          </div>
        )}
      </div>

      {draft?.categories.map((category, categoryIndex) => <section key={category.id} className="ck-builder-category">
        <div className="ck-builder-category__head"><label><span className="sch-label">שם הקטגוריה</span><input className="sch-input" value={category.title} onChange={(event) => changeCategory(categoryIndex, { title: event.target.value })} /></label><div className="ck-builder-actions"><button type="button" className="sch-iconbtn press" disabled={categoryIndex === 0} onClick={() => moveCategory(categoryIndex, -1)} aria-label="העלאת הקטגוריה"><ArrowUp size={17} /></button><button type="button" className="sch-iconbtn press" disabled={categoryIndex === draft.categories.length - 1} onClick={() => moveCategory(categoryIndex, 1)} aria-label="הורדת הקטגוריה"><ArrowDown size={17} /></button><button type="button" className="sch-iconbtn press" onClick={() => duplicateCategory(categoryIndex)} aria-label="שכפול הקטגוריה"><Copy size={16} /></button><button type="button" className="sch-iconbtn press" onClick={() => removeCategory(categoryIndex)} aria-label="מחיקת הקטגוריה"><Trash2 size={17} /></button></div></div>
        {category.items.map((item, itemIndex) => <div className="ck-builder-item" key={item.id}>
          <div className="ck-builder-item__head"><span className="ck-builder-item__number">{itemIndex + 1}</span><div className="ck-builder-actions"><button type="button" className="sch-iconbtn press" disabled={itemIndex === 0} aria-label="העלאת הבדיקה" onClick={() => moveItem(categoryIndex, itemIndex, -1)}><ArrowUp size={16} /></button><button type="button" className="sch-iconbtn press" disabled={itemIndex === category.items.length - 1} aria-label="הורדת הבדיקה" onClick={() => moveItem(categoryIndex, itemIndex, 1)}><ArrowDown size={16} /></button><button type="button" className="sch-iconbtn press" aria-label="שכפול הבדיקה" onClick={() => duplicateItem(categoryIndex, itemIndex)}><Copy size={16} /></button><button type="button" className="sch-iconbtn press" aria-label="מחיקת הבדיקה" onClick={() => removeItem(categoryIndex, itemIndex)}><Trash2 size={17} /></button></div></div>
          <label><span className="sch-label">מה העובד צריך לבדוק?</span><input className="sch-input" value={item.label} onChange={(event) => changeItem(categoryIndex, itemIndex, { label: event.target.value })} /></label>
          <label><span className="sch-label">הסבר קצר לעובד/ת (לא חובה)</span><input className="sch-input" value={item.help ?? ''} onChange={(event) => changeItem(categoryIndex, itemIndex, { help: event.target.value || undefined })} placeholder="לדוגמה: איפה נמצא המלאי החלופי" /></label>
          <div className="ck-builder-fields">
            <label><span className="sch-label">איך העובד עונה?</span><select className="sch-input" value={item.kind} onChange={(event) => changeItem(categoryIndex, itemIndex, { kind: event.target.value as typeof item.kind })}><option value="status">תקין / לא תקין</option><option value="action">בוצע / לא בוצע</option><option value="number">הזנת מספר</option></select></label>
            <label><span className="sch-label">לאן ליקוי משויך?</span><select className="sch-input" value={item.issueType} onChange={(event) => changeItem(categoryIndex, itemIndex, { issueType: event.target.value as typeof item.issueType })}><option value="inventory">מלאי</option><option value="cleanliness">ניקיון</option><option value="equipment">ציוד / מכונה</option><option value="cash">קופה</option><option value="other">אחר</option></select></label>
            {item.kind === 'number' && <><label><span className="sch-label">מה היעד התקין?</span><input className="sch-input" type="number" value={item.target ?? ''} onChange={(event) => changeItem(categoryIndex, itemIndex, { target: event.target.value === '' ? undefined : Number(event.target.value) })} /></label><label><span className="sch-label">יחידת מידה</span><input className="sch-input" maxLength={20} value={item.unit ?? ''} onChange={(event) => changeItem(categoryIndex, itemIndex, { unit: event.target.value || undefined })} placeholder="יח׳ / ₪ / מעלות" /></label></>}
          </div>
          <label className="ck-builder-required"><input type="checkbox" checked={item.required !== false} onChange={(event) => changeItem(categoryIndex, itemIndex, { required: event.target.checked })} /><span><strong>בדיקה חובה</strong><small>כשכבוי, העובד/ת יכול/ה לדלג על הסעיף.</small></span></label>
        </div>)}
        <button type="button" className="sch-btn sch-btn--sm press" onClick={() => addItem(categoryIndex)}><Plus size={16} aria-hidden="true" /> הוספת בדיקה לקטגוריה</button>
      </section>)}
      <button type="button" className="sch-btn press" onClick={addCategory}><Plus size={17} aria-hidden="true" /> הוספת קטגוריה</button>
      <div className="ck-card"><div className="sch-row"><ClipboardList size={20} aria-hidden="true" /><strong>מה העובד יראה?</strong></div><span className="sch-sub">העובד מקבל קטגוריה אחת בכל מסך, כפתורים גדולים של תקין/לא תקין, וחובת סיבה לכל ליקוי. כל קטגוריה נשמרת לפני המעבר.</span></div>
    </div>
  )
}
