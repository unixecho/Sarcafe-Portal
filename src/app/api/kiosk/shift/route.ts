import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { resolveKiosk } from '@/lib/kiosk/device'
import { effective } from '@/lib/kiosk/device-settings'
import { loadKioskShift } from '@/lib/kiosk/shift'
import { keysMatch } from '@/lib/kiosk/waitlist'

// The kiosk header's "who is on shift now, and when we close", for the branch this kiosk is linked to. Unlike the menu and
// the cards this one is NOT public: it names people (first names, what the published schedule already shows every
// employee), so it needs the kiosk's shared key, and it answers only what the tablet's settings ask to show
// (display.showEmployees / display.showClosing). Never cached anywhere.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'X-Kiosk-Key',
  'Cache-Control': 'no-store',
}
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: CORS })

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(request: NextRequest) {
  const secret = process.env.KIOSK_SIGNUP_KEY
  if (!secret) return reply(503, { ok: false, error: 'not_configured' })
  if (!keysMatch(request.headers.get('x-kiosk-key'), secret)) return reply(401, { ok: false, error: 'unauthorized' })

  try {
    const kiosk = await resolveKiosk(request.nextUrl.searchParams.get('device'))
    if (!kiosk) return reply(404, { ok: false, error: 'unknown_device' })
    const settings = effective(kiosk.stored)
    if (!settings.display.showEmployees && !settings.display.showClosing) {
      return reply(200, { ok: true, asOf: new Date().toISOString(), people: [], closesAt: null })
    }
    const now = await loadKioskShift(createServiceRoleClient(), kiosk.branch.id, kiosk.branch.timezone)
    return reply(200, {
      ok: true,
      asOf: new Date().toISOString(),
      people: settings.display.showEmployees ? now.people : [],
      closesAt: settings.display.showClosing ? now.closesAt : null,
    })
  } catch (err) {
    console.error('Kiosk shift error:', err instanceof Error ? err.message : 'unknown')
    return reply(502, { ok: false, error: 'unavailable' })
  }
}
