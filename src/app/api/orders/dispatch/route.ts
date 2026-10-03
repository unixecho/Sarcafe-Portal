import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, BadRequest } from '@/lib/http/errors'
import { performOrderDispatch } from '@/lib/orders/dispatch-write'
import type { OrderAction } from '@/lib/orders/actions'

// The single write endpoint — one action in, performOrderDispatch()
// resolves which branch it touches and authorizes it (requireOrderStaff()/
// requireOrderManager(), per-action), then performs the write via an
// atomic RPC. Mirrors /api/shifts/dispatch's loose body shape: a known
// `type`, everything else validated against a REAL resource inside
// dispatch-write.ts rather than a full per-variant zod schema here.
const bodySchema = z.object({ type: z.string() }).passthrough()

export const POST = apiRoute(async (request: NextRequest) => {
  const body = bodySchema.parse(await request.json())
  let result
  try {
    result = await performOrderDispatch(body as unknown as OrderAction)
  } catch (err) {
    if (err instanceof Error && 'status' in err) throw err
    throw BadRequest('Could not perform that action.')
  }
  return NextResponse.json({ ok: true, ...result })
})
