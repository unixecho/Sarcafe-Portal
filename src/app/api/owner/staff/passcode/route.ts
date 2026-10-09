import { randomInt } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, ApiError, BadRequest } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { callPosRpc, parseBody, posJson, rpcFailure } from '@/lib/pos/server/guard'

// POST /api/owner/staff/passcode — the owner issues, clears, or renumbers somebody's
// quick-login code (blueprint §1a.5).
//
// OWNER ONLY, and requireOwner() already refuses a quick session. 'generate' draws a
// random non-weak six-digit code, stores only its bcrypt hash (pos_set_pin) and returns
// the code EXACTLY ONCE in this response — it is never stored, logged or retrievable
// again; losing it means issuing a new one. The response is no-store. Setting or
// clearing a code ends that person's quick sessions (the SQL does it).

const body = z
  .object({
    staffId: z.string().uuid(),
    action: z.enum(['generate', 'set', 'clear']).optional(),
    passcode: z.string().regex(/^\d{6}$/).optional(),
    employeeNo: z.string().regex(/^(?=.*[1-9])\d{1,5}$/).optional(),
  })
  .strict()

const MAX_DRAWS = 5

const draw = () => String(randomInt(0, 1_000_000)).padStart(6, '0')

export const POST = apiRoute(async (request: NextRequest) => {
  const owner = await requireOwner()
  const { staffId, action, employeeNo, passcode: requestedPasscode } = await parseBody(request, body)
  if (!action && employeeNo === undefined) throw BadRequest('חסר מה לעשות / Nothing to do.')

  let employeeNoSet: string | undefined
  if (employeeNo !== undefined) {
    const res = await callPosRpc<{ ok: boolean; reason?: string; employee_no?: string }>('pos_set_employee_code', {
      p_actor: owner.id,
      p_target: staffId,
      p_code: employeeNo,
    })
    if (!res.ok) {
      if (res.reason === 'taken') throw new ApiError(409, 'conflict', 'מספר העובד הזה כבר תפוס / That number is taken', { reason: 'taken' })
      if (res.reason === 'invalid') throw new ApiError(400, 'bad_request', 'מספר עובד חייב להכיל 1–5 ספרות / Invalid number', { reason: 'invalid' })
      throw rpcFailure(res.reason)
    }
    employeeNoSet = res.employee_no ?? employeeNo
  }

  if (action === 'clear') {
    const res = await callPosRpc<{ ok: boolean; reason?: string }>('pos_clear_pin', { p_actor: owner.id, p_target: staffId })
    if (!res.ok) throw rpcFailure(res.reason)
    return posJson({ ok: true, ...(employeeNoSet !== undefined ? { employeeNo: employeeNoSet } : {}) })
  }

  if (action === 'generate') {
    let passcode: string | null = null
    for (let i = 0; i < MAX_DRAWS && passcode === null; i++) {
      const candidate = draw()
      const res = await callPosRpc<{ ok: boolean; reason?: string }>('pos_set_pin', { p_actor: owner.id, p_target: staffId, p_pin: candidate })
      if (res.ok) passcode = candidate
      else if (res.reason !== 'weak') throw rpcFailure(res.reason)
    }
    if (passcode === null) throw new ApiError(500, 'internal_error', 'לא הצלחנו להפיק קוד, נסו שוב / Could not issue a code, try again')

    return posJson({ ok: true, passcode, ...(employeeNoSet !== undefined ? { employeeNo: employeeNoSet } : {}) })
  }

  if (action === 'set') {
    if (!requestedPasscode) throw BadRequest('הזינו קוד בן 6 ספרות.')
    const res = await callPosRpc<{ ok: boolean; reason?: string }>('pos_set_pin', {
      p_actor: owner.id,
      p_target: staffId,
      p_pin: requestedPasscode,
    })
    if (!res.ok) {
      if (res.reason === 'weak') throw new ApiError(400, 'bad_request', 'הקוד קל מדי לניחוש. בחרו 6 ספרות אחרות.', { reason: 'weak' })
      throw rpcFailure(res.reason)
    }
    return posJson({ ok: true, ...(employeeNoSet !== undefined ? { employeeNo: employeeNoSet } : {}) })
  }

  return posJson({ ok: true, employeeNo: employeeNoSet })
})
