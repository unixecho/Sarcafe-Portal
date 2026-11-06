import { createHash } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { readLimitedText } from '@/lib/kiosk/waitlist'
import { isMissingObject } from '@/lib/kiosk/remote'
import { enrollRequestSchema, type EnrollConfig } from '@/lib/kiosk/enroll'
import { menuChannelName } from '@/lib/menu/realtime'
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
  const key = process.env.KIOSK_SIGNUP_KEY
  const rt = process.env.NEXT_PUBLIC_SUPABASE_URL
  const rtKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!key || !rt || !rtKey) return reply(503, { ok: false, error: 'not_configured' })
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

    const { data: device } = await service.from('kiosk_devices').select('slug, name, branch_id').eq('id', row.device_id).maybeSingle()
    const d = device as { slug: string; name: string; branch_id: string } | null
    if (!d) return reply(404, { ok: false, error: 'unknown_code' })
    const { data: branch } = await service.from('branches').select('slug').eq('id', d.branch_id).maybeSingle()
    const branchSlug = (branch as { slug: string } | null)?.slug
    if (!branchSlug) return reply(502, { ok: false, error: 'unavailable' })

    const origin = request.nextUrl.origin
    const config: EnrollConfig = {
      device: d.slug, name: d.name, branch: branchSlug,
      api: `${origin}/api/kiosk/menu`, ota: `${origin}/kiosk-ota/`,
      rt, rtKey, rtChannel: menuChannelName(branchSlug), key,
      pinRecord: row.pin_record,
    }
    return reply(200, { ok: true, config })
  } catch {
    return reply(502, { ok: false, error: 'unavailable' })
  }
}
