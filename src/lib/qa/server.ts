import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/server'
import { isMissingObject } from '@/lib/tools/usage-server'
import { QaReport, type QaRunSummary } from './report'
import shipped from '../../../qa/reports/latest.json'

// The morning review's data: the newest stored run and the last 14 for the history strip. Before the migration is applied, or before
// the first nightly run, the review shows the report that shipped with the code (qa/reports/latest.json, written by `npm run qa`).
export type QaPageData = { latest: QaReport | null; history: QaRunSummary[]; origin: 'stored' | 'shipped' | 'none'; note: string | null }

function parseShipped(): QaReport | null {
  const parsed = QaReport.safeParse(shipped)
  return parsed.success ? parsed.data : null
}

export async function loadQaPage(): Promise<QaPageData> {
  const service = createServiceRoleClient()
  const { data, error } = await service.from('qa_runs').select('id, created_at, status, totals, commit_sha, report').order('created_at', { ascending: false }).limit(14)
  const fallback = parseShipped()
  if (error) {
    const note = isMissingObject(error) ? 'הטבלה qa_runs עוד לא נוצרה (מיגרציה 20261105090000). מוצג הדוח שנשלח עם הקוד.' : 'לא הצלחנו לקרוא את הדוחות השמורים. מוצג הדוח שנשלח עם הקוד.'
    return { latest: fallback, history: [], origin: fallback ? 'shipped' : 'none', note }
  }
  const rows = (data ?? []) as { id: string; created_at: string; status: 'pass' | 'warn' | 'fail'; totals: QaReport['totals']; commit_sha: string | null; report: unknown }[]
  const history: QaRunSummary[] = rows.map((r) => ({ id: r.id, createdAt: r.created_at, status: r.status, passed: r.totals?.passed ?? 0, tests: r.totals?.tests ?? 0, failed: r.totals?.failed ?? 0, commit: r.commit_sha })).reverse()
  const newest = rows[0] ? QaReport.safeParse(rows[0].report) : null
  if (newest?.success) return { latest: newest.data, history, origin: 'stored', note: null }
  return { latest: fallback, history, origin: fallback ? 'shipped' : 'none', note: rows.length ? null : 'עוד לא התקבל דוח מהריצה האוטומטית. מוצג הדוח שנשלח עם הקוד.' }
}
