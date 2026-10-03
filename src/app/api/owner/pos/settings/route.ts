import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { branchQuery, settingsPatchBody } from '@/lib/pos/owner-api'
import { parseBody, parseQuery, posJson, rateLimit, requirePosManager } from '@/lib/pos/server/guard'
import { readSettings, updateSettings } from '@/lib/pos/server/settings'
import { createServiceRoleClient } from '@/lib/supabase/server'

// The register's switches. Manager-only.
//   GET    on/off, the Ready-board link, the items not sold at this event
//   PATCH  { enabled?, rotateBoardToken?, unsold? }
//
// SECRET: the board link's token is the only credential the public Ready board has.
// It leaves the server in exactly two places, this GET and the PATCH response (a rotate
// has to show the new link), both behind the manager guard and both no-store. It is
// minted with 256 bits of randomness, never logged, and never written into an audit
// event (the database records only THAT it was rotated). Switching the register OFF is
// refused while an event is open.

export const GET = apiRoute(async (request: NextRequest) => {
  const q = parseQuery(new URL(request.url), branchQuery)
  const actor = await requirePosManager(q.branch)
  return posJson(await readSettings(createServiceRoleClient(), actor.branch.id))
})

export const PATCH = apiRoute(async (request: NextRequest) => {
  const body = await parseBody(request, settingsPatchBody)
  const actor = await requirePosManager(body.branch)
  await rateLimit('owner-settings', actor.staff.id, 30)
  const result = await updateSettings(createServiceRoleClient(), actor.staff.id, actor.branch.id, {
    enabled: body.enabled,
    rotateBoardToken: body.rotateBoardToken,
    unsold: body.unsold,
  })
  return posJson(result, 'ok' in result && result.ok === false ? 409 : 200)
})
