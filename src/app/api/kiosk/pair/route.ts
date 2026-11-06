import { createHash, randomBytes, randomInt } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { isMissingObject } from '@/lib/kiosk/remote'
import { PAIR_ALPHABET, PAIR_MINUTES, PAIR_TOKEN } from '@/lib/kiosk/enroll'
import { enrollConfig } from '@/lib/kiosk/enroll-server'
import { checkCredentialRateLimit, clientIp, credentialFingerprint } from '@/lib/rate-limit'

// Pairing a freshly installed kiosk by the short code on its own setup screen (migration 20261107000000_kiosk_pairings;
// docs/SARCAFE_KIOSK_INSTALL.md). Public by design: a new tablet has no key yet.
//
//   POST            a new pairing: { code (6 characters, shown on the tablet), token (the tablet's secret), expiresAt (15 min) }.
//                   5 per address per hour.
//   GET ?token=     waiting → { status: 'waiting', code } · once the owner typed the code in the dashboard → { status: 'ready',
//                   config } ONCE (claimed atomically) · unknown / expired / already claimed → 404.
//                   The short code is never a credential: only the token (stored as SHA-256) receives settings.

const HEADERS = { 'Cache-Control': 'no-store' }
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: HEADERS })
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const newCode = () => Array.from({ length: 6 }, () => PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)]).join('')

export async function POST(request: NextRequest) {
  if (!process.env.KIOSK_SIGNUP_KEY) return reply(503, { ok: false, error: 'not_configured' })
  if (!(await checkCredentialRateLimit(`kiosk-pair:${credentialFingerprint(clientIp(request))}`, 5, 3600))) return reply(429, { ok: false, error: 'rate_limited' })
  const service = createServiceRoleClient()
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + PAIR_MINUTES * 60_000).toISOString()
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode()
    const { error } = await service.from('kiosk_pairings').insert({ code, token_hash: hash(token), expires_at: expiresAt })
    if (!error) return reply(201, { ok: true, code, token, expiresAt })
    if (isMissingObject(error)) return reply(503, { ok: false, error: 'not_ready' })
    if (error.code !== '23505') return reply(502, { ok: false, error: 'unavailable' })
    // a code still in the table (even expired): clear old ones once and draw again
    if (attempt === 0) await service.from('kiosk_pairings').delete().lt('expires_at', new Date().toISOString())
  }
  return reply(503, { ok: false, error: 'unavailable' })
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? ''
  if (!PAIR_TOKEN.test(token)) return reply(400, { ok: false, error: 'bad_request' })
  try {
    const service = createServiceRoleClient()
    const now = new Date().toISOString()
    const { data, error } = await service.from('kiosk_pairings').select('id, code, device_id, pin_record, expires_at, paired_at, claimed_at').eq('token_hash', hash(token)).maybeSingle()
    if (error) return isMissingObject(error) ? reply(503, { ok: false, error: 'not_ready' }) : reply(502, { ok: false, error: 'unavailable' })
    const row = data as { id: string; code: string; device_id: string | null; pin_record: string | null; expires_at: string; paired_at: string | null; claimed_at: string | null } | null
    if (!row || row.claimed_at || row.expires_at < now) return reply(404, { ok: false, error: 'unknown_pairing' })
    if (!row.device_id || !row.paired_at) return reply(200, { ok: true, status: 'waiting', code: row.code, expiresAt: row.expires_at })
    const { data: claimed } = await service.from('kiosk_pairings').update({ claimed_at: now }).eq('id', row.id).is('claimed_at', null).select('id')
    if (!claimed || claimed.length === 0) return reply(404, { ok: false, error: 'unknown_pairing' })
    const config = await enrollConfig(row.device_id, row.pin_record, request.nextUrl.origin)
    if (config === 'not_configured') return reply(503, { ok: false, error: 'not_configured' })
    if (!config) return reply(404, { ok: false, error: 'unknown_pairing' })
    return reply(200, { ok: true, status: 'ready', config })
  } catch {
    return reply(502, { ok: false, error: 'unavailable' })
  }
}
