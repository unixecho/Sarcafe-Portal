import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute } from '@/lib/http/errors'
import { loadBootstrap } from '@/lib/pos/server/bootstrap'
import { parseQuery, posJson, rateLimit, requirePosIdentity } from '@/lib/pos/server/guard'

// GET /api/pos/bootstrap?branch=<slug|uuid>
//
// Trust model: the caller must be ACTIVE STAFF (requirePosIdentity — the same single
// identity resolution every POS route uses). The branch is a selector the loader
// validates against what this person may work; the person comes from the session,
// never from the query. Deliberately NOT gated on a confirmed nickname or on the POS
// being switched on: the response REPORTS both (`me.handleConfirmed`, `enabled`) so the
// app can show the nickname sheet or a friendly "not open yet" instead of an error.
// Read-only; the answer is never cacheable (it names staff and live tickets' state).

// Not .strict(): a query string routinely carries a cache-buster or tracking param, and unlike
// a body it is never spread into anything — unknown keys are simply ignored.
const query = z.object({ branch: z.string().min(1).max(80).regex(/^[A-Za-z0-9-]+$/).optional() })

export const GET = apiRoute(async (request: NextRequest) => {
  const me = await requirePosIdentity()
  const { branch } = parseQuery(request.nextUrl, query)
  await rateLimit('bootstrap', me.id, 60)

  const bootstrap = await loadBootstrap({ staffId: me.id, staff: me, branchRef: branch })
  return posJson(bootstrap)
})
