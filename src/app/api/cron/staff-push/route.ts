import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, Unauthorized } from '@/lib/http/errors'
import { createStaffReminders } from '@/lib/push/staff-reminders'
import { flushStaffPush } from '@/lib/push/staff'
import { createServiceRoleClient } from '@/lib/supabase/server'

// Writes the timed staff reminders (shift starting soon, checklist not submitted) and pushes
// everything waiting in the inbox. Event-driven alerts (swaps, requests, publishing) are pushed
// straight after the request that made them; this run is what carries the timed ones and is the
// safety net for any that missed their request.
//
// Called every two minutes by Supabase's own scheduler (pg_cron + pg_net, migration
// 20261012130000). It is NOT in vercel.json: Vercel's Hobby plan only allows daily crons and a
// faster entry would fail the deploy. The caller proves itself with a bearer secret, either
// CRON_SECRET (the other crons) or the Vault secret the database keeps for itself, checked by
// staff_push_verify_cron() so it never leaves the database. Safe to call as often as you like:
// every reminder is written once, every push claimed once.
export const GET = apiRoute(async (request: NextRequest) => {
  const header = request.headers.get('authorization') ?? ''
  const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  const envSecret = process.env.CRON_SECRET
  let allowed = !!envSecret && bearer === envSecret
  if (!allowed && bearer.length >= 32) {
    const { data } = await createServiceRoleClient().rpc('staff_push_verify_cron', { p_secret: bearer })
    allowed = data === true
  }
  if (!allowed) throw Unauthorized('Not a scheduled invocation.')

  const reminders = await createStaffReminders()
  const push = await flushStaffPush()
  // Counts only — no names, no text.
  return NextResponse.json({ ok: true, reminders, push, at: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
})
