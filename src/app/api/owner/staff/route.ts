import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, BadRequest } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'

// Owner-only throughout — staff management is exactly the kind of
// privileged action that must never be reachable by a general_manager's
// menu-editor session, let alone the client trusting its own UI to hide
// the button.
export const GET = apiRoute(async () => {
  await requireOwner()
  const service = createServiceRoleClient()
  const [{ data }, { data: scheduleMembers }] = await Promise.all([
    service
      .from('staff')
      .select('id, email, first_name, last_name, display_name, role, badge, branch_id, active, invited_at, claimed_at')
      .order('invited_at', { ascending: false }),
    // Read alongside the roster so StaffManager can surface a compact
    // schedulable toggle per row without a second round trip — the full
    // flag set (default role, hours cap, delegate) stays in RosterPanel.
    service.from('schedule_members').select('branch_id, staff_id, schedulable'),
  ])
  return NextResponse.json({ staff: data ?? [], scheduleMembers: scheduleMembers ?? [] })
})

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['staff', 'owner']).default('staff'),
  badge: z.string().nullable().default(null),
  branchId: z.string().uuid().nullable().default(null),
})

export const POST = apiRoute(async (request: NextRequest) => {
  await requireOwner()
  const body = inviteSchema.parse(await request.json())

  const service = createServiceRoleClient()
  const { data: existing } = await service
    .from('staff')
    .select('id')
    .ilike('email', body.email)
    .maybeSingle()
  if (existing) throw BadRequest('An invite or account already exists for this email.')

  const { data: staff, error } = await service
    .from('staff')
    .insert({ email: body.email, role: body.role, badge: body.badge, branch_id: body.branchId })
    .select()
    .single()

  if (error || !staff) throw BadRequest('Could not create invite.')
  return NextResponse.json({ staff })
})

const patchSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['staff', 'owner']).optional(),
  badge: z.string().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
})

export const PATCH = apiRoute(async (request: NextRequest) => {
  await requireOwner()
  const body = patchSchema.parse(await request.json())

  const updates: Record<string, unknown> = {}
  if (body.role) updates.role = body.role
  if (body.badge !== undefined) updates.badge = body.badge
  if (body.branchId !== undefined) updates.branch_id = body.branchId
  if (body.active !== undefined) {
    updates.active = body.active
    // Deactivation nulls auth_user_id so every access check (all of which
    // filter on auth_user_id = auth.uid()) naturally treats the person as
    // "not staff" — and a later re-invite/reactivation requires a fresh
    // claim, so a removed person's own Google sign-in can't silently
    // re-admit them (claim_staff_invite() also checks `active`).
    if (body.active === false) updates.auth_user_id = null
  }

  const service = createServiceRoleClient()
  const { error } = await service.from('staff').update(updates).eq('id', body.id)
  if (error) throw BadRequest('Could not update staff member.')

  return NextResponse.json({ ok: true })
})
