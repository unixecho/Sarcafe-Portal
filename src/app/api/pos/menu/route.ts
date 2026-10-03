import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute } from '@/lib/http/errors'
import type { MenuResponse } from '@/lib/pos/api'
import { loadPosMenu, loadPosMenuStamp } from '@/lib/pos/server/menu'
import { parseQuery, posError, posJson, rateLimit, requirePosStaff } from '@/lib/pos/server/guard'

// GET /api/pos/menu?branch=<slug|uuid>&since=<stamp>
//
// Trust model: requirePosStaff — active staff who may work this branch, with the POS on
// and a confirmed nickname. Read-only. It serves the PUBLISHED, variant-resolved menu
// only (never the draft). `since` is the stamp the device already holds: when it is
// still current the answer is `{unchanged:true}` and the document is not even read, so
// the 20-second poll every till runs costs one tiny query rather than a megabyte.

// Not .strict(): a query string routinely carries a cache-buster, and unlike a body it is never
// spread into anything — unknown keys are simply ignored.
const query = z.object({
  branch: z.string().min(1).max(80).regex(/^[A-Za-z0-9-]+$/),
  since: z.string().max(200).optional(),
})

export const GET = apiRoute(async (request: NextRequest) => {
  const { branch: branchRef, since } = parseQuery(request.nextUrl, query)
  const actor = await requirePosStaff(branchRef)
  await rateLimit('menu', actor.staff.id, 120)

  if (since) {
    const stamp = await loadPosMenuStamp(actor.branch.id)
    if (stamp !== null && stamp === since) {
      const body: MenuResponse = { unchanged: true, stamp }
      return posJson(body)
    }
  }

  const menu = await loadPosMenu(actor.branch.id)
  if (!menu) throw posError('not_found')
  const body: MenuResponse = { unchanged: false, menu }
  return posJson(body)
})
