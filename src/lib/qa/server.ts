import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/server'
import { isMissingObject } from '@/lib/tools/usage-server'
import { QaReport, QA_SUITES, type QaRunSummary, type QaSuite } from './report'
import shipped from '../../../qa/reports/latest.json'
import shippedKiosk from '../../../qa/reports/kiosk-latest.json'

// The morning review's data: the newest stored run and the last 14 for the history strip. Before the migration is applied, or before
// the first nightly run, the review shows the report that shipped with the code (qa/reports/latest.json, written by `npm run qa`).
// Two suites (dashboard, kiosk), one page each: `suites` carries both suites' newest status for the switch at the top.
export type QaPageData = { suite: QaSuite; latest: QaReport | null; history: QaRunSummary[]; origin: 'stored' | 'shipped' | 'none'; note: string | null; suites: Record<QaSuite, 'pass' | 'warn' | 'fail' | null> }

function parseShipped(suite: QaSuite): QaReport | null {
  const parsed = QaReport.safeParse(suite === 'kiosk' ? shippedKiosk : shipped)
  return parsed.success && parsed.data.suite === suite ? parsed.data : null
}

async function suiteStatuses(service: ReturnType<typeof createServiceRoleClient>): Promise<Record<QaSuite, 'pass' | 'warn' | 'fail' | null>> {
  const out = {} as Record<QaSuite, 'pass' | 'warn' | 'fail' | null>
  await Promise.all(QA_SUITES.map(async (suite) => {
    const { data } = await service.from('qa_runs').select('status').eq('suite', suite).order('created_at', { ascending: false }).limit(1).maybeSingle()
    out[suite] = (data as { status?: 'pass' | 'warn' | 'fail' } | null)?.status ?? parseShipped(suite)?.status ?? null
  }))
  return out
}

export async function loadQaPage(suite: QaSuite = 'dashboard'): Promise<QaPageData> {
  const service = createServiceRoleClient()
  const [{ data, error }, suites] = await Promise.all([
    service.from('qa_runs').select('id, created_at, status, totals, commit_sha, report').eq('suite', suite).order('created_at', { ascending: false }).limit(14),
    suiteStatuses(service),
  ])
  const fallback = parseShipped(suite)
  if (error) {
    const note = isMissingObject(error) ? 'הטבלה qa_runs עוד לא נוצרה (מיגרציה 20261105090000). מוצג הדוח שנשלח עם הקוד.' : 'לא הצלחנו לקרוא את הדוחות השמורים. מוצג הדוח שנשלח עם הקוד.'
    return { suite, suites, latest: fallback, history: [], origin: fallback ? 'shipped' : 'none', note }
  }
  const rows = (data ?? []) as { id: string; created_at: string; status: 'pass' | 'warn' | 'fail'; totals: QaReport['totals']; commit_sha: string | null; report: unknown }[]
  const history: QaRunSummary[] = rows.map((r) => ({ id: r.id, createdAt: r.created_at, status: r.status, passed: r.totals?.passed ?? 0, tests: r.totals?.tests ?? 0, failed: r.totals?.failed ?? 0, commit: r.commit_sha })).reverse()
  const newest = rows[0] ? QaReport.safeParse(rows[0].report) : null
  if (newest?.success) return { suite, suites, latest: newest.data, history, origin: 'stored', note: null }
  return { suite, suites, latest: fallback, history, origin: fallback ? 'shipped' : 'none', note: rows.length ? null : 'עוד לא התקבל דוח מהריצה האוטומטית. מוצג הדוח שנשלח עם הקוד.' }
}
