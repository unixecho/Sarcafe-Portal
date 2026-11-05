import { redirect } from 'next/navigation'
import { CircleAlert, CircleCheck, Clock, GitCommitHorizontal, ShieldCheck, Sparkles, Timer, TriangleAlert } from 'lucide-react'
import GlassDashboardShell from '@/components/glass/GlassDashboardShell'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { isDeveloper } from '@/lib/checklists/developer'
import { isOp } from '@/lib/staff/access'
import { loadQaPage } from '@/lib/qa/server'
import { passRate, type QaReport, type QaRunSummary, type QaStage } from '@/lib/qa/report'
import './qa.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'סקירת QA · Sarcafe', robots: { index: false, follow: false } }

// The developer's morning QA review (owner, 2026-11-05: "a developer's review every morning … as if it's an Apple private released QA
// review"). The automatic suite (qa/run.mjs, docs/QA_BLUEPRINT.md) runs every morning and after every push to main, posts its report,
// and this page reads the newest one. Developer only: checked here on the server; the data never reaches anyone else.

const STATUS = { pass: { label: 'מוכן לשחרור', tone: 'ok' }, warn: { label: 'דורש תשומת לב', tone: 'warn' }, fail: { label: 'נחסם', tone: 'bad' } } as const
const CATEGORY: Record<string, string> = { static: 'בדיקה סטטית', unit: 'לוגיקה', sql: 'מסד נתונים', security: 'אבטחה', e2e: 'מקצה לקצה', regression: 'רגרסיה', survival: 'שרידות', recovery: 'התאוששות', a11y: 'נגישות וקריאות', perf: 'ביצועים' }
const fmtDuration = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} שנ׳` : `${Math.floor(ms / 60_000)}:${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')} דק׳`)
const fmtDate = (iso: string) => new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso))
const fmtTime = (iso: string) => new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

export default async function QaReviewPage() {
  const me = await resolveStaffIdentity()
  if (!me) redirect('/login?next=/staff/dev/qa&quick=1')
  if (!isDeveloper(me)) redirect('/staff')
  const canManage = me.via === 'google' && !me.quick && isOp(me)
  const { latest, history, origin, note } = await loadQaPage()

  return (
    <GlassDashboardShell title="סקירת QA" account={{ developer: true, manager: canManage }}>
      {latest ? <Review report={latest} history={history} origin={origin} note={note} /> : (
        <section className="gl-surf gl-card"><h2 className="gl-card__title">עוד אין דוח QA</h2><p className="gl-note">הריצו <code>npm run qa</code> או חכו לריצה של הבוקר.</p></section>
      )}
    </GlassDashboardShell>
  )
}

function Ring({ value, tone }: { value: number; tone: string }) {
  const r = 52
  const c = 2 * Math.PI * r
  return (
    <svg className={`qa-ring qa-ring--${tone}`} viewBox="0 0 128 128" role="img" aria-label={`${value}% מהבדיקות עברו`}>
      <circle cx="64" cy="64" r={r} className="qa-ring__track" />
      <circle cx="64" cy="64" r={r} className="qa-ring__fill" strokeDasharray={`${(c * value) / 100} ${c}`} transform="rotate(-90 64 64)" />
      <text x="64" y="62" textAnchor="middle" className="qa-ring__num">{value}%</text>
      <text x="64" y="84" textAnchor="middle" className="qa-ring__cap">עברו</text>
    </svg>
  )
}

function History({ runs }: { runs: QaRunSummary[] }) {
  if (runs.length < 2) return null
  const w = 300
  const h = 64
  const step = w / runs.length
  return (
    <section className="gl-surf gl-card" aria-labelledby="qa-history">
      <h2 className="gl-card__title" id="qa-history">{runs.length} הריצות האחרונות</h2>
      <svg viewBox={`0 0 ${w} ${h + 16}`} className="qa-history" role="img" aria-label="אחוז ההצלחה בכל ריצה">
        <line x1="0" x2={w} y1={h} y2={h} className="qa-history__base" />
        {runs.map((run, i) => {
          const rate = run.tests ? run.passed / run.tests : 0
          const bh = Math.max(3, rate * (h - 6))
          return <rect key={run.id} x={i * step + step * 0.18} y={h - bh} width={step * 0.64} height={bh} rx="3" className={`qa-history__bar qa-history__bar--${run.status}`}><title>{`${fmtDate(run.createdAt)} ${fmtTime(run.createdAt)}: ${run.passed}/${run.tests}`}</title></rect>
        })}
      </svg>
    </section>
  )
}

function StageCard({ stage }: { stage: QaStage }) {
  const failed = stage.tests.filter((t) => t.status === 'fail')
  const flaky = stage.tests.filter((t) => t.status === 'flaky')
  const passed = stage.tests.filter((t) => t.status === 'pass').length
  const tone = stage.status === 'fail' ? 'bad' : stage.status === 'warn' ? 'warn' : 'ok'
  const ordered = [...failed, ...flaky, ...stage.tests.filter((t) => t.status !== 'fail' && t.status !== 'flaky')]
  return (
    <details className={`gl-surf qa-stage qa-stage--${tone}`} open={failed.length > 0}>
      <summary>
        <span className={`qa-dot qa-dot--${tone}`} aria-hidden="true" />
        <span className="qa-stage__copy"><strong>{stage.title}</strong><small>{passed} עברו{failed.length ? ` · ${failed.length} נכשלו` : ''}{flaky.length ? ` · ${flaky.length} לא יציבות` : ''} · {fmtDuration(stage.durationMs)}</small></span>
        <span className={`gl-pill${tone === 'ok' ? ' gl-pill--ok' : tone === 'bad' ? ' gl-pill--bad' : ''}`}>{tone === 'ok' ? 'תקין' : tone === 'bad' ? 'נכשל' : 'לבדיקה'}</span>
      </summary>
      <ul className="qa-tests">
        {ordered.slice(0, 120).map((t) => (
          <li key={t.id} className={`qa-test qa-test--${t.status}`}>
            {t.status === 'pass' ? <CircleCheck size={15} aria-hidden="true" /> : t.status === 'fail' ? <CircleAlert size={15} aria-hidden="true" /> : <TriangleAlert size={15} aria-hidden="true" />}
            <span><span className="qa-test__title">{t.title}</span><span className="qa-test__cat">{CATEGORY[t.category] ?? t.category}</span>{t.detail && t.status !== 'pass' && <small className="qa-test__detail">{t.detail}</small>}</span>
          </li>
        ))}
        {ordered.length > 120 && <li className="qa-test qa-test--more">ועוד {ordered.length - 120} בדיקות</li>}
      </ul>
    </details>
  )
}

function Review({ report, history, origin, note }: { report: QaReport; history: QaRunSummary[]; origin: string; note: string | null }) {
  const s = STATUS[report.status]
  const rate = passRate(report.totals)
  const security = report.stages.flatMap((st) => st.tests).filter((t) => t.category === 'security')
  const survival = report.stages.flatMap((st) => st.tests).filter((t) => t.category === 'survival' || t.category === 'recovery')
  const audit = report.metrics.audit
  const tile = (icon: React.ReactNode, value: string, label: string, tone?: string) => (
    <div className={`gl-surf qa-tile${tone ? ` qa-tile--${tone}` : ''}`}>{icon}<b>{value}</b><span>{label}</span></div>
  )
  return (
    <>
      <section className={`gl-surf qa-hero qa-hero--${s.tone}`} aria-labelledby="qa-title">
        <div className="qa-hero__copy">
          <p className="qa-eyebrow">סקירת QA · {fmtDate(report.run.finishedAt)} · {fmtTime(report.run.finishedAt)}</p>
          <h1 id="qa-title">{report.review.headline}</h1>
          <p className="qa-verdict">{report.review.verdict}</p>
          <span className={`gl-pill${s.tone === 'ok' ? ' gl-pill--ok' : s.tone === 'bad' ? ' gl-pill--bad' : ''}`}>{s.label}</span>
        </div>
        <Ring value={Math.round(rate)} tone={s.tone} />
      </section>
      {note && <p className="gl-summary">{note}</p>}

      <section className="qa-tiles" aria-label="במספרים">
        {tile(<CircleCheck size={18} aria-hidden="true" />, `${report.totals.passed}/${report.totals.tests - report.totals.skipped}`, 'בדיקות עברו', report.totals.failed ? undefined : 'ok')}
        {tile(<CircleAlert size={18} aria-hidden="true" />, String(report.totals.failed), 'נכשלו', report.totals.failed ? 'bad' : 'ok')}
        {tile(<TriangleAlert size={18} aria-hidden="true" />, String(report.totals.flaky), 'לא יציבות', report.totals.flaky ? 'warn' : undefined)}
        {tile(<ShieldCheck size={18} aria-hidden="true" />, `${security.filter((t) => t.status === 'pass').length}/${security.length}`, 'בדיקות אבטחה', security.some((t) => t.status === 'fail') ? 'bad' : 'ok')}
        {tile(<Sparkles size={18} aria-hidden="true" />, `${survival.filter((t) => t.status === 'pass').length}/${survival.length}`, 'שרידות והתאוששות', survival.some((t) => t.status === 'fail') ? 'bad' : 'ok')}
        {tile(<Timer size={18} aria-hidden="true" />, fmtDuration(report.run.durationMs), 'משך הריצה')}
      </section>

      {(report.review.changes.newlyFailing.length > 0 || report.review.changes.fixed.length > 0 || report.review.changes.newTests > 0) && (
        <section className="gl-surf gl-card" aria-labelledby="qa-changes">
          <h2 className="gl-card__title" id="qa-changes">מה השתנה מאז הריצה הקודמת</h2>
          <ul className="qa-bullets">
            {report.review.changes.newlyFailing.map((t) => <li key={`f-${t}`} className="qa-bullet qa-bullet--bad"><CircleAlert size={15} aria-hidden="true" />התחילה להיכשל: {t}</li>)}
            {report.review.changes.fixed.map((t) => <li key={`x-${t}`} className="qa-bullet qa-bullet--ok"><CircleCheck size={15} aria-hidden="true" />תוקנה: {t}</li>)}
            {report.review.changes.newTests > 0 && <li className="qa-bullet"><Sparkles size={15} aria-hidden="true" />{report.review.changes.newTests} בדיקות חדשות נוספו</li>}
          </ul>
        </section>
      )}

      <div className="qa-two">
        {report.review.highlights.length > 0 && (
          <section className="gl-surf gl-card" aria-labelledby="qa-good">
            <h2 className="gl-card__title" id="qa-good">מה טוב</h2>
            <ul className="qa-bullets">{report.review.highlights.map((h) => <li key={h} className="qa-bullet qa-bullet--ok"><CircleCheck size={15} aria-hidden="true" />{h}</li>)}</ul>
          </section>
        )}
        {report.review.risks.length > 0 && (
          <section className="gl-surf gl-card" aria-labelledby="qa-risk">
            <h2 className="gl-card__title" id="qa-risk">סיכונים ומה לבדוק</h2>
            <ul className="qa-bullets">{report.review.risks.map((h) => <li key={h} className="qa-bullet qa-bullet--bad"><CircleAlert size={15} aria-hidden="true" />{h}</li>)}</ul>
          </section>
        )}
      </div>

      {report.review.next.length > 0 && (
        <section className="gl-surf gl-card" aria-labelledby="qa-next">
          <h2 className="gl-card__title" id="qa-next">הצעדים הבאים</h2>
          <ol className="qa-next">{report.review.next.map((n) => <li key={n}>{n}</li>)}</ol>
        </section>
      )}

      <section className="gl-field" aria-labelledby="qa-stages">
        <h2 className="gl-label" id="qa-stages">כל שלבי הבדיקה</h2>
        {report.stages.map((stage) => <StageCard key={stage.id} stage={stage} />)}
      </section>

      {audit && (
        <section className="gl-surf gl-card" aria-labelledby="qa-audit">
          <h2 className="gl-card__title" id="qa-audit"><ShieldCheck size={17} aria-hidden="true" />תלויות (npm audit, ספריות בייצור)</h2>
          <div className="gl-wrap">
            <span className={`gl-pill${audit.critical ? ' gl-pill--bad' : ' gl-pill--ok'}`}>{audit.critical} קריטיות</span>
            <span className={`gl-pill${audit.high ? ' gl-pill--bad' : ' gl-pill--ok'}`}>{audit.high} גבוהות</span>
            <span className="gl-pill gl-pill--quiet">{audit.moderate} בינוניות</span>
            <span className="gl-pill gl-pill--quiet">{audit.low} נמוכות</span>
          </div>
        </section>
      )}

      <History runs={history} />

      <p className="qa-meta">
        <GitCommitHorizontal size={14} aria-hidden="true" /> {report.run.commit ? report.run.commit.slice(0, 7) : 'מקומי'} · {report.run.ref ?? ''} · {report.run.host}
        {' · '}<Clock size={14} aria-hidden="true" /> {fmtDuration(report.run.durationMs)} · {origin === 'stored' ? 'מהריצה האחרונה' : 'הדוח שנשלח עם הקוד'}
      </p>
    </>
  )
}
