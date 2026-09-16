import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, BadRequest, NotFound } from '@/lib/http/errors'
import { requireMenuEditor } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { allItemUids } from '@/lib/menu/variants'
import { logMenuAudit } from '@/lib/menu/audit'
import type { MenuDoc } from '@/lib/menu/types'

function variantLabel(name: unknown): string {
  const n = name as { he?: string; en?: string } | null | undefined
  return n?.he || n?.en || 'ללא שם'
}

const MAX_TEMP_DAYS = 30

async function resolveMenu(branchSlug: string | null) {
  if (!branchSlug) throw BadRequest('Unknown or missing branch.')
  const service = createServiceRoleClient()
  const { data: menu } = await service
    .from('menus')
    .select('id, branch_id, draft, active_variant_id')
    .eq('slug', branchSlug)
    .maybeSingle()
  if (!menu) throw NotFound('Menu not found for this branch.')
  return menu
}

export const GET = apiRoute(async (request: NextRequest) => {
  const branchSlug = request.nextUrl.searchParams.get('branch')
  const menu = await resolveMenu(branchSlug)
  await requireMenuEditor(menu.branch_id)

  const service = createServiceRoleClient()
  await service.rpc('reap_expired_variants') // opportunistic housekeeping, never required for correctness

  const { data: variants } = await service
    .from('menu_variants')
    .select('*')
    .eq('menu_id', menu.id)
    .order('sort_order', { ascending: true })

  return NextResponse.json({
    menuId: menu.id,
    activeVariantId: menu.active_variant_id,
    draft: menu.draft as MenuDoc,
    variants: variants ?? [],
  })
})

const createSchema = z.object({
  branch: z.string(),
  name: z.object({ he: z.string().optional(), en: z.string().optional(), ar: z.string().optional() }),
  excludedUids: z.array(z.string()).default([]),
  scheduleEnabled: z.boolean().default(false),
  scheduleDays: z.array(z.number().int().min(0).max(6)).default([]),
  scheduleStart: z.string().nullable().default(null),
  scheduleEnd: z.string().nullable().default(null),
  activateNow: z.boolean().default(false),
  tempUntil: z.string().datetime().nullable().default(null),
  expireAction: z.enum(['revert', 'delete']).default('revert'),
})

export const POST = apiRoute(async (request: NextRequest) => {
  const body = createSchema.parse(await request.json())
  const menu = await resolveMenu(body.branch)
  const staff = await requireMenuEditor(menu.branch_id)

  const allUids = new Set(allItemUids(menu.draft as MenuDoc))
  if (body.excludedUids.some((uid) => !allUids.has(uid))) {
    throw BadRequest('excludedUids contains an item that does not exist on this menu.')
  }
  if (body.excludedUids.length >= allUids.size) {
    throw BadRequest('A variant must leave at least one item visible.')
  }
  if (body.tempUntil) {
    const days = (new Date(body.tempUntil).getTime() - Date.now()) / 86_400_000
    if (days <= 0 || days > MAX_TEMP_DAYS) throw BadRequest(`Temporary deadline must be within ${MAX_TEMP_DAYS} days.`)
  }

  const service = createServiceRoleClient()
  const { data: variant, error } = await service
    .from('menu_variants')
    .insert({
      menu_id: menu.id,
      name: body.name,
      excluded_uids: body.excludedUids,
      schedule_enabled: body.scheduleEnabled,
      schedule_days: body.scheduleDays,
      schedule_start: body.scheduleStart,
      schedule_end: body.scheduleEnd,
      active_until: body.tempUntil,
      expire_action: body.expireAction,
    })
    .select()
    .single()

  if (error || !variant) throw BadRequest('Could not create variant.')

  if (body.activateNow) {
    await service.from('menus').update({ active_variant_id: variant.id }).eq('id', menu.id)
  }

  await logMenuAudit(service, {
    actor: staff,
    branchId: menu.branch_id,
    menuId: menu.id,
    action: 'variant.create',
    summary: `יצר גרסת תפריט: ${variantLabel(body.name)}${body.activateNow ? ' (והפעיל אותה)' : ''}`,
    detail: { variantId: variant.id, excludedCount: body.excludedUids.length },
  })

  return NextResponse.json({ variant })
})

const patchSchema = z.object({
  branch: z.string(),
  variantId: z.string().uuid(),
  name: z.object({ he: z.string().optional(), en: z.string().optional(), ar: z.string().optional() }).optional(),
  excludedUids: z.array(z.string()).optional(),
  scheduleEnabled: z.boolean().optional(),
  scheduleDays: z.array(z.number().int().min(0).max(6)).optional(),
  scheduleStart: z.string().nullable().optional(),
  scheduleEnd: z.string().nullable().optional(),
  tempUntil: z.string().datetime().nullable().optional(),
  expireAction: z.enum(['revert', 'delete']).optional(),
  activate: z.boolean().optional(),
  makeDefault: z.boolean().optional(),
})

export const PATCH = apiRoute(async (request: NextRequest) => {
  const body = patchSchema.parse(await request.json())
  const menu = await resolveMenu(body.branch)
  const staff = await requireMenuEditor(menu.branch_id)

  const service = createServiceRoleClient()

  const { data: existing } = await service
    .from('menu_variants')
    .select('id, menu_id, is_default, name')
    .eq('id', body.variantId)
    .eq('menu_id', menu.id)
    .maybeSingle()
  if (!existing) throw NotFound('Variant not found.')

  const updates: Record<string, unknown> = {}
  if (body.name) updates.name = body.name
  if (body.excludedUids) updates.excluded_uids = body.excludedUids
  if (body.scheduleEnabled !== undefined) updates.schedule_enabled = body.scheduleEnabled
  if (body.scheduleDays) updates.schedule_days = body.scheduleDays
  if (body.scheduleStart !== undefined) updates.schedule_start = body.scheduleStart
  if (body.scheduleEnd !== undefined) updates.schedule_end = body.scheduleEnd
  if (body.tempUntil !== undefined) updates.active_until = body.tempUntil
  if (body.expireAction) updates.expire_action = body.expireAction

  const label = variantLabel(body.name ?? existing.name)

  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString()
    await service.from('menu_variants').update(updates).eq('id', body.variantId)
    await logMenuAudit(service, {
      actor: staff,
      branchId: menu.branch_id,
      menuId: menu.id,
      action: 'variant.update',
      summary: `עדכן גרסת תפריט: ${label}`,
      detail: { variantId: body.variantId, fields: Object.keys(updates).filter((k) => k !== 'updated_at') },
    })
  }

  if (body.makeDefault) {
    await service.rpc('set_default_variant', { p_variant_id: body.variantId })
    await logMenuAudit(service, {
      actor: staff,
      branchId: menu.branch_id,
      menuId: menu.id,
      action: 'variant.update',
      summary: `קבע כברירת מחדל: ${label}`,
      detail: { variantId: body.variantId },
    })
  }
  if (body.activate) {
    await service.from('menus').update({ active_variant_id: body.variantId }).eq('id', menu.id)
    await logMenuAudit(service, {
      actor: staff,
      branchId: menu.branch_id,
      menuId: menu.id,
      action: 'variant.activate',
      summary: `הפעיל את הגרסה: ${label}`,
      detail: { variantId: body.variantId },
    })
  }

  return NextResponse.json({ ok: true })
})

const deleteSchema = z.object({ branch: z.string(), variantId: z.string().uuid() })

export const DELETE = apiRoute(async (request: NextRequest) => {
  const body = deleteSchema.parse(await request.json())
  const menu = await resolveMenu(body.branch)
  const staff = await requireMenuEditor(menu.branch_id)

  const service = createServiceRoleClient()
  const { data: variant } = await service
    .from('menu_variants')
    .select('id, is_default, name')
    .eq('id', body.variantId)
    .eq('menu_id', menu.id)
    .maybeSingle()
  if (!variant) throw NotFound('Variant not found.')
  if (variant.is_default) throw BadRequest('Cannot delete the default variant.')

  // If deleting the currently-live variant, fall back to default first.
  if (menu.active_variant_id === body.variantId) {
    const { data: fallback } = await service
      .from('menu_variants')
      .select('id')
      .eq('menu_id', menu.id)
      .eq('is_default', true)
      .maybeSingle()
    if (fallback) await service.from('menus').update({ active_variant_id: fallback.id }).eq('id', menu.id)
  }

  await service.from('menu_variants').delete().eq('id', body.variantId)

  await logMenuAudit(service, {
    actor: staff,
    branchId: menu.branch_id,
    menuId: menu.id,
    action: 'variant.delete',
    summary: `מחק גרסת תפריט: ${variantLabel(variant.name)}`,
    detail: { variantId: body.variantId },
  })

  return NextResponse.json({ ok: true })
})
