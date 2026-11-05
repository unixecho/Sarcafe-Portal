import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, ApiError, Unauthorized } from '@/lib/http/errors'
import { bearerMatches } from '@/lib/http/cron'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { QaReport } from '@/lib/qa/report'
import { isMissingObject } from '@/lib/tools/usage-server'

// Where the automatic QA suite reports (docs/QA_BLUEPRINT.md). The GitHub Actions workflow posts the JSON report with
// `Authorization: Bearer $QA_REPORT_SECRET` every morning and after every push to main. No secret configured = nothing accepted.
// The report is validated against the strict contract in src/lib/qa/report.ts and stored in qa_runs (service role only).
const MAX_BYTES = 600_000

export const POST = apiRoute(async (request: NextRequest) => {
  if (!bearerMatches(request.headers.get('authorization'), process.env.QA_REPORT_SECRET)) throw Unauthorized()
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new ApiError(413, 'too_large', 'Report too large.')
  if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) throw new ApiError(415, 'unsupported', 'JSON only.')
  const body = await request.text()
  if (body.length > MAX_BYTES) throw new ApiError(413, 'too_large', 'Report too large.')
  let raw: unknown
  try { raw = JSON.parse(body) } catch { throw new ApiError(400, 'bad_request', 'Invalid JSON.') }
  const report = QaReport.parse(raw)
  const { data, error } = await createServiceRoleClient().from('qa_runs').insert({
    source: report.run.source,
    commit_sha: report.run.commit,
    ref: report.run.ref,
    status: report.status,
    totals: report.totals,
    review: report.review,
    report,
  }).select('id').single()
  if (isMissingObject(error)) throw new ApiError(503, 'not_ready', 'qa_runs is not created yet (migration 20261105090000).')
  if (error) throw new ApiError(503, 'unavailable', 'Could not store the report.')
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 })
})
