'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Banknote, CheckCircle2, ChevronDown, Package, Sparkles, Wrench } from 'lucide-react'
import { ISSUE_TYPE_LABELS, issueSummary, type IssueGroup, type IssueReporter } from '@/lib/checklists/issues'
import { dayLabel } from '@/lib/checklists/window'
import { KIND_LABELS } from '@/lib/checklists/types'
import { messageOf } from '@/components/staff/types'
import './checklists.css'

type Payload = { branch: { id: string; slug: string; name: { he?: string } }; days: number; open: IssueGroup[]; recovered: IssueGroup[] }

const TYPE_ICON: Record<string, typeof AlertTriangle> = { inventory: Package, equipment: Wrench, cleanliness: Sparkles, cash: Banknote, other: AlertTriangle }

const clock = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })
const dayOf = (iso: string) => dayLabel(new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }))

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

function Group({ group, busy, onResolve, recovered }: { group: IssueGroup; busy: boolean; onResolve: (itemId: string) => void; recovered?: boolean }) {
  const Icon = TYPE_ICON[group.type] ?? AlertTriangle
  const last = group.reports[0]!
  return (
    <article className={`ck-card ck-issue-group${recovered ? ' ck-issue-group--recovered' : ''}`}>
      <div className="sch-row" style={{ alignItems: 'flex-start' }}>
        <Icon size={22} aria-hidden="true" color={recovered ? 'var(--text-faint)' : 'var(--danger)'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: '1.02rem' }}>{group.label}</strong>
          <div className="ck-track-meta">
            <span className="ck-status ck-status--pending">{ISSUE_TYPE_LABELS[group.type] ?? ISSUE_TYPE_LABELS.other}</span>
            <span>{group.category}</span>
          </div>
        </div>
      </div>
      <p className="ck-issue-summary">{issueSummary(group)}</p>
      <p className="sch-sub">
        האחרון: {last.staffName} · {dayLabel(last.shiftDate)} · <span dir="ltr">{clock(last.submittedAt)}</span>
        {recovered && group.recoveredAt ? ` · בדיקה מאוחרת יותר (${dayOf(group.recoveredAt)} ${clock(group.recoveredAt)}) מצאה את זה תקין` : ''}
      </p>
      <details className="ck-issue-details">
        <summary className="press"><ChevronDown size={16} aria-hidden="true" /> מי דיווח ומתי ({group.reports.length})</summary>
        <ul className="ck-issue-reports">{group.reports.map((report) => <ReportLine key={`${report.checklistId}`} report={report} />)}</ul>
      </details>
      <div className="sch-row">
        <button type="button" className={`sch-btn ${recovered ? '' : 'sch-btn--ok'} press`} disabled={busy} onClick={() => onResolve(group.itemId)}>
          <CheckCircle2 size={17} aria-hidden="true" /> {busy ? 'מסמן…' : recovered ? 'סגירה' : 'סימון כטופל'}
        </button>
      </div>
    </article>
  )
}

// The owner's "missing or not working" list. Not one card per checklist with a sum of its NO answers: one card per
// CHECK (the ice machine, the oat milk), however many people reported it, with who, on which shift and at what time.
// Marking one handled closes the reports so far; a new report opens it again.
export default function IssueReport({ branch, onCount }: { branch: string; onCount?: (open: number) => void }) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/owner/issues?branch=${encodeURIComponent(branch)}`, { cache: 'no-store' })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(messageOf(payload, 'לא הצלחנו לטעון את הדוח.'))
      setData(payload as Payload)
      onCount?.((payload as Payload).open.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא הצלחנו לטעון את הדוח.')
    } finally {
      setLoading(false)
    }
  }, [branch, onCount])
  useEffect(() => void load(), [load])

  async function resolve(itemId: string) {
    if (!data) return
    setBusy(itemId)
    setError(null)
    try {
      const res = await fetch('/api/owner/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resolve', branchId: data.branch.id, itemId }) })
      if (!res.ok) throw new Error(messageOf(await res.json().catch(() => null), 'לא הצלחנו לסמן כטופל.'))
      await load()
    } catch (err) {
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
          <p className="sch-sub">מה חסר או לא עובד, לפי מה שעובדים סימנו כלא תקין בצ׳קליסטים ב־{data.days} הימים האחרונים. כל בדיקה מופיעה פעם אחת, עם כל מי שדיווח עליה.</p>
          {data.open.map((group) => <Group key={group.itemId} group={group} busy={busy === group.itemId} onResolve={(id) => void resolve(id)} />)}
          {data.open.length === 0 && (
            <section className="ck-card" style={{ alignItems: 'center', textAlign: 'center', padding: 30 }}>
              <CheckCircle2 size={38} color="var(--success, #48b978)" aria-hidden="true" />
              <strong>אין כרגע חוסרים או תקלות פתוחים</strong>
              <span className="sch-sub">כשעובד/ת יסמנו משהו כלא תקין בצ׳קליסט, הוא יופיע כאן, וגם בדוח הבוקר.</span>
            </section>
          )}
          {data.recovered.length > 0 && (
            <details className="ck-card ck-issue-recovered">
              <summary className="press"><ChevronDown size={16} aria-hidden="true" /> נראה שכבר טופל ({data.recovered.length})</summary>
              <p className="sch-sub">בדיקה מאוחרת יותר מצאה את זה תקין. לא נספר בדוח הבוקר. אפשר לסגור, או שדיווח חדש יחזיר את זה לרשימה.</p>
              <div className="ck-wrap">{data.recovered.map((group) => <Group key={group.itemId} group={group} recovered busy={busy === group.itemId} onResolve={(id) => void resolve(id)} />)}</div>
            </details>
          )}
        </>
      )}
    </div>
  )
}
