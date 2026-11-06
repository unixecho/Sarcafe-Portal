import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { DEFAULT_KIOSK_DEVICE, DEVICE_SLUG_PATTERN } from '@/lib/kiosk/device-settings'
import { keysMatch, readLimitedText } from '@/lib/kiosk/waitlist'
import { findEntry, isEmptyEdit, itemOfType, menuEditSchema, menuTree, type MenuEdit } from '@/lib/kiosk/menu-edit'
import { logMenuAudit, type MenuAuditAction } from '@/lib/menu/audit'
import { broadcastMenuUpdated } from '@/lib/menu/realtime'
import { isWithinOperatingHours } from '@/lib/shifts/hours'
import { checkCredentialRateLimit } from '@/lib/rate-limit'
import type { MenuDoc } from '@/lib/menu/types'

// The menu editor in the kiosk's staff panel (owner, 2026-11-06), behind the staff PIN in the app, with the kiosk's key. The same
// database writes as the dashboard's tablet tools (src/app/api/owner/menu-items, menu-item-types) plus menu_update_entry for a name
// or a price, on the tablet's OWN branch menu only. The dashboard's rule for anyone but the owner: only during opening hours, and
// then draft + the published menu together (customers see it at once). Every change is in the menu audit log "(מהקיוסק)".
//
//   GET  ?device=<slug>   every category, item and type (draft) + whether the branch is open
//   POST {op, ...}        add_item | remove_item | add_type | remove_type | update (name and/or price)
//
// Never cached. 120 changes per tablet per 10 minutes. docs/SARCAFE_KIOSK_MENU.md.

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

const newUid = (prefix: string) => `${prefix}${Date.now().toString(36)}${randomBytes(4).toString('hex')}`

export async function GET(request: NextRequest) {
  const refused = authorized(request)
  if (refused) return refused
  const slug = request.nextUrl.searchParams.get('device') || DEFAULT_KIOSK_DEVICE
  if (!DEVICE_SLUG_PATTERN.test(slug)) return reply(400, { ok: false, error: 'bad_request' })
  try {
    const menu = await menuFor(slug)
    if (typeof menu === 'string') return reply(404, { ok: false, error: menu })
    return reply(200, { ok: true, open: await isWithinOperatingHours(menu.branchId), categories: menuTree(menu.draft) })
  } catch {
    return reply(502, { ok: false, error: 'unavailable' })
  }
}

type Plan = { calls: Array<{ fn: string; args: Record<string, unknown> }>; action: MenuAuditAction; summary: string; detail: Record<string, unknown> }

/** What one change does in the database, or the error code to answer. */
function plan(edit: MenuEdit, menu: Menu): Plan | { error: string; status: number } {
  const p = { p_menu_id: menu.id, p_publish: true }
  switch (edit.op) {
    case 'add_item': {
      const category = menu.draft.categories?.find((c) => String(c.id) === edit.categoryId)
      if (!category) return { error: 'not_found', status: 404 }
      const uid = newUid('k')
      return {
        calls: [{ fn: 'add_menu_item', args: { ...p, p_category_id: edit.categoryId, p_item: { uid, he: edit.name, ...(edit.price ? { price: edit.price } : {}) } } }],
        action: 'menu.item.add', summary: `הוסיף פריט (מהקיוסק): ${edit.name}`, detail: { categoryId: edit.categoryId, uid, name: edit.name, price: edit.price ?? null },
      }
    }
    case 'remove_item': {
      const e = findEntry(menu.draft, edit.itemUid)
      if (!e) return { error: 'not_found', status: 404 }
      return { calls: [{ fn: 'remove_menu_item', args: { ...p, p_item_uid: edit.itemUid } }], action: 'menu.item.remove', summary: `הסיר פריט (מהקיוסק): ${e.label}`, detail: { itemUid: edit.itemUid } }
    }
    case 'add_type': {
      const e = findEntry(menu.draft, edit.itemUid)
      if (!e) return { error: 'not_found', status: 404 }
      const uid = newUid('t')
      const calls: Plan['calls'] = []
      // an item gets its first type: it becomes "a subcategory" first, exactly as the dashboard's tablet page does
      if (!e.hasTypes) calls.push({ fn: 'set_menu_item_container', args: { ...p, p_item_uid: edit.itemUid, p_is_container: true } })
      calls.push({ fn: 'add_menu_item_type', args: { ...p, p_item_uid: edit.itemUid, p_type: { uid, he: edit.name, ...(edit.price ? { priceDelta: edit.price } : {}) } } })
      return { calls, action: 'menu.item.add', summary: `הוסיף סוג (מהקיוסק): ${e.label} — ${edit.name}`, detail: { itemUid: edit.itemUid, uid, name: edit.name, price: edit.price ?? null } }
    }
    case 'remove_type': {
      const item = itemOfType(menu.draft, edit.typeUid)
      const e = item ? findEntry(menu.draft, item, edit.typeUid) : null
      if (!e) return { error: 'not_found', status: 404 }
      return { calls: [{ fn: 'remove_menu_item_type', args: { ...p, p_type_uid: edit.typeUid } }], action: 'menu.item.remove', summary: `הסיר סוג (מהקיוסק): ${e.label}`, detail: { typeUid: edit.typeUid } }
    }
    case 'update': {
      const e = findEntry(menu.draft, edit.itemUid, edit.typeUid)
      if (!e) return { error: 'not_found', status: 404 }
      const parts = [edit.name !== undefined ? `שם: ${edit.name}` : null, edit.price !== undefined ? `מחיר: ${edit.price || 'ללא'}` : null].filter(Boolean).join(', ')
      return {
        calls: [{ fn: 'menu_update_entry', args: { ...p, p_item_uid: edit.itemUid, p_type_uid: edit.typeUid, p_name: edit.name ?? null, p_price: edit.price ?? null } }],
        action: 'menu.save', summary: `עדכן (מהקיוסק): ${e.label} — ${parts}`, detail: { itemUid: edit.itemUid, typeUid: edit.typeUid, name: edit.name ?? null, price: edit.price ?? null },
      }
    }
  }
}

export async function POST(request: NextRequest) {
  const refused = authorized(request)
  if (refused) return refused
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return reply(415, { ok: false, error: 'bad_request' })
  const text = await readLimitedText(request, 2048)
  if (text === null) return reply(413, { ok: false, error: 'too_large' })
  let json: unknown
  try { json = JSON.parse(text) } catch { return reply(400, { ok: false, error: 'bad_request' }) }
  const parsed = menuEditSchema.safeParse(json)
  if (!parsed.success || isEmptyEdit(parsed.data)) return reply(400, { ok: false, error: 'bad_request' })
  const edit = parsed.data
  const slug = edit.device ?? DEFAULT_KIOSK_DEVICE

  try {
    if (!(await checkCredentialRateLimit(`kiosk-menu:${slug}`, 120, 600))) return reply(429, { ok: false, error: 'rate_limited' })
    const menu = await menuFor(slug)
    if (typeof menu === 'string') return reply(404, { ok: false, error: menu })
    const todo = plan(edit, menu)
    if ('error' in todo) return reply(todo.status, { ok: false, error: todo.error })
    if (!(await isWithinOperatingHours(menu.branchId))) return reply(403, { ok: false, error: 'closed' })

    const service = createServiceRoleClient()
    for (const call of todo.calls) {
      const { error } = await service.rpc(call.fn, call.args)
      if (error) return reply(error.code === 'PGRST202' ? 503 : 502, { ok: false, error: error.code === 'PGRST202' ? 'not_ready' : 'unavailable' })
    }
    await logMenuAudit(service, {
      actor: { display_name: `קיוסק ${slug}` }, branchId: menu.branchId, menuId: menu.id,
      action: todo.action, summary: todo.summary, detail: { ...todo.detail, published: true, source: 'kiosk', device: slug },
    })
    await broadcastMenuUpdated(menu.slug)
    const after = await menuFor(slug)
    return reply(200, { ok: true, categories: typeof after === 'string' ? null : menuTree(after.draft) })
  } catch {
    return reply(502, { ok: false, error: 'unavailable' })
  }
}
