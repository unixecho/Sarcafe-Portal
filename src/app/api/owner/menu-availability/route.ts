import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, BadRequest, NotFound } from '@/lib/http/errors'
import { requireMenuEditor } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { logMenuAudit } from '@/lib/menu/audit'
import type { MenuDoc } from '@/lib/menu/types'

// The tablet editor's write path — deliberately NOT the draft/publish
// route. It calls the set_availability() Postgres function (see migration
// 007), which flips one item's (or type's) `available` flag in BOTH draft
// and published jsonb atomically, so the public menu reflects it
// immediately instead of waiting for the next unrelated Publish.

const bodySchema = z
  .object({
    branch: z.string(),
    itemUid: z.string(),
    typeUid: z.string().nullable().default(null),
    available: z.boolean().nullable().optional(),
    quantity: z.number().int().min(0).nullable().optional(),
  })
  .refine((b) => b.available !== undefined || b.quantity !== undefined, {
    message: 'Provide at least one of available or quantity.',
  })

function findLabel(doc: MenuDoc, itemUid: string, typeUid: string | null): string {
  for (const category of doc.categories) {
    const item = category.items.find((i) => i.uid === itemUid)
    if (!item) continue
    if (!typeUid) return item.he || item.en || item.ar || 'פריט'
    const type = item.types?.find((t) => t.uid === typeUid)
    return `${item.he || 'פריט'} — ${type?.he || type?.en || 'סוג'}`
  }
  return 'פריט'
}

export const POST = apiRoute(async (request: NextRequest) => {
  const body = bodySchema.parse(await request.json())
  const service = createServiceRoleClient()

  const { data: menu } = await service
    .from('menus')
    .select('id, branch_id, draft')
    .eq('slug', body.branch)
    .maybeSingle()
  if (!menu) throw NotFound('Menu not found for this branch.')

  const staff = await requireMenuEditor(menu.branch_id)
  const label = findLabel(menu.draft as MenuDoc, body.itemUid, body.typeUid)

  const { error } = await service.rpc('set_availability', {
    p_menu_id: menu.id,
    p_item_uid: body.itemUid,
    p_type_uid: body.typeUid,
    p_available: body.available ?? null,
    p_quantity: body.quantity ?? null,
  })
  if (error) throw BadRequest('Could not update availability.')

  const summary =
    body.quantity !== undefined && body.quantity !== null
      ? `עדכן כמות (מהטאבלט): ${label} — ${body.quantity}`
      : `${body.available ? 'סימן זמין (מהטאבלט)' : 'סימן אזל מהמלאי (מהטאבלט)'}: ${label}`

  await logMenuAudit(service, {
    actor: staff,
    branchId: menu.branch_id,
    menuId: menu.id,
    action: 'menu.availability',
    summary,
    detail: { itemUid: body.itemUid, typeUid: body.typeUid, available: body.available, quantity: body.quantity },
  })

  return NextResponse.json({ ok: true })
})
