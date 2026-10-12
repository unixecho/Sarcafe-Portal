import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { Unauthorized, ApiError, Forbidden } from '@/lib/http/errors'
import { parseBody } from '@/lib/pos/server/guard'
import { DEV_TEMPLATE_IDS, devPushStatus, devSendTemplate, isPushDeveloper } from '@/lib/push/dev'
import { sendStaffTest } from '@/lib/push/staff'
import { privateStaffRoute } from '@/lib/staff/records'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { createServiceRoleClient } from '@/lib/supabase/server'

// A signed-in staff member (Google OR employee number + code) registers, checks, tests and removes
// the push subscription of the phone they are holding. The identity always comes from the session,
// never from the body, so nobody can subscribe a device to someone else's alerts.
//
// A push endpoint is a capability URL, so it is only ever stored server-side and only ever
// compared, never echoed back.

const subscription = z
  .object({
    endpoint: z.string().url().max(1000).refine((value) => value.startsWith('https://'), 'push endpoints are https'),
    keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(8).max(100) }).strict(),
  })
  .passthrough() // PushSubscription.toJSON() also carries expirationTime

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('subscribe'), subscription }).strict(),
  z.object({ action: z.literal('status'), endpoint: z.string().url().max(1000) }).strict(),
  z.object({ action: z.literal('unsubscribe'), endpoint: z.string().url().max(1000) }).strict(),
  z.object({ action: z.literal('test') }).strict(),
  // Developer test bench (see lib/push/dev.ts). Checked again server-side: hiding the panel is not access control.
  z.object({ action: z.literal('dev_status') }).strict(),
  z.object({ action: z.literal('dev_send'), template: z.enum(DEV_TEMPLATE_IDS) }).strict(),
])

export const POST = privateStaffRoute(async (request: NextRequest) => {
  const me = await resolveStaffIdentity()
  if (!me) throw Unauthorized('צריך להתחבר כדי להפעיל התראות.')
  const input = await parseBody(request, body)
  const service = createServiceRoleClient()

  if (input.action === 'subscribe') {
    // endpoint is unique: if another employee used this phone before, the row moves to this person.
    const { error } = await service.from('staff_push_subscriptions').upsert(
      {
        staff_id: me.id,
        endpoint: input.subscription.endpoint,
        p256dh: input.subscription.keys.p256dh,
        auth: input.subscription.keys.auth,
        user_agent: (request.headers.get('user-agent') ?? '').slice(0, 200) || null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' }
    )
    if (error) throw new ApiError(503, 'unavailable', 'לא הצלחנו להפעיל התראות. נסו שוב.')
    return NextResponse.json({ ok: true })
  }

  if (input.action === 'status') {
    const { data, error } = await service.from('staff_push_subscriptions').select('id').eq('staff_id', me.id).eq('endpoint', input.endpoint).maybeSingle()
    if (error) throw new ApiError(503, 'unavailable', 'לא הצלחנו לבדוק את ההתראות.')
    return NextResponse.json({ subscribed: !!data })
  }

  if (input.action === 'unsubscribe') {
    const { error } = await service.from('staff_push_subscriptions').delete().eq('staff_id', me.id).eq('endpoint', input.endpoint)
    if (error) throw new ApiError(503, 'unavailable', 'לא הצלחנו לכבות את ההתראות.')
    return NextResponse.json({ ok: true })
  }

  if (input.action === 'dev_status' || input.action === 'dev_send') {
    if (!isPushDeveloper(me)) throw Forbidden('כלי מפתח בלבד.')
    if (input.action === 'dev_status') return NextResponse.json(await devPushStatus(service, me))
    return NextResponse.json(await devSendTemplate(service, me, input.template))
  }

  return NextResponse.json(await sendStaffTest(me.id))
})
