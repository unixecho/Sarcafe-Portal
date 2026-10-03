import type { NextRequest } from 'next/server'
import { apiRoute } from '@/lib/http/errors'
import { exportQuery } from '@/lib/pos/owner-api'
import { parseQuery, rateLimit, requirePosManager } from '@/lib/pos/server/guard'
import { buildCsv } from '@/lib/pos/server/export'
import { createServiceRoleClient } from '@/lib/supabase/server'

// GET /api/owner/pos/export — one row per order line as a CSV file. Manager-only and
// rate-limited (it reads a whole event). No phone column, by design; see export.ts.

export const GET = apiRoute(async (request: NextRequest) => {
  const q = parseQuery(new URL(request.url), exportQuery)
  const actor = await requirePosManager(q.branch)
  await rateLimit('owner-export', actor.staff.id, 6)
  const { csv, filename } = await buildCsv(createServiceRoleClient(), actor.branch, q)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
