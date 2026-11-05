import { after, NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, ApiError, BadRequest } from '@/lib/http/errors'
import { parseBody } from '@/lib/pos/server/guard'
import { flushStaffPush } from '@/lib/push/staff'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { cleanMessage, MAX_TEXT } from '@/lib/team-message/rules'
import { loadMessagePlan, messengerFor, sendTeamMessage } from '@/lib/team-message/server'

// The team message (docs/SARCAFE_TEAM_MESSAGE.md).
//   GET  ?branch=<slug>  → the composer's plan: the branch team's size and reach, and the next 7 days of published shifts.
//   POST { branch, audience: 'all' | 'shift', shiftId?, assignmentId?, text, requestId } → sends; answers { sent, skipped, names }.
// Owner anywhere, a general manager only their own branch, Google sign-in only (who is asking is checked before the branch is looked up). Same-origin JSON only
// (parseBody), strict schema, nothing private cached.

const headers = { 'Cache-Control': 'private, no-store' }

export const GET = apiRoute(async (request: NextRequest) => {
  const slug = request.nextUrl.searchParams.get('branch') ?? ''
  const service = createServiceRoleClient()
  const { me, branch, today } = await messengerFor(service, slug)
  return NextResponse.json(await loadMessagePlan(service, me, branch, today), { headers })
})

const Body = z.object({
  branch: z.string().min(1).max(40),
  audience: z.enum(['all', 'shift']),
  shiftId: z.string().uuid().optional(),
  assignmentId: z.string().uuid().optional(),
  text: z.string().max(4 * MAX_TEXT),
  requestId: z.string().uuid(),
}).strict().superRefine((body, ctx) => {
  if (body.audience === 'all' && (body.shiftId || body.assignmentId)) ctx.addIssue({ code: 'custom', path: ['audience'], message: 'all takes no shift' })
  if (body.audience === 'shift' && !body.shiftId) ctx.addIssue({ code: 'custom', path: ['shiftId'], message: 'shift required' })
})

export const POST = apiRoute(async (request: NextRequest) => {
  const body = await parseBody(request, Body)
  const text = cleanMessage(body.text)
  if (!text) throw body.text.trim().length > MAX_TEXT ? new ApiError(400, 'too_long', `ההודעה ארוכה מדי (עד ${MAX_TEXT} תווים)`) : BadRequest('כתבו הודעה לפני השליחה')
  const service = createServiceRoleClient()
  const { me, branch, today } = await messengerFor(service, body.branch)
  const result = await sendTeamMessage(service, me, branch, today, { audience: body.audience, shiftId: body.shiftId, assignmentId: body.assignmentId, text, requestId: body.requestId })
  // The rows are in everyone's inbox; push them to the phones now. after(): a serverless function can be frozen once it answers.
  after(async () => { await flushStaffPush() })
  return NextResponse.json({ ok: true, ...result }, { headers })
})
