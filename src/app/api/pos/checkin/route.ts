import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { checkinBody, type CheckinResponse } from '@/lib/pos/api'
import { callPosRpc, parseBody, posJson, rateLimit, requirePosStaffForPoint, rpcFailure } from '@/lib/pos/server/guard'

// POST /api/pos/checkin — "I'm working this selling point" / "I've left it".
//
// Trust model. The body names a selling point, not a branch, so the branch is whatever
// that point belongs to (requirePosStaffForPoint looks it up only AFTER the caller is
// known to be active staff, then applies the normal branch / switched-on / nickname
// checks to it). The person checking in is always the signed-in person — a check-in is
// a statement about oneself and there is no field to name anybody else. Presence is
// information for the manager's dashboard and the audit log; it is not a permission,
// so checking in grants nothing and not checking in blocks nothing.

const CHECKINS_PER_MIN = 30 // a person flips between points a few times a shift, not a few times a second

export const POST = apiRoute(async (request: NextRequest) => {
  const body = await parseBody(request, checkinBody)
  const actor = await requirePosStaffForPoint(body.pointId)
  await rateLimit('checkin', actor.staff.id, CHECKINS_PER_MIN)

  const result = await callPosRpc<{ ok: boolean; reason?: string }>('pos_checkin', {
    p_staff: actor.staff.id,
    p_point: actor.point.id,
    p_event: body.event,
  })
  if (!result.ok) throw rpcFailure(result.reason)

  const response: CheckinResponse = { ok: true }
  return posJson(response)
})
