import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, ApiError, BadRequest, NotFound, RateLimited } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { parseBody } from '@/lib/pos/server/guard'
import { checkCredentialRateLimit } from '@/lib/rate-limit'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { isMissingObject, loadRemoteState } from '@/lib/kiosk/remote'
import { pinProblem, remoteActionSchema } from '@/lib/kiosk/remote-rules'
import { pinRecord } from '@/lib/kiosk/pin-record'

// The kiosk dashboard's actions on one tablet (owner, 2026-11-05: "I want to be able to reset the kiosk pin as well from the
// dashboard"). Full owner only, same-origin JSON only. docs/SARCAFE_KIOSK_REMOTE.md.
//
//   command / cancel_command   one thing for the tablet to do at its next report (reload its page, look for updates now)
//   pin / cancel_pin           a new staff PIN for the tablet: ONLY its PBKDF2 record is stored (the app's own format), the PIN is
//                              never kept, logged or returned; the app (0.4+) fetches it with the kiosk key and adopts it.
//                              5 per owner per hour, fail closed (it is a credential).
// Answers the remote state of every tablet (never a PIN record).

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const notReady = () => new ApiError(503, 'not_ready', 'עדכון מסד הנתונים של שליטת הקיוסק מרחוק עדיין לא הוחל.')

export const POST = apiRoute(async (request: NextRequest) => {
  const me = await requireOwner()
  const body = await parseBody(request, remoteActionSchema)
  const service = createServiceRoleClient()
  const { data: row, error } = await service.from('kiosk_devices').select('id, slug').eq('slug', body.slug).maybeSingle()
  if (error) throw isMissingObject(error) ? notReady() : new Error('kiosk device read failed')
  if (!row) throw NotFound('הטאבלט לא נמצא.')

  if (body.action === 'command' || body.action === 'cancel_command') {
    const pending = body.action === 'command' ? { id: randomUUID(), kind: body.kind, at: new Date().toISOString() } : null
    const { error: updateError } = await service.from('kiosk_devices').update({ pending_command: pending }).eq('id', row.id)
    if (updateError) throw isMissingObject(updateError) ? notReady() : new Error('kiosk command write failed')
  } else if (body.action === 'pin') {
    const problem = pinProblem(body.pin)
    if (problem) throw BadRequest(problem)
    if (body.pin !== body.confirm) throw BadRequest('שני הקודים לא זהים.')
    if (!(await checkCredentialRateLimit(`kiosk-pin:${me.id}`, 5, 3600))) throw RateLimited('יותר מדי איפוסי קוד בשעה האחרונה. נסו שוב מאוחר יותר.')
    const { error: pinError } = await service.from('kiosk_pin_resets').upsert(
      { device_id: row.id, id: randomUUID(), record: pinRecord(body.pin), created_by: me.id, created_at: new Date().toISOString(), delivered_at: null },
      { onConflict: 'device_id' },
    )
    if (pinError) throw isMissingObject(pinError) ? notReady() : new Error('kiosk pin write failed')
  } else {
    const { error: deleteError } = await service.from('kiosk_pin_resets').delete().eq('device_id', row.id)
    if (deleteError) throw isMissingObject(deleteError) ? notReady() : new Error('kiosk pin cancel failed')
  }

  return NextResponse.json({ remote: await loadRemoteState(service) }, { headers: NO_STORE })
})

export const GET = apiRoute(async () => {
  await requireOwner()
  return NextResponse.json({ remote: await loadRemoteState(createServiceRoleClient()) }, { headers: NO_STORE })
})
