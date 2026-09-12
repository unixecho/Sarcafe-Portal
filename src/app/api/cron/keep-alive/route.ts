import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, Unauthorized } from '@/lib/http/errors'
import { createServiceRoleClient } from '@/lib/supabase/server'

// Supabase's free tier pauses a project after 7 days with no API activity.
// The Sarcafe QR codes are the only thing that normally touches the
// database — if nobody scans one for a week (a slow week, a branch closed,
// the owner away), the project goes idle and every page breaks with no
// warning until someone notices. Vercel Cron hits this once a day (see
// vercel.json) purely to keep the project active; the query itself is
// throwaway.
//
// Protected by CRON_SECRET (set in Vercel's project env vars) so this
// can't be hit by anyone who finds the URL — Vercel automatically sends
// `Authorization: Bearer $CRON_SECRET` on its own scheduled invocations.
export const GET = apiRoute(async (request: NextRequest) => {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) throw Unauthorized('Not a scheduled invocation.')

  const service = createServiceRoleClient()
  const { error } = await service.from('branches').select('id').limit(1)
  if (error) {
    // Still 200 — the point is that a request reached Supabase at all,
    // which is what resets its inactivity clock; a transient query error
    // shouldn't page anyone or make Vercel retry-storm this cron.
    console.error('keep-alive query failed:', error.message)
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString() })
})
