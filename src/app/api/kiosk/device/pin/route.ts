import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { DEFAULT_KIOSK_DEVICE, DEVICE_SLUG_PATTERN } from '@/lib/kiosk/device-settings'
import { keysMatch, readLimitedText } from '@/lib/kiosk/waitlist'
import { isMissingObject } from '@/lib/kiosk/remote'
import { PIN_RECORD, pinAckSchema } from '@/lib/kiosk/remote-rules'

// A new staff PIN chosen on the dashboard, for the kiosk APP (0.4+, OtaUpdater) — never the page. With the kiosk's shared key only
// (X-Kiosk-Key = KIOSK_SIGNUP_KEY; without it in the environment both answer 503). docs/SARCAFE_KIOSK_REMOTE.md.
//
//   GET  ?device=<slug>  the waiting PIN record for that tablet, or null. The record is the app's own PBKDF2 format
//                        ("pbkdf2$<iterations>$<salt>$<hash>"): the PIN itself is never stored, sent or logged.
//   POST {device?, id}   the app adopted that record: it is deleted and the tablet's row says when.
//
// Never cached. Nothing here is logged except a generic failure.

const HEADERS = { 'Cache-Control': 'no-store' }
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: HEADERS })

function authorized(request: NextRequest): NextResponse | null {
  const secret = process.env.KIOSK_SIGNUP_KEY
  if (!secret) return reply(503, { ok: false, error: 'not_configured' })
  if (!keysMatch(request.headers.get('x-kiosk-key'), secret)) return reply(401, { ok: false, error: 'unauthorized' })
  return null
}

async function deviceId(slug: string): Promise<{ id: string } | 'missing' | null> {
  const { data, error } = await createServiceRoleClient().from('kiosk_devices').select('id').eq('slug', slug).maybeSingle()
  if (error) { if (isMissingObject(error)) return 'missing'; throw error }
  return data ? { id: (data as { id: string }).id } : null
}

export async function GET(request: NextRequest) {
  const refused = authorized(request)
  if (refused) return refused
  const slug = request.nextUrl.searchParams.get('device') ?? DEFAULT_KIOSK_DEVICE
  if (!DEVICE_SLUG_PATTERN.test(slug)) return reply(400, { ok: false, error: 'bad_request' })
  try {
    const device = await deviceId(slug)
    if (device === 'missing') return reply(503, { ok: false, error: 'not_ready' })
    if (!device) return reply(404, { ok: false, error: 'unknown_device' })
    const service = createServiceRoleClient()
    const { data, error } = await service.from('kiosk_pin_resets').select('id, record').eq('device_id', device.id).maybeSingle()
    if (error) return isMissingObject(error) ? reply(503, { ok: false, error: 'not_ready' }) : reply(502, { ok: false, error: 'unavailable' })
    const row = data as { id: string; record: string } | null
    if (!row || !PIN_RECORD.test(row.record)) return reply(200, { ok: true, reset: null })
    await service.from('kiosk_pin_resets').update({ delivered_at: new Date().toISOString() }).eq('device_id', device.id).eq('id', row.id)
    return reply(200, { ok: true, reset: { id: row.id, record: row.record } })
  } catch {
    return reply(502, { ok: false, error: 'unavailable' })
  }
}

export async function POST(request: NextRequest) {
  const refused = authorized(request)
  if (refused) return refused
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return reply(415, { ok: false, error: 'bad_request' })
  const text = await readLimitedText(request, 512)
  if (text === null) return reply(413, { ok: false, error: 'too_large' })
  let json: unknown
  try { json = JSON.parse(text) } catch { return reply(400, { ok: false, error: 'bad_request' }) }
  const parsed = pinAckSchema.safeParse(json)
  if (!parsed.success) return reply(400, { ok: false, error: 'bad_request' })
  try {
    const device = await deviceId(parsed.data.device ?? DEFAULT_KIOSK_DEVICE)
    if (device === 'missing') return reply(503, { ok: false, error: 'not_ready' })
    if (!device) return reply(404, { ok: false, error: 'unknown_device' })
    const service = createServiceRoleClient()
    const { data, error } = await service.from('kiosk_pin_resets').delete().eq('device_id', device.id).eq('id', parsed.data.id).select('id')
    if (error) return isMissingObject(error) ? reply(503, { ok: false, error: 'not_ready' }) : reply(502, { ok: false, error: 'unavailable' })
    if (!data || data.length === 0) return reply(404, { ok: false, error: 'unknown_reset' })
    await service.from('kiosk_devices').update({ pin_reset_applied_at: new Date().toISOString() }).eq('id', device.id)
    return reply(200, { ok: true })
  } catch {
    return reply(502, { ok: false, error: 'unavailable' })
  }
}
