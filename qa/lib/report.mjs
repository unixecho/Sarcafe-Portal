// Builds the QA report (the contract is src/lib/qa/report.ts), compares it with the previous run, and writes the developer's
// morning review in Hebrew: a headline, a verdict, what is good, what is at risk, what changed since the last run, and next steps.
import fs from 'node:fs'
import path from 'node:path'

const CAT = { static: 'בדיקה סטטית', unit: 'לוגיקה', sql: 'מסד נתונים', security: 'אבטחה', e2e: 'מקצה לקצה', regression: 'רגרסיה', survival: 'שרידות', recovery: 'התאוששות', a11y: 'נגישות וקריאות', perf: 'ביצועים' }
const dur = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)} שניות` : `${Math.floor(ms / 60_000)} דקות ו־${Math.round((ms % 60_000) / 1000)} שניות`)

export function buildReport({ stages, startedAt, source, commit, ref, host, metrics, previous }) {
  const all = stages.flatMap((s) => s.tests)
  const totals = {
    tests: all.length,
    passed: all.filter((t) => t.status === 'pass').length,
    failed: all.filter((t) => t.status === 'fail').length,
    flaky: all.filter((t) => t.status === 'flaky').length,
    skipped: all.filter((t) => t.status === 'skip').length,
  }
  // A NEW high/critical advisory fails its own test (static.npm-audit); known, reviewed ones only show up in the review's risks.
  const status = totals.failed > 0 ? 'fail' : totals.flaky > 0 ? 'warn' : 'pass'
  const finishedAt = new Date().toISOString()
  const report = {
    version: 1,
    run: { startedAt, finishedAt, durationMs: Date.parse(finishedAt) - Date.parse(startedAt), source, commit, ref, host },
    status,
    totals,
    stages: stages.map((s) => ({ id: s.id, title: s.title, status: s.status, durationMs: s.durationMs, tests: s.tests.map((t) => ({ id: t.id, title: t.title.slice(0, 240), status: t.status, category: t.category, durationMs: t.durationMs, ...(t.detail ? { detail: t.detail.slice(0, 600) } : {}) })) })),
    metrics: { audit: metrics.audit ?? null, perf: metrics.perf ?? null, contrastLowest: metrics.contrastLowest ?? null },
    review: null,
  }
  report.review = writeReview(report, previous)
  return report
}

function writeReview(report, previous) {
  const { totals } = report
  const all = report.stages.flatMap((s) => s.tests)
  const byCat = (cat) => all.filter((t) => t.category === cat)
  const failed = all.filter((t) => t.status === 'fail')
  const flaky = all.filter((t) => t.status === 'flaky')
  const counted = totals.tests - totals.skipped
  const headline = report.status === 'pass' ? 'הכול ירוק. מוכן לשחרור.'
    : report.status === 'warn' ? 'כמעט מוכן. יש כמה דברים לבדוק.'
    : `${failed.length === 1 ? 'בדיקה אחת נכשלה' : `${failed.length} בדיקות נכשלו`}. לא לשחרר לפני תיקון.`
  const cats = ['security', 'survival', 'recovery', 'e2e', 'a11y'].map((c) => { const l = byCat(c); return l.length ? `${CAT[c]} ${l.filter((t) => t.status === 'pass').length}/${l.length}` : null }).filter(Boolean)
  const verdict = `${totals.passed} מתוך ${counted} בדיקות עברו ב־${dur(report.run.durationMs)}. ${cats.join(' · ')}.`

  const highlights = []
  for (const c of Object.keys(CAT)) {
    const l = byCat(c)
    if (l.length && l.every((t) => t.status === 'pass')) highlights.push(`כל בדיקות ה${CAT[c]} עברו (${l.length})`)
  }
  const a = report.metrics.audit
  if (a && a.critical === 0 && a.high === 0) highlights.push('אין חולשות קריטיות או גבוהות בספריות שרצות בייצור')
  else if (a && all.find((t) => t.id === 'static.npm-audit')?.status === 'pass') highlights.push('אין חולשות חדשות בספריות (רק הידועות שאושרו)')
  if (report.metrics.contrastLowest) highlights.push(`הטקסט קריא בכל המראות: הניגודיות הנמוכה ביותר ${report.metrics.contrastLowest.toFixed(2)}:1 (הסף 4.5)`)
  const perf = report.metrics.perf
  if (perf?.scrollWorstMs) highlights.push(`גלילה חלקה: הפריים האיטי ביותר ${Math.round(perf.scrollWorstMs)} מ״ש בהאטה פי 4`)

  const risks = []
  for (const t of failed.slice(0, 8)) risks.push(`${t.title}${t.detail ? `: ${t.detail.slice(0, 160)}` : ''}`)
  for (const t of flaky.slice(0, 3)) risks.push(`לא יציבה (עברה רק בניסיון השני): ${t.title}`)
  const auditTest = all.find((t) => t.id === 'static.npm-audit')
  if (a && (a.critical || a.high) && auditTest?.status === 'pass') risks.push(`${a.critical + a.high} חולשות ידועות בספריות (PostCSS בתוך Next 15, zod 3) נבדקו ואושרו עד השדרוג; כל חולשה חדשה תכשיל את הבדיקה`)
  const skipped = all.filter((t) => t.status === 'skip')
  if (skipped.length) risks.push(`${skipped.length} בדיקות דולגו בסביבה הזו (למשל ${skipped[0].title})`)

  const prev = new Map((previous?.stages ?? []).flatMap((s) => s.tests).map((t) => [t.id, t.status]))
  const changes = {
    newlyFailing: all.filter((t) => t.status === 'fail' && prev.get(t.id) && prev.get(t.id) !== 'fail').map((t) => t.title).slice(0, 40),
    fixed: all.filter((t) => t.status === 'pass' && prev.get(t.id) === 'fail').map((t) => t.title).slice(0, 40),
    newTests: previous?.stages?.length ? all.filter((t) => !prev.has(t.id)).length : 0,
  }

  const next = []
  if (failed.some((t) => t.category === 'security')) next.push('לתקן קודם את בדיקות האבטחה שנכשלו, לפני כל שינוי אחר')
  if (failed.some((t) => t.category === 'survival' || t.category === 'recovery')) next.push('לבדוק איך האפליקציה מתנהגת כשמסד הנתונים לא זמין, ולהחזיר הודעת שגיאה מסודרת')
  if (failed.some((t) => t.category === 'regression' || t.category === 'unit' || t.category === 'sql')) next.push('לפתוח את הבדיקה שנכשלה בשלבים למטה, לתקן ולהריץ שוב npm run qa')
  if (failed.some((t) => t.category === 'a11y')) next.push('לחזק את הרקע מאחורי הטקסט שסומן בבדיקת הקריאות')
  if (flaky.length) next.push('לייצב את הבדיקות הלא יציבות: לרוב זמן המתנה חסר או סדר טעינה')
  if (auditTest?.status === 'fail') next.push('יש חולשה חדשה בספריות: לעדכן (npm audit fix) או לבדוק ולאשר במפורש, ולהריץ שוב')
  else if (a && (a.critical || a.high)) next.push('לתכנן את השדרוג ל־Next 16 ול־zod 4, שסוגר את החולשות הידועות')
  if (!next.length) next.push('אין צורך בפעולה. הריצה הבאה מחר בבוקר, ואחרי כל פרסום')

  return { headline, verdict, highlights: highlights.slice(0, 12), risks: risks.slice(0, 12), changes, next: next.slice(0, 10) }
}

export function writeReport(dir, report) {
  fs.mkdirSync(path.join(dir, 'history'), { recursive: true })
  const stamp = report.run.finishedAt.replace(/[:.]/g, '-')
  fs.writeFileSync(path.join(dir, 'history', `${stamp}.json`), JSON.stringify(report, null, 2))
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(report, null, 2))
  const r = report.review
  const md = [
    `# סקירת QA · ${new Date(report.run.finishedAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`,
    '', `**${r.headline}**`, '', r.verdict, '',
    r.highlights.length ? '## מה טוב\n' + r.highlights.map((h) => `- ${h}`).join('\n') : '',
    r.risks.length ? '\n## סיכונים\n' + r.risks.map((h) => `- ${h}`).join('\n') : '',
    r.changes.newlyFailing.length || r.changes.fixed.length ? `\n## מה השתנה\n${r.changes.newlyFailing.map((t) => `- התחילה להיכשל: ${t}`).join('\n')}\n${r.changes.fixed.map((t) => `- תוקנה: ${t}`).join('\n')}` : '',
    '\n## הצעדים הבאים\n' + r.next.map((h, i) => `${i + 1}. ${h}`).join('\n'),
    '\n## שלבים\n' + report.stages.map((s) => `- ${s.status === 'pass' ? '✅' : s.status === 'warn' ? '⚠️' : '❌'} ${s.title}: ${s.tests.filter((t) => t.status === 'pass').length}/${s.tests.length}`).join('\n'),
  ].filter(Boolean).join('\n')
  fs.writeFileSync(path.join(dir, 'latest.md'), md + '\n')
  return md
}
