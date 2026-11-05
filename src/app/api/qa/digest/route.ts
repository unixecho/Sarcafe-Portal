import { after, NextResponse, type NextRequest } from 'next/server'
import { apiRoute, ApiError, Unauthorized } from '@/lib/http/errors'
import { qaCallerAllowed } from '@/lib/qa/auth'
import { composeDigest, israelDay, type DigestRun } from '@/lib/qa/digest'
import { QA_SUITES, type QaSuite } from '@/lib/qa/report'
import { isChecklistDeveloper } from '@/lib/checklists/developer'
import { flushStaffPush } from '@/lib/push/staff'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { isMissingObject } from '@/lib/tools/usage-server'

// The 07:00 digest (owner, 2026-11-05: "the developer gets a single notification at 7 AM with two status reports"). Called by the QA
// workflow's second job once both suites have reported and it is 07:00 in Israel (.github/workflows/qa.yml), with GitHub's own token
// (or QA_REPORT_SECRET). ONE notification per Israel day (qa_digests), to every developer only, saying each suite passed or failed;
// when one failed it opens /staff/dev/qa on that suite with its problems highlighted. A report that did not arrive is a failure.
// ?dry=1 answers what would be sent and sends nothing.
const NO_STORE = { 'Cache-Control': 'no-store' }

export const POST = apiRoute(async (request: NextRequest) => {
  if (!(await qaCallerAllowed(request.headers.get('authorization')))) throw Unauthorized()
  const dry = request.nextUrl.searchParams.get('dry') === '1'
  const service = createServiceRoleClient()
  const day = israelDay()
  const since = new Date(Date.now() - 26 * 3_600_000).toISOString()

  const runs = {} as Record<QaSuite, DigestRun>
  for (const suite of QA_SUITES) {
    const { data, error } = await service.from('qa_runs').select('id, status, totals').eq('suite', suite).gte('created_at', since).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (error) throw isMissingObject(error) ? new ApiError(503, 'not_ready', 'qa_runs is not created yet (migration 20261105090000).') : new ApiError(503, 'unavailable', 'Could not read the runs.')
    const row = data as { id: string; status: 'pass' | 'warn' | 'fail'; totals: { passed?: number; tests?: number; failed?: number; skipped?: number } } | null
    runs[suite] = row ? { id: row.id, status: row.status, passed: row.totals?.passed ?? 0, tests: row.totals?.tests ?? 0, failed: row.totals?.failed ?? 0, skipped: row.totals?.skipped ?? 0 } : null
  }
  const digest = composeDigest(runs)
  if (dry) return NextResponse.json({ ok: true, dry: true, day, digest }, { headers: NO_STORE })

  // claim the day first: a second call the same day (a re-run, a retry) sends nothing
  const { error: claimError } = await service.from('qa_digests').insert({ day, status: digest.status, runs: Object.fromEntries(QA_SUITES.map((s) => [s, runs[s] ? { id: runs[s]!.id, status: runs[s]!.status } : null])) })
  if (claimError) {
    if (claimError.code === '23505') return NextResponse.json({ ok: true, already: true, day }, { headers: NO_STORE })
    throw isMissingObject(claimError) ? new ApiError(503, 'not_ready', 'qa_digests is not created yet (migration 20261105090000).') : new ApiError(503, 'unavailable', 'Could not record the digest.')
  }

  const [{ data: staff, error: staffError }, { data: branches }] = await Promise.all([
    service.from('staff').select('id, badge, email, branch_id, active').eq('active', true),
    service.from('branches').select('id').eq('active', true).order('created_at', { ascending: true }).limit(1),
  ])
  const fallbackBranch = (branches?.[0] as { id: string } | undefined)?.id
  const developers = ((staff ?? []) as { id: string; badge: string | null; email: string | null; branch_id: string | null }[])
    .filter((s) => s.badge === 'developer' || isChecklistDeveloper(s.email))
  const rows = developers
    .map((d) => ({ staff_id: d.id, branch_id: d.branch_id ?? fallbackBranch, kind: digest.kind, title: digest.title, body: digest.body, link: { url: digest.url } }))
    .filter((r) => r.branch_id)
  if (staffError || rows.length === 0) {
    await service.from('qa_digests').delete().eq('day', day) // nobody told: let a retry try again
    throw new ApiError(503, 'unavailable', staffError ? 'Could not read the developers.' : 'No developer to tell.')
  }
  const { error: sendError } = await service.from('schedule_notifications').insert(rows)
  if (sendError) {
    await service.from('qa_digests').delete().eq('day', day)
    throw new ApiError(503, 'unavailable', 'Could not send the digest.')
  }
  after(async () => { try { await flushStaffPush() } catch { /* the 5-minute push cron picks it up */ } })
  return NextResponse.json({ ok: true, day, status: digest.status, sent: rows.length }, { status: 201, headers: NO_STORE })
})
