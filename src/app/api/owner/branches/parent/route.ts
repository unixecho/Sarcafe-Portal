import { NextResponse } from 'next/server'
import { z } from 'zod'
import { apiRoute, ApiError, NotFound } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  eventId: z.string().uuid(),
  // null detaches the event from its truck
  parentId: z.string().uuid().nullable(),
}).strict()

// The owner assigns an event (a stall the POS trades at) to a coffee truck, or detaches it. The POS is a subsystem of a branch:
// this is how an event that was made on its own (or before trucks owned events) finds its truck. All the rules (an event, a
// truck, active) are in the database function; owner-only here and again there.
export const POST = apiRoute(async (request: Request) => {
  const owner = await requireOwner()
  const body = bodySchema.parse(await request.json())
  const { data, error } = await createServiceRoleClient().rpc('branch_set_parent', { p_actor: owner.id, p_event: body.eventId, p_parent: body.parentId })
  if (error) {
    console.error('branch_set_parent failed:', error.code, String(error.message ?? '').slice(0, 160))
    throw new ApiError(500, 'internal_error', 'לא הצלחנו לשייך את האירוע. נסו שוב.')
  }
  const result = data as { ok?: boolean; reason?: string } | null
  if (!result?.ok) {
    if (result?.reason === 'not_found') throw NotFound('האירוע לא נמצא.')
    throw new ApiError(result?.reason === 'forbidden' ? 403 : 400, result?.reason === 'forbidden' ? 'forbidden' : 'bad_request', 'אפשר לשייך אירוע רק לסניף קבוע.')
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
})
