import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, ApiError } from '@/lib/http/errors'
import { performDispatch } from '@/lib/shifts/dispatch-write'
import { parseAction } from '@/lib/shifts/schema'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { serializeAssignment, serializeShift } from '@/lib/shifts/serialize'

// The single write endpoint — one action in, performDispatch() resolves which
// branch it touches and authorizes it (requireScheduleManager()/
// requireScheduleViewer(), per-action — see dispatch-write.ts), then calls ONE
// database function that applies it atomically. The body is validated against a
// strict per-action schema (lib/shifts/schema.ts): an unknown field, a malformed
// id/date/time or an oversized list is a 400 here, before anything is read or
// written. Never returns an optimistic echo — the caller re-fetches
// /api/shifts/state after a successful dispatch.
//
// Errors come back as { error: { code, message, details } } with a plain-Hebrew
// message a screen can show as-is, and details.reason for the few screens that
// react to a specific refusal (needs_confirmation, conflict, stale).
export const POST = apiRoute(async (request: NextRequest) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError(400, 'bad_request', 'הבקשה לא תקינה. רעננו את הדף ונסו שוב.')
  }
  const action = parseAction(body)
  const data = await performDispatch(action)
  // Saving a shift used to force the browser to make a second full-state
  // request before it could close the sheet. Return the small authoritative
  // slice that changed so the board can update immediately, then reconcile
  // the rest of the state quietly in the background.
  if (action.type === 'saveShift' && typeof data.shiftId === 'string') {
    const service = createServiceRoleClient()
    const [{ data: shift }, { data: assignments }] = await Promise.all([
      service.from('shifts').select('*').eq('id', data.shiftId).maybeSingle(),
      service.from('shift_assignments').select('*').eq('shift_id', data.shiftId),
    ])
    if (shift) {
      data.shift = serializeShift(shift as Record<string, unknown>)
      data.assignments = (assignments ?? []).map((assignment) => serializeAssignment(assignment as Record<string, unknown>))
    }
  }
  return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } })
})
