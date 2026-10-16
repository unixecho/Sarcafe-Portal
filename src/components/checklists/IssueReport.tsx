'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Banknote, CheckCircle2, ChevronDown, ClipboardX, Package, RefreshCw, Sparkles, Wrench } from 'lucide-react'
import { ISSUE_TYPE_LABELS, issueSummary, type IssueGroup, type IssueReporter } from '@/lib/checklists/issues'
import type { GapGroup } from '@/lib/checklists/gaps'
import { dayLabel } from '@/lib/checklists/window'
import { KIND_LABELS } from '@/lib/checklists/types'
import { messageOf } from '@/components/staff/types'
import './checklists.css'

type Payload = { branch: { id: string; slug: string; name: { he?: string } }; days: number; gapDays: number; serverTime: string; open: IssueGroup[]; recovered: IssueGroup[]; gaps: GapGroup[] }

const TYPE_ICON: Record<string, typeof AlertTriangle> = { inventory: Package, equipment: Wrench, cleanliness: Sparkles, cash: Banknote, other: AlertTriangle }
const REFRESH_MS = 60_000

const clock = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })
const dayOf = (iso: string) => dayLabel(new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }))

type Row = { id: string; filter: string } & ({ type: 'issue'; group: IssueGroup; recovered: boolean } | { type: 'gap'; gap: GapGroup })

function ReportLine({ report }: { report: IssueReporter }) {
  return (
    <li className="ck-issue-report">
      <div className="ck-issue-report__who">
        <strong>{report.staffName}</strong>
        <span>{KIND_LABELS[report.kind]}</span>
        <span>{dayLabel(report.shiftDate)}</span>
        <span dir="ltr">{report.startTime}–{report.endTime}</span>
        <span>דווח ב־<span dir="ltr">{clock(report.submittedAt)}</span></span>
      </div>
      {report.reason && <q className="ck-issue-reason">{report.reason}</q>}
      {report.value !== undefined && report.target !== undefined && <span className="sch-sub">נספר {report.value} · היעד {report.target}</span>}
    </li>
  )
}

/** One collapsible line of the list: the headline is always visible, the detail opens under it. */
function Item({ row, open, busy, onToggle, onDone }: { row: Row; open: boolean; busy: boolean; onToggle: () => void; onDone: () => void }) {
  const bodyId = `short-${row.id}`
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setConfirming(false), 4000)
    return () => clearTimeout(t)
  }, [confirming])

  if (row.type === 'issue') {
    const g = row.group
    const Icon = TYPE_ICON[g.type] ?? AlertTriangle
    const last = g.reports[0]!
    return (
      <article className={`ck-short${row.recovered ? ' ck-short--quiet' : ''}${open ? ' ck-short--open' : ''}`}>
        <button type="button" className="ck-short__head press" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <span className="ck-short__icon" aria-hidden="true"><Icon size={20} /></span>
          <span className="ck-short__title">
            <strong>{g.label}</strong>
            <small>{ISSUE_TYPE_LABELS[g.type] ?? ISSUE_TYPE_LABELS.other} · {g.category}</small>
          </span>
          <span className="ck-short__count" aria-label={issueSummary(g)}>{g.reports.length}×</span>
          <ChevronDown size={18} className="ck-short__chevron" aria-hidden="true" />
        </button>
        <div id={bodyId} className="ck-short__body" hidden={!open}>
          <p className="ck-issue-summary">{issueSummary(g)}</p>
          <p className="sch-sub">
            האחרון: {last.staffName} · {dayLabel(last.shiftDate)} · <span dir="ltr">{clock(last.submittedAt)}</span>
            {row.recovered && g.recoveredAt ? ` · בדיקה מאוחרת יותר (${dayOf(g.recoveredAt)} ${clock(g.recoveredAt)}) מצאה את זה תקין` : ''}
          </p>
          <ul className="ck-issue-reports">{g.reports.map((report) => <ReportLine key={report.checklistId} report={report} />)}</ul>
          <button type="button" className={`sch-btn ${row.recovered ? '' : 'sch-btn--ok'} press`} disabled={busy} onClick={onDone}>
            <CheckCircle2 size={17} aria-hidden="true" /> {busy ? 'מסמן…' : row.recovered ? 'סגירה' : 'סימון כטופל'}
          </button>
        </div>
      </article>
    )
  }

  const gap = row.gap
  return (
    <article className={`ck-short ck-short--gap${open ? ' ck-short--open' : ''}`}>
      <button type="button" className="ck-short__head press" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="ck-short__icon" aria-hidden="true"><ClipboardX size={20} /></span>
        <span className="ck-short__title">
          <strong>{KIND_LABELS[gap.kind]} לא הוגש</strong>
          <small>{dayLabel(gap.shiftDate)} · <bdi dir="ltr">{gap.startTime}–{gap.endTime}</bdi> · {gap.staffNames.join(' · ')}</small>
        </span>
        <span className="ck-short__count ck-short__count--gap">פער</span>
        <ChevronDown size={18} className="ck-short__chevron" aria-hidden="true" />
      </button>
      <div id={bodyId} className="ck-short__body" hidden={!open}>
        <p className="sch-sub">
          הצ׳קליסט הזה היה צריך להישלח אחרי המשמרת של {gap.staffNames.join(' ו־')}{gap.started ? ' (נפתח ולא הושלם)' : ' (לא נפתח)'} ועדיין לא נשלח.
          אם הוא כבר לא נדרש, אפשר לסגור אותו, וההתראות עליו ייפסקו.
        </p>
        {confirming ? (
          <div className="sch-row">
            <button type="button" className="sch-btn sch-btn--ok press" disabled={busy} onClick={() => { setConfirming(false); onDone() }}><CheckCircle2 size={17} aria-hidden="true" /> כן, לסגור</button>
            <button type="button" className="sch-btn press" onClick={() => setConfirming(false)}>ביטול</button>
          </div>
        ) : (
          <button type="button" className="sch-btn press" disabled={busy} onClick={() => setConfirming(true)}>{busy ? 'סוגר…' : 'לא נדרש — סגירה'}</button>
        )}
      </div>
    </article>
  )
}

// חוסרים ופערים — ONE list. Not a card per checklist and not two screens: what the checklists said is missing or not
// working (one line per CHECK, however many people reported it) and the checklists nobody sent (one line per checklist)
// sit together, worst first, each collapsed to a headline you can open. It stays current by itself: it reloads every
// minute while the screen is open and whenever you come back to it, and marking something done removes it at once
// (and puts it back with a message if the server says no).
export default function IssueReport({ branch, onCount }: { branch: string; onCount?: (open: number) => void }) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const onCountRef = useRef(onCount)
  onCountRef.current = onCount

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/owner/issues?branch=${encodeURIComponent(branch)}`, { cache: 'no-store' })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(messageOf(payload, 'לא הצלחנו לטעון את הדוח.'))
      setData(payload as Payload)
      setUpdatedAt(Date.now())
      onCountRef.current?.((payload as Payload).open.length + (payload as Payload).gaps.length)
    } catch (err) {
      if (!quiet) setError(err instanceof Error ? err.message : 'לא הצלחנו לטעון את הדוח.')
    } finally {
      setLoading(false)
    }
  }, [branch])
  useEffect(() => { setData(null); void load() }, [load])
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void load(true) }
    const timer = setInterval(tick, REFRESH_MS)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick) }
  }, [load])

  const rows = useMemo<Row[]>(() => {
    if (!data) return []
    return [
      ...data.gaps.map((gap): Row => ({ id: `gap-${gap.key.replace(/[^a-z0-9]/gi, '')}`, filter: 'gap', type: 'gap', gap })),
      ...data.open.map((group): Row => ({ id: `issue-${group.itemId}`, filter: group.type, type: 'issue', group, recovered: false })),
    ]
  }, [data])
  const recovered = useMemo<Row[]>(() => (data ? data.recovered.map((group): Row => ({ id: `rec-${group.itemId}`, filter: 'recovered', type: 'issue', group, recovered: true })) : []), [data])

  const filters = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) counts.set(row.filter, (counts.get(row.filter) ?? 0) + 1)
    const list: { id: string; label: string; count: number }[] = [{ id: 'all', label: 'הכול', count: rows.length }]
    if (counts.get('gap')) list.push({ id: 'gap', label: 'צ׳קליסט שלא הוגש', count: counts.get('gap')! })
    for (const [type, label] of Object.entries(ISSUE_TYPE_LABELS)) if (counts.get(type)) list.push({ id: type, label, count: counts.get(type)! })
    return list
  }, [rows])
  // A filter that emptied itself (the last one of its kind was closed) falls back to everything.
  const activeFilter = filters.some((f) => f.id === filter) ? filter : 'all'
  const shown = activeFilter === 'all' ? rows : rows.filter((row) => row.filter === activeFilter)
  const allOpen = shown.length > 0 && shown.every((row) => opened.has(row.id))

  function toggle(id: string) { setOpened((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next }) }
  function toggleAll() { setOpened((prev) => { const next = new Set(prev); for (const row of shown) { if (allOpen) next.delete(row.id); else next.add(row.id) } return next }) }

  async function finish(row: Row) {
    if (!data) return
    const snapshot = data
    setBusy(row.id)
    setError(null)
    // Gone from the screen at once; the server confirms (or the list comes back with a sentence).
    setData(row.type === 'gap'
      ? { ...data, gaps: data.gaps.filter((g) => g.key !== row.gap.key) }
      : { ...data, open: data.open.filter((g) => g.itemId !== row.group.itemId), recovered: data.recovered.filter((g) => g.itemId !== row.group.itemId) })
    onCountRef.current?.(Math.max(0, snapshot.open.length + snapshot.gaps.length - (row.type === 'issue' && row.recovered ? 0 : 1)))
    try {
      const body = row.type === 'gap'
        ? { action: 'closeGap', branchId: snapshot.branch.id, shiftId: row.gap.shiftId, kind: row.gap.kind }
        : { action: 'resolve', branchId: snapshot.branch.id, itemId: row.group.itemId }
      const res = await fetch('/api/owner/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error(messageOf(await res.json().catch(() => null), 'לא הצלחנו לסמן כטופל.'))
      await load(true)
    } catch (err) {
      setData(snapshot)
      onCountRef.current?.(snapshot.open.length + snapshot.gaps.length)
      setError(err instanceof Error ? err.message : 'לא הצלחנו לסמן כטופל.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="ck-wrap" dir="rtl">
      {error && <div className="sch-error" role="alert">{error}<button type="button" className="sch-btn sch-btn--sm press" onClick={() => void load()}>ניסיון נוסף</button></div>}
      {loading && !data ? <div className="sk" style={{ height: 160 }} /> : null}
      {data && (
        <>
          <p className="sch-sub">
            כל מה שהצ׳קליסטים מצאו שחסר, לא עובד או לא הוגש, במקום אחד: בדיקות שעובדים סימנו כלא תקינות ב־{data.days} הימים האחרונים (כל בדיקה פעם אחת, עם כל מי שדיווח עליה), וצ׳קליסטים שלא נשלחו ב־{data.gapDays} הימים האחרונים.
          </p>

          {rows.length > 0 && (
            <div className="ck-short__bar">
              <div className="ck-short__filters" role="group" aria-label="סינון לפי סוג">
                {filters.map((f) => (
                  <button key={f.id} type="button" className="sch-chip press" aria-pressed={activeFilter === f.id} onClick={() => setFilter(f.id)}>
                    {f.label} <small>{f.count}</small>
                  </button>
                ))}
              </div>
              <div className="ck-short__tools">
                <button type="button" className="sch-btn sch-btn--sm press" onClick={toggleAll}>{allOpen ? 'סגירת הכול' : 'פתיחת הכול'}</button>
                <button type="button" className="sch-iconbtn press" aria-label="רענון" onClick={() => void load(true)}><RefreshCw size={16} aria-hidden="true" /></button>
              </div>
            </div>
          )}

          <div className="ck-short__list" aria-live="polite">
            {shown.map((row) => <Item key={row.id} row={row} open={opened.has(row.id)} busy={busy === row.id} onToggle={() => toggle(row.id)} onDone={() => void finish(row)} />)}
          </div>

          {rows.length === 0 && (
            <section className="ck-card" style={{ alignItems: 'center', textAlign: 'center', padding: 30 }}>
              <CheckCircle2 size={38} color="var(--success, #48b978)" aria-hidden="true" />
              <strong>אין כרגע חוסרים ופערים</strong>
              <span className="sch-sub">כשעובד/ת יסמנו משהו כלא תקין בצ׳קליסט, או שצ׳קליסט לא יישלח בזמן, זה יופיע כאן, וגם בדוח הבוקר.</span>
            </section>
          )}

          {recovered.length > 0 && (
            <details className="ck-card ck-issue-recovered">
              <summary className="press"><ChevronDown size={16} aria-hidden="true" /> נראה שכבר טופל ({recovered.length})</summary>
              <p className="sch-sub">בדיקה מאוחרת יותר מצאה את זה תקין. לא נספר בדוח הבוקר. אפשר לסגור, או שדיווח חדש יחזיר את זה לרשימה.</p>
              <div className="ck-short__list">
                {recovered.map((row) => <Item key={row.id} row={row} open={opened.has(row.id)} busy={busy === row.id} onToggle={() => toggle(row.id)} onDone={() => void finish(row)} />)}
              </div>
            </details>
          )}
          {updatedAt && <p className="sch-sub ck-short__stamp">מתעדכן אוטומטית · נבדק לאחרונה ב־<span dir="ltr">{new Date(updatedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span></p>}
        </>
      )}
    </div>
  )
}
