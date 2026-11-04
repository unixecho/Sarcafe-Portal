import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, BadRequest, NotFound } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { loadOwnerDevices, isMissingTable } from '@/lib/kiosk/device'
import {
  DEVICE_SLUG_PATTERN,
  crossRuleError,
  deviceNameSchema,
  mergeStored,
  normalizeStored,
  settingsPatchSchema,
} from '@/lib/kiosk/device-settings'

// The owner's side of the kiosk tablets: which tablets exist, which branch each one belongs to, its name, whether it is
// switched on, and (the same settings the tablet's own control panel changes) its settings. Full owner only (requireOwner
// refuses quick sessions, employees and managers). A tablet's secret key is never here: it is one shared environment value.
//
//   GET     every tablet with what it last reported (battery, last seen, versions) and the branches one can be linked to
//   POST    registers a new tablet: a slug (what the tablet is told to call itself), a name and a branch
//   PATCH   changes one tablet: name, branch, on/off, and/or a settings patch

const NO_STORE = { 'Cache-Control': 'no-store' }

const createSchema = z
  .object({ slug: z.string().regex(DEVICE_SLUG_PATTERN), name: deviceNameSchema, branchId: z.string().uuid() })
  .strict()

const patchSchema = z
  .object({
    slug: z.string().regex(DEVICE_SLUG_PATTERN),
    name: deviceNameSchema.optional(),
    branchId: z.string().uuid().optional(),
    active: z.boolean().optional(),
    settings: settingsPatchSchema.optional(),
  })
  .strict()

async function assertBranch(branchId: string) {
  const { data, error } = await createServiceRoleClient().from('branches').select('id').eq('id', branchId).eq('active', true).maybeSingle()
  if (error) throw new Error('branch read failed')
  if (!data) throw BadRequest('הסניף לא נמצא או שאינו פעיל.')
}

export const GET = apiRoute(async () => {
  await requireOwner()
  return NextResponse.json(await loadOwnerDevices(), { headers: NO_STORE })
})

export const POST = apiRoute(async (request: NextRequest) => {
  const me = await requireOwner()
  const body = createSchema.parse(await request.json())
  await assertBranch(body.branchId)
  const { error } = await createServiceRoleClient()
    .from('kiosk_devices')
    .insert({ slug: body.slug, name: body.name, branch_id: body.branchId, settings_updated_by: me.id })
  if (error) {
    if (isMissingTable(error)) throw BadRequest('עדכון מסד הנתונים של הטאבלטים עדיין לא הוחל.')
    if (error.code === '23505') throw BadRequest('כבר יש טאבלט עם השם הטכני הזה.')
    throw new Error('kiosk device insert failed')
  }
  return NextResponse.json(await loadOwnerDevices(), { headers: NO_STORE })
})

export const PATCH = apiRoute(async (request: NextRequest) => {
  const me = await requireOwner()
  const body = patchSchema.parse(await request.json())
  const service = createServiceRoleClient()

  const { data: row, error: readError } = await service.from('kiosk_devices').select('id, settings').eq('slug', body.slug).maybeSingle()
  if (readError) {
    if (isMissingTable(readError)) throw BadRequest('עדכון מסד הנתונים של הטאבלטים עדיין לא הוחל.')
    throw new Error('kiosk device read failed')
  }
  if (!row) throw NotFound('הטאבלט לא נמצא.')

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) update.name = body.name
  if (body.active !== undefined) update.active = body.active
  if (body.branchId !== undefined) {
    await assertBranch(body.branchId)
    update.branch_id = body.branchId
  }
  if (body.settings !== undefined) {
    const merged = mergeStored(normalizeStored(row.settings), body.settings)
    const rule = crossRuleError(merged)
    if (rule) throw BadRequest(rule)
    update.settings = merged
    update.settings_updated_at = new Date().toISOString()
    update.settings_updated_by = me.id
  }

  const { error } = await service.from('kiosk_devices').update(update).eq('id', row.id)
  if (error) throw new Error('kiosk device update failed')
  return NextResponse.json(await loadOwnerDevices(), { headers: NO_STORE })
})
