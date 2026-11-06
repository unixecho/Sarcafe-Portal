import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { DEFAULT_KIOSK_DEVICE, DEVICE_SLUG_PATTERN } from '@/lib/kiosk/device-settings'
import { keysMatch, readLimitedText } from '@/lib/kiosk/waitlist'
import { kioskStockWriteSchema, stockLabel, stockView } from '@/lib/kiosk/stock'
import { logMenuAudit } from '@/lib/menu/audit'
import { broadcastMenuUpdated } from '@/lib/menu/realtime'
import { isWithinOperatingHours } from '@/lib/shifts/hours'
import { checkCredentialRateLimit } from '@/lib/rate-limit'
import type { MenuDoc } from '@/lib/menu/types'

// Live stock from the kiosk's staff panel (owner, 2026-11-06), the same write as the dashboard's live-stock page
// (src/app/api/owner/menu-availability): set_availability() on the tablet's OWN branch menu, draft + published at once, audited.
// With the kiosk's shared key (X-Kiosk-Key = KIOSK_SIGNUP_KEY), like the panel's settings save; the panel itself only opens after the
// staff PIN in the app. The rules the dashboard gives a non-owner hold here too: only during operating hours (outside them → 403),
// and only items of the categories marked live (the dashboard's list) — nothing else on the menu can be touched from the tablet.
//
//   GET  ?device=<slug>                                   the live categories of the tablet's branch (draft), and whether it is open
//   POST {device?, itemUid, typeUid?, available?, quantity?}   one change
//
// Never cached. docs/SARCAFE_KIOSK_REMOTE.md.

const HEADERS = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Kiosk-Key' }
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: HEADERS })

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS })
}

function authorized(request: NextRequest): NextResponse | null {
  const secret = process.env.KIOSK_SIGNUP_KEY
  if (!secret) return reply(503, { ok: false, error: 'not_configured' })
  if (!keysMatch(request.headers.get('x-kiosk-key'), secret)) return reply(401, { ok: false, error: 'unauthorized' })
  return null
}

type Menu = { id: string; branchId: string; slug: string; draft: MenuDoc }

/** The tablet's branch menu, or the reason there is none. */
async function menuFor(slug: string): Promise<Menu | 'unknown_device' | 'no_menu'> {
  const service = createServiceRoleClient()
  const { data: device, error } = await service.from('kiosk_devices').select('branch_id, active').eq('slug', slug).maybeSingle()
  if (error) throw error
  const row = device as { branch_id: string | null; active: boolean } | null
  if (!row || !row.active || !row.branch_id) return 'unknown_device'
  const { data: menu, error: menuError } = await service.from('menus').select('id, slug, branch_id, draft').eq('branch_id', row.branch_id).maybeSingle()
  if (menuError) throw menuError
  const m = menu as { id: string; slug: string; branch_id: string; draft: MenuDoc } | null
  return m ? { id: m.id, slug: m.slug, branchId: m.branch_id, draft: m.draft } : 'no_menu'
}

export async function GET(request: NextRequest) {
  const refused = authorized(request)
  if (refused) return refused
  const slug = request.nextUrl.searchParams.get('device') || DEFAULT_KIOSK_DEVICE
  if (!DEVICE_SLUG_PATTERN.test(slug)) return reply(400, { ok: false, error: 'bad_request' })
  try {
    const menu = await menuFor(slug)
    if (menu === 'unknown_device') return reply(404, { ok: false, error: 'unknown_device' })
    if (menu === 'no_menu') return reply(404, { ok: false, error: 'no_menu' })
    const open = await isWithinOperatingHours(menu.branchId)
    return reply(200, { ok: true, open, categories: stockView(menu.draft) })
  } catch {
    return reply(502, { ok: false, error: 'unavailable' })
  }
}

export async function POST(request: NextRequest) {
  const refused = authorized(request)
  if (refused) return refused
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return reply(415, { ok: false, error: 'bad_request' })
  const text = await readLimitedText(request, 1024)
  if (text === null) return reply(413, { ok: false, error: 'too_large' })
  let json: unknown
  try { json = JSON.parse(text) } catch { return reply(400, { ok: false, error: 'bad_request' }) }
  const parsed = kioskStockWriteSchema.safeParse(json)
  if (!parsed.success) return reply(400, { ok: false, error: 'bad_request' })
  const body = parsed.data
  const slug = body.device ?? DEFAULT_KIOSK_DEVICE

  try {
    if (!(await checkCredentialRateLimit(`kiosk-stock:${slug}`, 240, 600))) return reply(429, { ok: false, error: 'rate_limited' })
    const menu = await menuFor(slug)
    if (menu === 'unknown_device') return reply(404, { ok: false, error: 'unknown_device' })
    if (menu === 'no_menu') return reply(404, { ok: false, error: 'no_menu' })
    const label = stockLabel(menu.draft, body.itemUid, body.typeUid)
    if (!label) return reply(404, { ok: false, error: 'not_live' })
    // the dashboard's rule for anyone but the owner: live stock only while the branch is selling
    if (!(await isWithinOperatingHours(menu.branchId))) return reply(403, { ok: false, error: 'closed' })

    const service = createServiceRoleClient()
    const { error } = await service.rpc('set_availability', {
      p_menu_id: menu.id,
      p_item_uid: body.itemUid,
      p_type_uid: body.typeUid,
      p_available: body.available ?? null,
      p_quantity: body.quantity ?? null,
      p_publish: true,
    })
    if (error) return reply(502, { ok: false, error: 'unavailable' })

    const summary = body.quantity !== undefined
      ? `עדכן כמות (מהקיוסק): ${label} — ${body.quantity}`
      : `${body.available ? 'סימן זמין (מהקיוסק)' : 'סימן אזל מהמלאי (מהקיוסק)'}: ${label}`
    await logMenuAudit(service, {
      actor: { display_name: `קיוסק ${slug}` },
      branchId: menu.branchId,
      menuId: menu.id,
      action: 'menu.availability',
      summary,
      detail: { itemUid: body.itemUid, typeUid: body.typeUid, available: body.available, quantity: body.quantity, published: true, source: 'kiosk', device: slug },
    })
    await broadcastMenuUpdated(menu.slug)

    const after = await menuFor(slug)
    return reply(200, { ok: true, categories: typeof after === 'string' ? null : stockView(after.draft) })
  } catch {
    return reply(502, { ok: false, error: 'unavailable' })
  }
}
