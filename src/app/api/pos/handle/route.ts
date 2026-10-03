import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { handleBody, type HandleResponse } from '@/lib/pos/api'
import { handleProblem } from '@/lib/pos/validate'
import {
  callPosRpc, parseBody, posError, posJson, rateLimit, requirePosIdentity, rpcFailure,
} from '@/lib/pos/server/guard'
import { LIMITS, RATE } from '@/lib/pos/vocab'

// POST /api/pos/handle — a person confirms (or changes) THEIR OWN nickname.
//
// Trust model. This is the one POS route that cannot require a confirmed nickname (it
// is how you get one) and has no branch (a nickname belongs to the person, not to an
// event), so it starts from the bare identity guard instead of requirePosStaff — the
// same single identity resolution, minus the branch checks. SELF ONLY: the RPC is called
// with the signed-in person as both actor and target, and the body has no field that
// could name anybody else. (A manager renaming someone else is a different, owner-side
// route.) The nickname is what every screen shows instead of an email, so it is
// validated twice — here, to give the person a precise hint, and by the database, which
// is the real authority and also owns case-insensitive uniqueness.

// What to tell the person, in their words, for each way a nickname can be unusable.
const HANDLE_WORDS = {
  too_short: { he: `הכינוי קצר מדי, צריך לפחות ${LIMITS.handleMin} תווים`, en: `That nickname is too short, use at least ${LIMITS.handleMin} characters` },
  too_long: { he: `הכינוי ארוך מדי, עד ${LIMITS.handleMax} תווים`, en: `That nickname is too long, up to ${LIMITS.handleMax} characters` },
  bad_chars: { he: 'אפשר להשתמש רק באותיות, ספרות, נקודה, מקף וקו תחתון', en: 'Use only letters, digits, dots, dashes and underscores' },
} as const

export const POST = apiRoute(async (request: NextRequest) => {
  const me = await requirePosIdentity()
  const body = await parseBody(request, handleBody)
  await rateLimit('handle', me.id, RATE.handlePerHour, 3600)

  const handle = body.handle.trim()
  const problem = handleProblem(handle)
  if (problem) throw posError('bad_request', { reason: problem }, HANDLE_WORDS[problem])

  const result = await callPosRpc<{ ok: boolean; reason?: string; handle?: string }>('pos_set_handle', {
    p_actor: me.id,
    p_target: me.id,
    p_handle: handle,
  })

  if (!result.ok) {
    if (result.reason === 'taken') {
      throw posError('conflict', { reason: 'taken' }, { he: 'הכינוי הזה כבר תפוס, נסו אחר', en: 'That nickname is taken, try another' })
    }
    if (result.reason === 'invalid') throw posError('bad_request', { reason: 'bad_chars' }, HANDLE_WORDS.bad_chars)
    throw rpcFailure(result.reason)
  }

  const response: HandleResponse = { ok: true, handle: result.handle ?? handle }
  return posJson(response)
})
