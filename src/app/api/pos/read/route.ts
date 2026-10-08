import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { posReadQuery } from '@/lib/pos/api'
import { parseQuery, posJson, rateLimit, requirePosStaff } from '@/lib/pos/server/guard'
import { readPosData } from '@/lib/pos/server/read'

export const GET = apiRoute(async (request: NextRequest) => {
  const query = parseQuery(request.nextUrl, posReadQuery)
  const actor = await requirePosStaff(query.branch, { requireEnabled: false })
  await rateLimit('read', actor.staff.id, 180)
  return posJson({ data: await readPosData(query, actor) })
})