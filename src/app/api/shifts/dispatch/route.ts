import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, BadRequest } from '@/lib/http/errors'
import { performDispatch } from '@/lib/shifts/dispatch-write'
import type { ScheduleAction } from '@/lib/shifts/actions'

// The single write endpoint — one action in, performDispatch() resolves
// which branch it touches and authorizes it (requireScheduleManager()/
// requireScheduleViewer(), per-action — see dispatch-write.ts), then
// performs the write via an atomic RPC or a guarded table write. Body
// shape is checked loosely here (an object with a known `type`) rather
// than with a full per-variant zod schema for all fourteen action kinds —
// every case still authorizes against a REAL resource id before writing
// anything, and a malformed field beyond that fails as a Postgres
// constraint violation, not a security gap. Never returns an optimistic
// echo — the caller re-fetches /api/shifts/state after a successful
// dispatch, same as AyekaBar's own dispatch route does.
const bodySchema = z.object({ type: z.string() }).passthrough()

export const POST = apiRoute(async (request: NextRequest) => {
  const body = bodySchema.parse(await request.json())
  try {
    await performDispatch(body as unknown as ScheduleAction)
  } catch (err) {
    if (err instanceof Error && 'status' in err) throw err
    throw BadRequest('Could not perform that action.')
  }
  return NextResponse.json({ ok: true })
})
