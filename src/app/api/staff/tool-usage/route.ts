import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { RateLimited } from '@/lib/http/errors'
import { parseBody } from '@/lib/pos/server/guard'
import { checkRateLimit } from '@/lib/rate-limit'
import { privateStaffRoute } from '@/lib/staff/records'
import { requireStaffIdentity } from '@/lib/staff/session'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { TOOL_IDS } from '@/lib/tools'
import { cleanQuery, MAX_USAGE_ENTRIES } from '@/lib/tools/search'
import { mergeToolUsage, readToolUsage, recordToolUse, resetToolUsage } from '@/lib/tools/usage-server'

// The tool finder's history for the signed-in person (docs/SARCAFE_GLASS_UI.md → "Tool finder"). Only ever the caller's own rows:
// the staff id comes from the session, never from the request. GET answers { synced, usage, queries }; synced:false means the
// migration is not applied yet and the browser keeps the history on the device.

const toolId = z.string().regex(/^[a-z0-9-]{1,40}$/).refine((id) => TOOL_IDS.has(id), 'unknown tool')
const usageEntry = z.object({ n: z.number().int().min(1).max(100000), t: z.number().int().min(0) }).strict()
const Body = z.discriminatedUnion('op', [
  z.object({ op: z.literal('use'), id: toolId, q: z.string().max(200).optional() }).strict(),
  z.object({ op: z.literal('merge'), usage: z.record(toolId, usageEntry).refine((u) => Object.keys(u).length <= MAX_USAGE_ENTRIES, 'too many') }).strict(),
  z.object({ op: z.literal('reset') }).strict(),
])

export const GET = privateStaffRoute(async () => {
  const me = await requireStaffIdentity()
  return NextResponse.json(await readToolUsage(createServiceRoleClient(), me.id))
})

export const POST = privateStaffRoute(async (request: NextRequest) => {
  const me = await requireStaffIdentity()
  const body = await parseBody(request, Body)
  if (!(await checkRateLimit(`tool-usage:${me.id}`, 240, 3600))) throw RateLimited()
  const service = createServiceRoleClient()
  let synced = true
  if (body.op === 'use') synced = await recordToolUse(service, me.id, body.id, cleanQuery(body.q))
  else if (body.op === 'merge') {
    const now = Date.now()
    const usage = Object.fromEntries(Object.entries(body.usage).map(([id, u]) => [id, { n: u.n, t: Math.min(u.t, now) }]))
    synced = await mergeToolUsage(service, me.id, usage)
  } else synced = await resetToolUsage(service, me.id)
  return NextResponse.json({ ok: true, synced })
})
