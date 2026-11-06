import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, ApiError, BadRequest, RateLimited } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { parseBody } from '@/lib/pos/server/guard'
import { checkCredentialRateLimit } from '@/lib/rate-limit'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { isMissingObject } from '@/lib/kiosk/remote'
import { pinProblem } from '@/lib/kiosk/remote-rules'
import { pinRecord } from '@/lib/kiosk/pin-record'
import { ENROLL_HOURS, installRequestSchema, provisioningPayload } from '@/lib/kiosk/enroll'

// The kiosk install wizard's server side (owner, 2026-11-06; docs/SARCAFE_KIOSK_INSTALL.md). Full owner only, same-origin JSON.
//
//   GET   is a QR install possible (the published app carries its signing-certificate digest), and the recent installs
//   POST  {branchId, slug, name, pin, confirm, wifi?}: registers the tablet (or keeps an existing one with that name: a reinstall),
//         makes a one-time install code (24 h) and answers the QR's contents ONCE. Stored: the code's SHA-256 and the PIN's
//         PBKDF2 record only. The Wi-Fi password, when given, is only in the answer (inside the QR), never stored.
//         10 per owner per hour, fail closed.

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const notReady = () => new ApiError(503, 'not_ready', 'עדכון מסד הנתונים של אשף ההתקנה עדיין לא הוחל (20261106140000).')

type Latest = { versionCode: number; versionName: string; url: string; certSha256?: string }
function latestApp(): Latest | null {
  try { return JSON.parse(readFileSync(join(process.cwd(), 'public', 'kiosk-ota', 'apk', 'latest.json'), 'utf8')) as Latest } catch { return null }
}

export const GET = apiRoute(async () => {
  await requireOwner()
  const app = latestApp()
  const service = createServiceRoleClient()
  const { data, error } = await service.from('kiosk_enrollments').select('id, device_id, created_at, expires_at, used_at').order('created_at', { ascending: false }).limit(10)
  const ready = !error || !isMissingObject(error)
  const rows = (data ?? []) as Array<{ id: string; device_id: string; created_at: string; expires_at: string; used_at: string | null }>
  const ids = [...new Set(rows.map((r) => r.device_id))]
  const { data: devices } = ids.length ? await service.from('kiosk_devices').select('id, slug, name').in('id', ids) : { data: [] }
  const byId = new Map(((devices ?? []) as Array<{ id: string; slug: string; name: string }>).map((d) => [d.id, d]))
  return NextResponse.json({
    ready,
    app: app ? { version: app.versionName, qr: typeof app.certSha256 === 'string' } : null,
    recent: rows.map((r) => ({ id: r.id, slug: byId.get(r.device_id)?.slug ?? null, name: byId.get(r.device_id)?.name ?? null, createdAt: r.created_at, expiresAt: r.expires_at, usedAt: r.used_at })),
  }, { headers: NO_STORE })
})

export const POST = apiRoute(async (request: NextRequest) => {
  const me = await requireOwner()
  const body = await parseBody(request, installRequestSchema)
  const problem = pinProblem(body.pin)
  if (problem) throw BadRequest(problem)
  if (body.pin !== body.confirm) throw BadRequest('שני הקודים לא זהים.')
  const app = latestApp()
  if (!body.pairCode && !app?.certSha256) throw new ApiError(409, 'no_app', 'עוד אין גרסה של האפליקציה שאפשר להתקין ב־QR. היא נבנית עם השינוי הבא בקיוסק.')
  if (!(await checkCredentialRateLimit(`kiosk-install:${me.id}`, 10, 3600))) throw RateLimited('יותר מדי התקנות בשעה האחרונה. נסו שוב מאוחר יותר.')

  const service = createServiceRoleClient()
  // pairing by the code on the tablet's own setup screen: the pairing must exist, be fresh and not yet taken
  let pairingId: string | null = null
  if (body.pairCode) {
    const { data: pairing, error: pairError } = await service.from('kiosk_pairings').select('id, expires_at, paired_at').eq('code', body.pairCode).maybeSingle()
    if (pairError) throw isMissingObject(pairError) ? new ApiError(503, 'not_ready', 'עדכון מסד הנתונים של החיבור בקוד עדיין לא הוחל (20261107000000).') : new Error('kiosk pairing read failed')
    const p = pairing as { id: string; expires_at: string; paired_at: string | null } | null
    if (!p || p.paired_at || p.expires_at < new Date().toISOString()) throw new ApiError(404, 'unknown_pairing', 'הקוד לא נמצא או שפג תוקפו. בטאבלט מופיע קוד חדש כל 15 דקות.')
    pairingId = p.id
  }
  const { data: branch } = await service.from('branches').select('id').eq('id', body.branchId).maybeSingle()
  if (!branch) throw BadRequest('הסניף לא נמצא.')

  // the tablet: a new one, or an existing one with this name (a complete reinstall keeps its settings and history)
  const { data: existing, error: readError } = await service.from('kiosk_devices').select('id, branch_id').eq('slug', body.slug).maybeSingle()
  if (readError) throw new Error('kiosk device read failed')
  let deviceId: string
  if (existing) {
    deviceId = (existing as { id: string }).id
    const { error } = await service.from('kiosk_devices').update({ name: body.name, branch_id: body.branchId, active: true }).eq('id', deviceId)
    if (error) throw new Error('kiosk device update failed')
  } else {
    const { data: created, error } = await service.from('kiosk_devices').insert({ slug: body.slug, name: body.name, branch_id: body.branchId, settings_updated_by: me.id }).select('id').single()
    if (error) { if (error.code === '23505') throw new ApiError(409, 'taken', 'השם הזה כבר תפוס.'); throw new Error('kiosk device insert failed') }
    deviceId = (created as { id: string }).id
  }

  if (pairingId) {
    const { data: paired, error: pairWrite } = await service.from('kiosk_pairings')
      .update({ device_id: deviceId, pin_record: pinRecord(body.pin), paired_by: me.id, paired_at: new Date().toISOString() })
      .eq('id', pairingId).is('paired_at', null).select('id')
    if (pairWrite) throw new Error('kiosk pairing write failed')
    if (!paired || paired.length === 0) throw new ApiError(404, 'unknown_pairing', 'הקוד כבר שימש.')
    return NextResponse.json({ paired: true, slug: body.slug }, { status: 201, headers: NO_STORE })
  }

  const code = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + ENROLL_HOURS * 3_600_000).toISOString()
  const { error: enrollError } = await service.from('kiosk_enrollments').insert({
    code_hash: createHash('sha256').update(code).digest('hex'),
    device_id: deviceId,
    pin_record: pinRecord(body.pin),
    created_by: me.id,
    expires_at: expiresAt,
  })
  if (enrollError) throw isMissingObject(enrollError) ? notReady() : new Error('kiosk enrollment write failed')

  const origin = request.nextUrl.origin
  const qr = provisioningPayload({ apkUrl: `${origin}/kiosk-ota/apk/${app!.url}`, certSha256: app!.certSha256!, code, portal: origin, wifi: body.wifi })
  return NextResponse.json({ qr, expiresAt, app: app!.versionName, slug: body.slug }, { status: 201, headers: NO_STORE })
})
