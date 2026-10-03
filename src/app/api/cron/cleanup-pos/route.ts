import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, Unauthorized } from '@/lib/http/errors'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { RETENTION } from '@/lib/pos/vocab'
import { safeLogMessage } from '@/lib/pos/server/guard'

// Runs the POS retention job (migration 020, pos_clear_old_pii): a customer's PHONE is
// cleared N days after the event's session ended, their NAME is replaced by a neutral
// placeholder after M days — both scrubbed from the audit payloads too. The windows are
// the RETENTION constants in lib/pos/vocab.ts (blueprint §14), passed as arguments so
// moving one is a one-line change, not a migration.
//
// Same shape as cleanup-feedback: Vercel Cron hits a protected route (no pg_cron here),
// its own route rather than folded into another job so a failure points at one job.
// Protected by CRON_SECRET; Vercel sends `Authorization: Bearer $CRON_SECRET` itself.
//
// Only COUNTS are logged or returned — never a name, never a number.
export const GET = apiRoute(async (request: NextRequest) => {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) throw Unauthorized('Not a scheduled invocation.')

  const service = createServiceRoleClient()
  const { data, error } = await service.rpc('pos_clear_old_pii', {
    p_phone_days: RETENTION.phoneDays,
    p_name_days: RETENTION.nameDays,
  })
  if (error) {
    console.error('pos_clear_old_pii failed:', error.code, safeLogMessage(error.message))
    // 200 on purpose, like the other cron routes: a retry storm would not fix a SQL error.
    return NextResponse.json({ ok: false }, { status: 200 })
  }

  const result = (data ?? {}) as { phones?: number; names?: number }

  // Quick-login sessions older than 3 days stop counting as "quick" (migration 022). Their
  // own cookie dies on its own schedule; this only keeps the table from growing. Its own
  // failure must not hide the PII job's result above.
  let quickSessions = 0
  const swept = await service.rpc('pos_clear_old_quick_sessions', { p_days: 3 })
  if (swept.error) console.error('pos_clear_old_quick_sessions failed:', swept.error.code, safeLogMessage(swept.error.message))
  else quickSessions = typeof swept.data === 'number' ? swept.data : 0

  return NextResponse.json({ ok: true, phones: result.phones ?? 0, names: result.names ?? 0, quickSessions, at: new Date().toISOString() })
})
