import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, Unauthorized } from '@/lib/http/errors'
import { createServiceRoleClient } from '@/lib/supabase/server'

// Runs the retention job defined in migration 009 (clear old contact
// emails at 12 months, delete feedback rows at 24 months). Sarcafe has no
// pg_cron (confirmed: no other migration here schedules one) — every
// scheduled job goes through Vercel Cron hitting a protected route, same
// pattern as keep-alive/route.ts, just its own route rather than folded
// into that one: two jobs fail independently, and one cron log holding two
// unrelated jobs makes "which half errored" a question you'd have to go
// read the function body to answer.
export const GET = apiRoute(async (request: NextRequest) => {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) throw Unauthorized('Not a scheduled invocation.')

  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('cleanup_customer_feedback')
  if (error) {
    console.error('cleanup_customer_feedback failed:', error.message)
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  const result = data?.[0] as { emails_cleared: number; rows_deleted: number } | undefined
  return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() })
})
