import { createHash } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { readLimitedText } from '@/lib/kiosk/waitlist'
import { isMissingObject } from '@/lib/kiosk/remote'
import { enrollRequestSchema } from '@/lib/kiosk/enroll'
import { enrollConfig } from '@/lib/kiosk/enroll-server'
import { checkCredentialRateLimit, clientIp, credentialFingerprint } from '@/lib/rate-limit'

// A newly installed kiosk asks for its settings ONCE (docs/SARCAFE_KIOSK_INSTALL.md). The tablet holds a one-time install code that
// came inside the QR on the owner's wizard page (/owner/kiosk/install); it has no key yet, so the code IS the credential:
// 32 random bytes, stored only as SHA-256, valid 24 hours, used once (marked used atomically before anything is answered).
// 10 tries per address per hour, fail closed. Answers the same settings the adb setup used to give the tablet, the kiosk key
// among them, so it is never cached and never logged. Any wrong, used or expired code: the same 404.

const HEADERS = { 'Cache-Control': 'no-store' }
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: HEADERS })

export async function POST(request: NextRequest) {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return reply(415, { ok: false, error: 'bad_request' })
  if (!process.env.KIOSK_SIGNUP_KEY) return reply(503, { ok: false, error: 'not_configured' })
  const text = await readLimitedText(request, 512)
  if (text === null) return reply(413, { ok: false, error: 'too_large' })
  let json: unknown
  try { json = JSON.parse(text) } catch { return reply(400, { ok: false, error: 'bad_request' }) }
  const parsed = enrollRequestSchema.safeParse(json)
  if (!parsed.success) return reply(400, { ok: false, error: 'bad_request' })
  if (!(await checkCredentialRateLimit(`kiosk-enroll:${credentialFingerprint(clientIp(request))}`, 10, 3600))) return reply(429, { ok: false, error: 'rate_limited' })

  try {
    const service = createServiceRoleClient()
    const hash = createHash('sha256').update(parsed.data.code).digest('hex')
    // claim it first: a code is good once, even when two tablets scan the same QR at the same moment
    const { data: claimed, error } = await service.from('kiosk_enrollments')
      .update({ used_at: new Date().toISOString() })
      .eq('code_hash', hash).is('used_at', null).gt('expires_at', new Date().toISOString())
      .select('device_id, pin_record')
    if (error) return isMissingObject(error) ? reply(503, { ok: false, error: 'not_ready' }) : reply(502, { ok: false, error: 'unavailable' })
    const row = (claimed ?? [])[0] as { device_id: string; pin_record: string | null } | undefined
    if (!row) return reply(404, { ok: false, error: 'unknown_code' })

    const config = await enrollConfig(row.device_id, row.pin_record, request.nextUrl.origin)
    if (config === 'not_configured') return reply(503, { ok: false, error: 'not_configured' })
    if (!config) return reply(404, { ok: false, error: 'unknown_code' })
    return reply(200, { ok: true, config })
  } catch {
    return reply(502, { ok: false, error: 'unavailable' })
  }
}
