import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute } from '@/lib/http/errors'
import { callPosRpc, parseBody, posError, posJson, rateLimit, requirePosIdentity, rpcFailure } from '@/lib/pos/server/guard'

// POST /api/pos/passcode — the person's OWN quick-login code: set or change.
// DELETE                 — remove it.
//
// Trust model. SELF ONLY: the signed-in person is both actor and target of the RPC and
// the body names nobody else (the owner's route is /api/owner/staff/passcode). It needs
// a FULL (Google) session, never a quick one: a stolen tablet session must not be able
// to change the code (locking the real owner of it out) or make itself permanent.
// No branch and no confirmed nickname are needed — a person must be able to set a code
// regardless — so it starts from the bare identity guard, like /api/pos/handle.
// The passcode is never logged or returned; the database keeps only a bcrypt hash and
// ends the person's quick sessions when it changes.

const setBody = z.object({ passcode: z.string().regex(/^\d{6}$/) }).strict()
const clearBody = z.object({}).strict()

const WEAK = { he: 'הקוד קל מדי, בחרו אחר', en: 'That code is too easy to guess, choose another' }
const NEEDS_GOOGLE = {
  he: 'את הקוד אפשר לשנות רק אחרי כניסה עם חשבון Google',
  en: 'The code can only be changed after signing in with Google',
}

async function fullSession() {
  const me = await requirePosIdentity()
  if (me.quick) throw posError('forbidden', { reason: 'quick_session' }, NEEDS_GOOGLE)
  return me
}

export const POST = apiRoute(async (request: NextRequest) => {
  const me = await fullSession()
  const { passcode } = await parseBody(request, setBody)
  await rateLimit('passcode', me.id, 10, 3600)

  const result = await callPosRpc<{ ok: boolean; reason?: string }>('pos_set_pin', { p_actor: me.id, p_target: me.id, p_pin: passcode })
  if (!result.ok) {
    if (result.reason === 'weak') throw posError('bad_request', { reason: 'weak' }, WEAK)
    if (result.reason === 'invalid') throw posError('bad_request', { reason: 'invalid' })
    throw rpcFailure(result.reason)
  }
  return posJson({ ok: true })
})

export const DELETE = apiRoute(async (request: NextRequest) => {
  const me = await fullSession()
  await parseBody(request, clearBody)
  await rateLimit('passcode', me.id, 10, 3600)

  const result = await callPosRpc<{ ok: boolean; reason?: string }>('pos_clear_pin', { p_actor: me.id, p_target: me.id })
  if (!result.ok) throw rpcFailure(result.reason)
  return posJson({ ok: true })
})
