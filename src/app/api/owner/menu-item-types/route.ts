import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, BadRequest } from '@/lib/http/errors'
import { logMenuAudit } from '@/lib/menu/audit'
import { broadcastMenuUpdated } from '@/lib/menu/realtime'
import { resolveTabletWrite } from '@/lib/menu/tablet-write'

// One level deeper than /api/owner/menu-items: adds/removes a type
// (add_menu_item_type/remove_menu_item_type — migration 016) under an item
// the tablet has turned into a subcategory (PATCH /api/owner/menu-items).
// Same live, operating-hours-gated, name-and-optional-price posture as
// every other tablet write.

const addSchema = z.object({
  branch: z.string(),
  itemUid: z.string(),
  uid: z.string(),
  name: z.string().trim().min(1).max(80),
  priceDelta: z.string().trim().max(20).optional(),
})

export const POST = apiRoute(async (request: NextRequest) => {
  const body = addSchema.parse(await request.json())
  const { service, menuId, branchId, draft, staff, publish } = await resolveTabletWrite(body.branch)

  const item = draft.categories.flatMap((c) => c.items).find((i) => i.uid === body.itemUid)
  if (!item) throw BadRequest('Item not found on this menu.')

  const type = { uid: body.uid, he: body.name, ...(body.priceDelta ? { priceDelta: body.priceDelta } : {}) }

  const { error } = await service.rpc('add_menu_item_type', {
    p_menu_id: menuId,
    p_item_uid: body.itemUid,
    p_type: type,
    p_publish: publish,
  })
  if (error) throw BadRequest('Could not add item.')

  const summaryBase = `הוסיף פריט (מהטאבלט): ${item.he || 'פריט'} — ${body.name}`
  await logMenuAudit(service, {
    actor: staff,
    branchId,
    menuId,
    action: 'menu.item.add',
    summary: publish ? summaryBase : `${summaryBase} (מחוץ לשעות הפעילות — לא פורסם ללקוחות)`,
    detail: { itemUid: body.itemUid, uid: body.uid, name: body.name, priceDelta: body.priceDelta ?? null, published: publish },
  })

  if (publish) await broadcastMenuUpdated(body.branch)

  return NextResponse.json({ ok: true, published: publish })
})

const deleteSchema = z.object({ branch: z.string(), typeUid: z.string() })

export const DELETE = apiRoute(async (request: NextRequest) => {
  const body = deleteSchema.parse(await request.json())
  const { service, menuId, branchId, draft, staff, publish } = await resolveTabletWrite(body.branch)

  const label =
    draft.categories
      .flatMap((c) => c.items)
      .flatMap((i) => i.types ?? [])
      .find((t) => t.uid === body.typeUid)?.he ?? 'פריט'

  const { error } = await service.rpc('remove_menu_item_type', {
    p_menu_id: menuId,
    p_type_uid: body.typeUid,
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
    detail: { typeUid: body.typeUid, name: label, published: publish },
  })

  if (publish) await broadcastMenuUpdated(body.branch)

  return NextResponse.json({ ok: true, published: publish })
})
