import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { revalidateTag } from 'next/cache'
import { apiRoute, BadRequest } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { SETTINGS_TAG } from '@/lib/settings/keys'

const patchSchema = z.object({
  key: z.string().min(1),
  value: z.record(z.string(), z.unknown()),
})

// Every write to app_settings goes through this owner-only route (no
// client-writable RLS policy exists on the table at all) — matches
// AyekaBar's posture exactly.
export const PATCH = apiRoute(async (request: NextRequest) => {
  const staff = await requireOwner()
  const body = patchSchema.parse(await request.json())

  const service = createServiceRoleClient()
  const { error } = await service
    .from('app_settings')
    .update({ value: body.value, updated_at: new Date().toISOString(), updated_by: staff.auth_user_id })
    .eq('key', body.key)

  if (error) throw BadRequest('Could not save setting.')

  revalidateTag(SETTINGS_TAG)
  return NextResponse.json({ ok: true })
})
