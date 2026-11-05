import { SUITE_LABELS, QA_SUITES, type QaSuite } from './report'

// The 07:00 notification to the developer (owner, 2026-11-05): ONE notification with the two suites' status, pass or fail; when
// something failed it opens the full report on the failing suite with its problems highlighted. Pure, for the unit stage.
export type DigestRun = { id: string; status: 'pass' | 'warn' | 'fail'; passed: number; tests: number; failed: number; skipped: number } | null
export type Digest = { status: 'pass' | 'fail'; kind: 'dev.qa_digest_pass' | 'dev.qa_digest_fail'; title: string; body: string; url: string }

function line(suite: QaSuite, run: DigestRun): string {
  const name = SUITE_LABELS[suite]
  if (!run) return `${name}: הדוח לא הגיע`
  const counted = Math.max(0, run.tests - run.skipped)
  if (run.status === 'fail') return `${name}: נכשל, ${run.failed === 1 ? 'בדיקה אחת' : `${run.failed} בדיקות`}`
  return `${name}: עבר ${run.passed}/${counted}${run.status === 'warn' ? ' (עם הערות)' : ''}`
}

/** A missing report counts as a failure: the developer must hear that the morning run did not report. */
export function composeDigest(runs: Record<QaSuite, DigestRun>): Digest {
  const failing = QA_SUITES.filter((s) => !runs[s] || runs[s]!.status === 'fail')
  const ok = failing.length === 0
  return {
    status: ok ? 'pass' : 'fail',
    kind: ok ? 'dev.qa_digest_pass' : 'dev.qa_digest_fail',
    title: ok ? 'בדיקות הבוקר: הכול עבר' : `בדיקות הבוקר: ${failing.length === 2 ? 'שני הדוחות נכשלו' : `${SUITE_LABELS[failing[0]!]} נכשל`}`,
    body: QA_SUITES.map((s) => line(s, runs[s])).join(' · '),
    url: ok ? '/staff/dev/qa' : `/staff/dev/qa?suite=${failing[0]}&focus=problems`,
  }
}

/** The Israel calendar day of a moment (the digest's once-a-day key). */
export const israelDay = (at = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
