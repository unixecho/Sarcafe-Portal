import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { branchQuery, sessionBody } from '@/lib/pos/owner-api'
import { parseBody, parseQuery, posJson, rateLimit, requirePosManager } from '@/lib/pos/server/guard'
import { readSessionsPayload, runSessionAction } from '@/lib/pos/server/settings'
import { createServiceRoleClient } from '@/lib/supabase/server'

// The event's open / closed state. Manager-only.
//   GET   the open session, the latest ten, and how much practice data is waiting
//   POST  { action }  open | open_training | close | close_void_uncollected | wipe_training
//
// Every action is one database function that checks + writes + audits in a single
// transaction. "Close" is refused while items are still being prepared and while ready
// orders sit uncollected; those come back as 409 with the counts, because the screen
// offers a way forward ("cancel the uncollected ones and close"). Wiping practice data is
// the one hard delete in the system and the database itself refuses anything that is
// not a practice session.

export const GET = apiRoute(async (request: NextRequest) => {
  const q = parseQuery(new URL(request.url), branchQuery)
  const actor = await requirePosManager(q.branch)
  return posJson(await readSessionsPayload(createServiceRoleClient(), actor.branch.id))
})

export const POST = apiRoute(async (request: NextRequest) => {
  const body = await parseBody(request, sessionBody)
  const actor = await requirePosManager(body.branch)
  await rateLimit('owner-session', actor.staff.id, 30)
  const result = await runSessionAction(actor.staff.id, actor.branch.id, body.action)
  return posJson(result, result.ok ? 200 : 409)
})
