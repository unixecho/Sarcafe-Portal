import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, BadRequest } from '@/lib/http/errors'
import { logMenuAudit } from '@/lib/menu/audit'
import { broadcastMenuUpdated } from '@/lib/menu/realtime'
import { resolveTabletWrite } from '@/lib/menu/tablet-write'

// The tablet's item CRUD path (add_menu_item/remove_menu_item — migration
// 015) — same live, operating-hours-gated posture as
// /api/owner/menu-availability, just for adding/removing an item instead
// of toggling one that already exists. Deliberately minimal: a name and an
// optional price, nothing else (translations/notes/images/reordering stay
// in the full desktop editor) — this is meant to be typed in a hurry
// between transactions, not a second menu editor.

const addSchema = z.object({
  branch: z.string(),
  categoryId: z.string(),
  uid: z.string(),
  name: z.string().trim().min(1).max(80),
  price: z.string().trim().max(20).optional(),
})

export const POST = apiRoute(async (request: NextRequest) => {
  const body = addSchema.parse(await request.json())
  const { service, menuId, branchId, draft, staff, publish } = await resolveTabletWrite(body.branch)

  const category = draft.categories.find((c) => c.id === body.categoryId)
  if (!category) throw BadRequest('Category not found on this menu.')

  const item = { uid: body.uid, he: body.name, ...(body.price ? { price: body.price } : {}) }

  const { error } = await service.rpc('add_menu_item', {
    p_menu_id: menuId,
    p_category_id: body.categoryId,
    p_item: item,
    p_publish: publish,
  })
  if (error) throw BadRequest('Could not add item.')

  const summaryBase = `הוסיף פריט (מהטאבלט): ${body.name}`
  await logMenuAudit(service, {
    actor: staff,
    branchId,
    menuId,
    action: 'menu.item.add',
    summary: publish ? summaryBase : `${summaryBase} (מחוץ לשעות הפעילות — לא פורסם ללקוחות)`,
    detail: { categoryId: body.categoryId, uid: body.uid, name: body.name, price: body.price ?? null, published: publish },
  })

  if (publish) await broadcastMenuUpdated(body.branch)

  return NextResponse.json({ ok: true, published: publish })
})

const deleteSchema = z.object({ branch: z.string(), itemUid: z.string() })

export const DELETE = apiRoute(async (request: NextRequest) => {
  const body = deleteSchema.parse(await request.json())
  const { service, menuId, branchId, draft, staff, publish } = await resolveTabletWrite(body.branch)

  const label = draft.categories.flatMap((c) => c.items).find((i) => i.uid === body.itemUid)?.he ?? 'פריט'

  const { error } = await service.rpc('remove_menu_item', {
    p_menu_id: menuId,
    p_item_uid: body.itemUid,
    p_publish: publish,
  })
  if (error) throw BadRequest('Could not remove item.')

  const summaryBase = `הסיר פריט (מהטאבלט): ${label}`
  await logMenuAudit(service, {
    actor: staff,
    branchId,
    menuId,
    action: 'menu.item.remove',
    summary: publish ? summaryBase : `${summaryBase} (מחוץ לשעות הפעילות — לא פורסם ללקוחות)`,
    detail: { itemUid: body.itemUid, name: label, published: publish },
  })

  if (publish) await broadcastMenuUpdated(body.branch)

  return NextResponse.json({ ok: true, published: publish })
})
