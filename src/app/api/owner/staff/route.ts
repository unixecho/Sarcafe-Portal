import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, ApiError, BadRequest } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { OWNER_MESSAGES, type Bilingual } from '@/lib/pos/owner-api'
import { callPosRpc } from '@/lib/pos/server/guard'
import { handleProblem, normalizePhone } from '@/lib/pos/validate'
import { refusal } from '@/lib/shifts/dispatch-write'
import { staffDisplayName } from '@/lib/shifts/names'
import { createStaffInvitation, credentialRoute, ONBOARDING_HEADERS } from '@/lib/staff/invitations'

// Owner-only throughout — staff management is exactly the kind of
// privileged action that must never be reachable by a general_manager's
// menu-editor session, let alone the client trusting its own UI to hide
// the button.
//
// WHAT A STAFF RECORD IS (the identity rules this route enforces):
//   * a stable internal id (staff.id) — NOT the email. Email is optional: a person
//     without one is a full employee who can be scheduled, edited and paid
//     attention to; they just cannot sign in until an email is added;
//   * a name the owner can see everywhere: display name, else first + last name,
//     else the POS nickname (lib/shifts/names.ts — the same rule the scheduler uses);
//   * contact details (phone, email), a job title (badge), an optional home branch,
//     and an active flag. Deactivating NEVER deletes anything: shifts, requests,
//     swaps and orders keep pointing at the person. Permanent deletion is allowed
//     only for a record with no history at all (a typo made a minute ago).
//
// POS nickname ("handle"): every person needs one, because it is what every
// POS screen, the audit log and the Ready board show instead of an email. The
// owner picks it here when adding someone (REQUIRED on POST) and can change it
// or the person's colour later (PATCH). The write goes through the database
// function pos_set_handle, never a plain UPDATE, so uniqueness (case-insensitive)
// and the audit event are enforced the same way as when a person renames
// THEMSELVES at /api/pos/handle. The signed-in owner is the actor; the body
// cannot name one.
const words = (m: Bilingual) => `${m.he} / ${m.en}`
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/

/** The database's refusal of a nickname, as a plain-language 4xx. */
function handleRefusal(reason: unknown): ApiError {
  if (reason === 'taken') return new ApiError(409, 'conflict', words(OWNER_MESSAGES.handle_taken), { reason: 'taken' })
  if (reason === 'invalid') return new ApiError(400, 'bad_request', words(OWNER_MESSAGES.handle_invalid), { reason: 'invalid' })
  if (reason === 'not_found') return new ApiError(404, 'not_found', words(OWNER_MESSAGES.not_found))
  return BadRequest(words(OWNER_MESSAGES.bad_request))
}

/** Format check before touching anything, so a bad nickname never creates half a person. */
function checkHandleFormat(handle: string): string {
  const h = handle.trim()
  if (handleProblem(h)) throw new ApiError(400, 'bad_request', words(OWNER_MESSAGES.handle_invalid), { reason: 'invalid' })
  return h
}

// The friendly early answer to "is this nickname free?". The format check above has
// already limited the characters to letters, digits, dot, dash and underscore, so the
// only LIKE wildcard that can appear is the underscore, escaped here. The database's
// unique index on lower(handle) is the real guard.
async function assertHandleFree(service: ReturnType<typeof createServiceRoleClient>, handle: string, exceptId: string | null) {
  const pattern = handle.replace(/_/g, '\\_')
  let q = service.from('staff').select('id').ilike('handle', pattern)
  if (exceptId) q = q.neq('id', exceptId)
  const { data } = await q.limit(1)
  if (data && data.length > 0) throw handleRefusal('taken')
}

/** ilike-safe: the only wildcards are % and _, and a name may contain neither on purpose. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

const COLUMNS =
  'id, email, first_name, last_name, display_name, phone, role, badge, branch_id, active, invited_at, claimed_at, handle, handle_set_at, colour, employee_no, pin_hash, auth_user_id'

export const GET = apiRoute(async () => {
  await requireOwner()
  const service = createServiceRoleClient()
  const [{ data }, { data: scheduleMembers }] = await Promise.all([
    service.from('staff').select(COLUMNS).order('invited_at', { ascending: false }),
    // Read alongside the roster so StaffManager can surface a compact
    // schedulable toggle per row without a second round trip — the full
    // flag set (default role, hours cap, delegate) stays in RosterPanel.
    service.from('schedule_members').select('branch_id, staff_id, schedulable, default_role_id, max_weekly_hours'),
  ])

  // The passcode hash and the auth user id never leave the server: the UI only needs
  // "is a code set" and "has this person signed in with Google yet" (quick login needs both).
  const staff = (data ?? []).map((row) => {
    const { pin_hash, auth_user_id, ...rest } = row as typeof row & { pin_hash: string | null; auth_user_id: string | null }
    return {
      ...rest,
      label: staffDisplayName(rest),
      has_passcode: pin_hash != null,
      has_google: auth_user_id != null,
    }
  })
  return NextResponse.json({ staff, scheduleMembers: scheduleMembers ?? [] })
})

const nameField = z.string().trim().max(60)
const phoneField = z.string().trim().max(32)

/** The one phone rule (digits and a leading +, 7–15 digits — the POS's own), stored normalised; blank = none. */
function cleanPhone(input: string | null | undefined): string | null {
  const p = normalizePhone(input)
  if (p === 'invalid') throw new ApiError(400, 'bad_request', 'מספר הטלפון לא נראה תקין. אפשר להשאיר ריק.', { reason: 'phone_invalid' })
  return p
}

// Email is optional at invite time — a name-only row can be created and
// linked to a Google account later once the email is known (see PATCH
// below). claim_staff_invite() (000_core_schema.sql) matches staff rows by
// `lower(email) = lower(auth.users.email)`; a NULL email simply never
// matches, so an unclaimed name-only row needs no special-casing there —
// it just sits inert until an email is added.
const inviteSchema = z.object({
  email: z.string().trim().email().nullable().default(null),
  firstName: nameField.min(1).nullable().default(null),
  lastName: nameField.nullable().default(null),
  displayName: nameField.nullable().default(null),
  phone: phoneField.nullable().default(null),
  role: z.enum(['staff', 'owner']).default('staff'),
  badge: z.string().max(40).nullable().default(null),
  branchId: z.string().uuid().nullable().default(null),
  // REQUIRED. Absent or blank is a plain-language 400 below, not a generic zod error.
  handle: z.string().optional(),
  // The same name already belongs to an active colleague: ask once, then allow.
  allowDuplicateName: z.boolean().optional(),
  employeeNo: z.number().int().min(1).max(99999).optional(),
  generateInvite: z.boolean().default(false),
}).superRefine((body, ctx) => {
  if (!body.generateInvite) return
  for (const field of ['firstName', 'lastName'] as const) {
    if (!body[field]?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'Required for invitation' })
  }
  if (!body.employeeNo) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['employeeNo'], message: 'Required for invitation' })
})

export const POST = credentialRoute(async (request: NextRequest) => {
  const owner = await requireOwner()
  const body = inviteSchema.parse(await request.json())
  const handle = body.handle?.trim() ? checkHandleFormat(body.handle) : null

  const service = createServiceRoleClient()
  if (handle) await assertHandleFree(service, handle, null)
  if (body.email) {
    const { data: existing } = await service.from('staff').select('id').ilike('email', likeEscape(body.email)).maybeSingle()
    if (existing) throw new ApiError(409, 'conflict', 'כבר קיים/ת איש/אשת צוות עם האימייל הזה.', { reason: 'email_taken' })
  }

  // The same name twice is allowed (two people can be called Noa) but never by accident.
  const fullName = body.displayName || [body.firstName, body.lastName].filter(Boolean).join(' ')
  if (fullName && !body.allowDuplicateName) {
    const { data: active } = await service.from('staff').select('id, branch_id, display_name, first_name, last_name, handle, email').eq('active', true)
    const wanted = fullName.toLowerCase()
    const clash = (active ?? []).some(
      (s) => staffDisplayName(s).toLowerCase() === wanted && (s.branch_id === null || body.branchId === null || s.branch_id === body.branchId)
    )
    if (clash) throw new ApiError(409, 'conflict', `כבר יש ${fullName} בצוות. ליצור עוד אחד/ת בכל זאת?`, { reason: 'duplicate_name', name: fullName })
  }

  const { data: staff, error } = await service
    .from('staff')
    .insert({
      email: body.email,
      first_name: body.firstName,
      last_name: body.lastName,
      // Always set, so every screen (and the audit log) shows the same real name.
      display_name: fullName || null,
      phone: cleanPhone(body.phone),
      role: body.role,
      badge: body.badge,
      branch_id: body.branchId,
      ...(body.employeeNo ? { employee_no: body.employeeNo } : {}),
    })
    .select()
    .single()

  if (error?.code === '23505' && body.employeeNo) throw new ApiError(409, 'conflict', 'מספר העובד הזה כבר נמצא בשימוש. בדקו את מספר HYP.', { reason: 'employee_no_taken' })
  if (error || !staff) throw new ApiError(400, 'bad_request', 'לא הצלחנו להוסיף את איש/אשת הצוות. בדקו את הפרטים ונסו שוב.')

  // The insert trigger gave the row a placeholder nickname; this sets the real one
  // (and the audit event) through the same function a person's own rename uses.
  const set: { ok: boolean; reason?: string; handle?: string | null } = handle
    ? await callPosRpc<{ ok: boolean; reason?: string; handle?: string }>('pos_set_handle', {
        p_actor: owner.id,
        p_target: staff.id,
        p_handle: handle,
      })
    : { ok: true, handle: (staff as { handle?: string | null }).handle ?? null }
  if (!set.ok) {
    // A brand-new row has no history, so removing it is safe, and it leaves nobody
    // half-created behind a nickname that was refused.
    await service.from('staff').delete().eq('id', staff.id)
    throw handleRefusal(set.reason)
  }
  await service.rpc('staff_log', {
    p_actor: owner.id,
    p_target: staff.id,
    p_action: 'staff.create',
    p_summary: `הוסיף/ה את ${fullName || handle || `עובד/ת ${staff.employee_no ?? ''}`}`.trim() + ' לצוות',
    p_detail: { email: body.email, branchId: body.branchId, badge: body.badge },
  })
  const label = fullName || handle || `עובד/ת ${staff.employee_no ?? ''}`.trim()
  let invitation: { url: string; expiresAt: string } | null = null
  if (body.generateInvite) {
    try { invitation = await createStaffInvitation(owner.id, staff.id, new URL(request.url).origin) }
    catch { console.error('staff create: invitation creation failed; owner may retry for existing record') }
  }
  // Do not serialize the database row: credential hashes and Auth identifiers are server-only.
  return NextResponse.json({ staff: { id: staff.id, label, employee_no: staff.employee_no }, invitation }, { status: 201, headers: ONBOARDING_HEADERS })
})

const patchSchema = z.object({
  id: z.string().uuid(),
  // A new address, or null to clear it (only while the person has not signed in yet).
  email: z.string().trim().email().nullable().optional(),
  firstName: nameField.nullable().optional(),
  lastName: nameField.nullable().optional(),
  displayName: nameField.nullable().optional(),
  phone: phoneField.nullable().optional(),
  role: z.enum(['staff', 'owner']).optional(),
  badge: z.string().max(40).nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
  /** With active:false — also take the person off every shift that has not started yet. */
  removeFromFutureShifts: z.boolean().optional(),
  handle: z.string().optional(),
  // A hex colour, or null to clear it (the person then gets the automatic one).
  colour: z.string().nullable().optional(),
})

type Existing = {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  display_name: string | null
  phone: string | null
  role: string
  badge: string | null
  branch_id: string | null
  active: boolean
  auth_user_id: string | null
}

export const PATCH = apiRoute(async (request: NextRequest) => {
  const owner = await requireOwner()
  const body = patchSchema.parse(await request.json())

  if (body.colour !== undefined && body.colour !== null && !HEX_COLOUR.test(body.colour)) {
    throw new ApiError(400, 'bad_request', words(OWNER_MESSAGES.colour_invalid), { reason: 'colour_invalid' })
  }
  const newHandle = body.handle !== undefined ? checkHandleFormat(body.handle) : null

  const service = createServiceRoleClient()
  const { data: existing } = await service
    .from('staff')
    .select('id, email, first_name, last_name, display_name, phone, role, badge, branch_id, active, auth_user_id')
    .eq('id', body.id)
    .maybeSingle()
  if (!existing) throw new ApiError(404, 'not_found', 'לא מצאנו את איש/אשת הצוות. רעננו ונסו שוב.')
  const before = existing as Existing

  // The nickname first: it is the one change another person's row can refuse, and
  // nothing else should have been applied when it does.
  if (newHandle !== null) {
    await assertHandleFree(service, newHandle, body.id)
    const set = await callPosRpc<{ ok: boolean; reason?: string }>('pos_set_handle', {
      p_actor: owner.id,
      p_target: body.id,
      p_handle: newHandle,
    })
    if (!set.ok) throw handleRefusal(set.reason)
  }

  const updates: Record<string, unknown> = {}
  const changed: string[] = []
  if (body.colour !== undefined) updates.colour = body.colour

  if (body.firstName !== undefined) {
    updates.first_name = body.firstName || null
    if ((body.firstName || null) !== before.first_name) changed.push('שם פרטי')
  }
  if (body.lastName !== undefined) {
    updates.last_name = body.lastName || null
    if ((body.lastName || null) !== before.last_name) changed.push('שם משפחה')
  }
  if (body.displayName !== undefined) {
    updates.display_name = body.displayName || null
    if ((body.displayName || null) !== before.display_name) changed.push('שם תצוגה')
  }
  if (body.phone !== undefined) {
    const phone = cleanPhone(body.phone)
    updates.phone = phone
    if (phone !== before.phone) changed.push('טלפון')
  }

  if (body.email !== undefined) {
    const next = body.email ? body.email.trim() : null
    if ((next ?? '').toLowerCase() !== (before.email ?? '').toLowerCase()) {
      // Once a person has signed in, their login IS their account: changing the address on this
      // record would silently detach quick login and invites from who they really are.
      if (before.auth_user_id) {
        throw new ApiError(409, 'conflict', 'אי אפשר לשנות אימייל של מי שכבר התחבר/ה — הוא קשור לחשבון Google שלו/ה.', { reason: 'email_locked' })
      }
      if (next) {
        const { data: dup } = await service.from('staff').select('id').ilike('email', likeEscape(next)).neq('id', body.id).maybeSingle()
        if (dup) throw new ApiError(409, 'conflict', 'כבר קיים/ת איש/אשת צוות עם האימייל הזה.', { reason: 'email_taken' })
      }
      updates.email = next
      changed.push('אימייל')
    }
  }

  if (body.role !== undefined && body.role !== before.role) {
    updates.role = body.role
    changed.push('הרשאה')
  }
  if (body.badge !== undefined && (body.badge || null) !== before.badge) {
    updates.badge = body.badge || null
    changed.push('תפקיד')
  }
  if (body.branchId !== undefined && body.branchId !== before.branch_id) {
    updates.branch_id = body.branchId
    changed.push('סניף')
  }

  // Taking away the last owner's ownership would lock everybody out of the owner screens.
  const willBeOwner = (updates.role ?? before.role) === 'owner' || (updates.badge !== undefined ? updates.badge : before.badge) === 'owner'
  const isOwnerNow = before.role === 'owner' || before.badge === 'owner'
  if (isOwnerNow && !willBeOwner) {
    const { data: others } = await service
      .from('staff')
      .select('id')
      .eq('active', true)
      .neq('id', body.id)
      .or('role.eq.owner,badge.eq.owner')
      .limit(1)
    if (!others || others.length === 0) throw refusal('last_owner')
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await service.from('staff').update(updates).eq('id', body.id)
    if (error) {
      console.error('staff update failed:', error.code)
      throw new ApiError(400, 'bad_request', 'לא הצלחנו לשמור את השינויים. נסו שוב.')
    }
    if (changed.length > 0) {
      await service.rpc('staff_log', {
        p_actor: owner.id,
        p_target: body.id,
        p_action: 'staff.update',
        p_summary: `עדכן/ה פרטי עובד/ת: ${changed.join(', ')}`,
        p_detail: { changed },
      })
    }
  }

  // Deactivate / reactivate — one atomic database call: it also unlinks the sign-in
  // (every access check keys on auth_user_id, so a removed person's own Google login
  // cannot silently re-admit them), cancels what they had open, and optionally frees
  // their future shifts. Past shifts and every record stay exactly as they were.
  let result: Record<string, unknown> = {}
  if (body.active !== undefined && body.active !== before.active) {
    const { data, error } = await service.rpc('sched_set_staff_active', {
      p_actor: owner.id,
      p_staff: body.id,
      p_active: body.active,
      p_remove_future: body.removeFromFutureShifts === true,
    })
    if (error) {
      console.error('sched_set_staff_active failed:', error.code)
      throw new ApiError(500, 'internal_error', 'משהו השתבש אצלנו. נסו שוב בעוד רגע.')
    }
    const res = data as { ok?: boolean; reason?: string; details?: Record<string, unknown> } & Record<string, unknown>
    if (res.ok !== true) throw refusal(res.reason ?? 'bad_request', res.details ?? {})
    result = res
  }

  return NextResponse.json({ ok: true, ...result })
})
