import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, Unauthorized } from '@/lib/http/errors'
import { createServiceRoleClient } from '@/lib/supabase/server'

// Runs the retention job defined in migration 009 (clear old contact
// emails at 12 months, delete feedback rows at 24 months), plus migration
// 018's order-access cleanup (expired QR/recovery-code hashes + orphaned
// push subscriptions). Sarcafe has no pg_cron (confirmed: no other
// migration here schedules one) — every scheduled job goes through
// Vercel Cron hitting a protected route. The order-access job rides this
// same daily route rather than getting its own — Hobby-tier projects have
// a low per-project cron-job ceiling, already spent on this route plus
// keep-alive/route.ts — but each RPC call below still fails independently
// (its own try/catch, its own log line) so one job's error can't mask or
// abort the other's.
export const GET = apiRoute(async (request: NextRequest) => {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) throw Unauthorized('Not a scheduled invocation.')

  const service = createServiceRoleClient()

  let feedback: { emails_cleared: number; rows_deleted: number } | undefined
  let feedbackOk = true
  try {
    const { data, error } = await service.rpc('cleanup_customer_feedback')
    if (error) throw error
    feedback = data?.[0]
  } catch (err) {
    feedbackOk = false
    console.error('cleanup_customer_feedback failed:', err instanceof Error ? err.message : err)
  }

  let orderAccessOk = true
  try {
    const { error } = await service.rpc('cleanup_order_access')
    if (error) throw error
  } catch (err) {
    orderAccessOk = false
    console.error('cleanup_order_access failed:', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ ok: feedbackOk && orderAccessOk, feedback, orderAccessOk, at: new Date().toISOString() })
})
