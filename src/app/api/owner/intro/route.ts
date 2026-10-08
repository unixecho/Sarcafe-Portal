import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { revalidateTag } from 'next/cache'
import { apiRoute, BadRequest, RateLimited } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { normalizeIntroEnabled } from '@/lib/intro/config'
import { INTRO_ENABLED_KEY, DEFAULT_INTRO_ENABLED, SETTINGS_TAG } from '@/lib/settings/keys'

// The owner's on/off for the portal's opening screen (src/components/intro),
// ported from AyekaBar's intro switch. requireOwner() first, as on every owner
// route: the portal-wide settings are the owner's, not a delegated manager's.

export const GET = apiRoute(async () => {
  await requireOwner()
  const service = createServiceRoleClient()
  const { data, error } = await service.from('app_settings').select('value').eq('key', INTRO_ENABLED_KEY).maybeSingle()
  if (error) throw BadRequest('Could not load setting.')
  // No row yet means the default, ON — and a hand-edited odd value never reads as off.
  return NextResponse.json({ enabled: data ? normalizeIntroEnabled(data.value) : DEFAULT_INTRO_ENABLED })
})

const patchSchema = z.object({ enabled: z.boolean() })

export const PATCH = apiRoute(async (request: NextRequest) => {
  const staff = await requireOwner()
  // Keyed on the owner, not the IP — this is an authenticated route, and the
  // thing worth bounding is a runaway client loop, not an attacker.
  if (!(await checkRateLimit(`intro-admin:${staff.auth_user_id}`, 60, 60))) throw RateLimited()

  const body = patchSchema.parse(await request.json())
  const service = createServiceRoleClient()
  const { data, error } = await service
    .from('app_settings')
    .upsert(
      {
        key: INTRO_ENABLED_KEY,
        value: body.enabled,
        // The signed-out portal's own HTML decides whether the overlay exists, so
        // the row must be public — a private row would make the portal silently
        // ignore the owner's "off".
        is_public: true,
        updated_at: new Date().toISOString(),
        updated_by: staff.auth_user_id,
      },
      { onConflict: 'key' }
    )
    .select('value')
    .single()
  if (error) throw BadRequest('Could not save setting.')

  // Next load of any page reflects the flip.
  revalidateTag(SETTINGS_TAG)
  return NextResponse.json({ enabled: normalizeIntroEnabled(data.value) })
})
