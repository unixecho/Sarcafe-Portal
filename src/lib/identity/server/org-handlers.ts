import 'server-only'

import { z } from 'zod'
import { ApiError, BadRequest } from '@/lib/http/errors'
import { DEFAULT_INVITATION_EXPIRY_HOURS, INVITATION_EXPIRY_HOURS, normalizeEmail, recipientHint } from '@/lib/identity/invitations'
import { isUuid } from '@/lib/identity/rules'
import type { IdentityActor } from '@/lib/identity/server/guard'
import { assertSameOrigin, identityJson, readIdentityBody, refuse, throttleCredential, throttleWrites } from '@/lib/identity/server/http'
import { invitationTokenDigest, newInvitationToken, recipientDigest } from '@/lib/identity/server/invitations'
import {
  createDepartment, createInvitation, organizationDetail, revokeDepartmentHead, revokeInvitation, updateDepartment, updateOrganization,
} from '@/lib/identity/server/organizations'

// The organization-scoped operations, written once and served by two route families:
//   /api/owner/members/organizations/[organizationId]/…    guard: requireOwnerBusiness (a full owner session + Sarcafe business)
//   /api/benefits/manage/organizations/[organizationId]/…  guard: requireOrganizationAdmin (a live grant on THIS organization)
// Each route file names its guard and passes it in, so the family a route belongs to is visible in the route itself. The guard runs
// before anything is read or parsed, and the database function behind every call rechecks the same actor for the same scope.

/** The guard of the family: who is acting, or a thrown 401 / 403 / 503. */
export type OrganizationGuard = (organizationId: string) => Promise<IdentityActor>
type Context<K extends string> = { params: Promise<Record<K, string>> }

const id = (value: string): string => {
  if (!isUuid(value)) throw BadRequest()
  return value
}
const name = z.string().trim().min(1).max(80)
const state = z.enum(['active', 'inactive'])
const patch = z.object({ name: name.optional(), state: state.optional() }).strict().refine((body) => body.name !== undefined || body.state !== undefined)

export async function getOrganization(guard: OrganizationGuard, _request: Request, context: Context<'organizationId'>) {
  const { organizationId } = await context.params
  const actor = await guard(organizationId)
  const detail = await organizationDetail(actor.authUserId, id(organizationId))
  if (!detail.ok) refuse(detail.error)
  const { ok: _ok, ...body } = detail
  return identityJson(body)
}

export async function patchOrganization(guard: OrganizationGuard, request: Request, context: Context<'organizationId'>) {
  const { organizationId } = await context.params
  const actor = await guard(organizationId)
  const body = await readIdentityBody(request, patch)
  await throttleWrites(actor.authUserId)
  const result = await updateOrganization(actor.authUserId, id(organizationId), body)
  if (!result.ok) refuse(result.error)
  return identityJson({ ok: true, status: result.status })
}

export async function postDepartment(guard: OrganizationGuard, request: Request, context: Context<'organizationId'>) {
  const { organizationId } = await context.params
  const actor = await guard(organizationId)
  const body = await readIdentityBody(request, z.object({ name }).strict())
  await throttleWrites(actor.authUserId)
  const result = await createDepartment(actor.authUserId, id(organizationId), body.name)
  if (!result.ok) refuse(result.error)
  return identityJson({ ok: true, departmentId: result.departmentId }, 201)
}

export async function patchDepartment(guard: OrganizationGuard, request: Request, context: Context<'organizationId' | 'departmentId'>) {
  const { organizationId, departmentId } = await context.params
  const actor = await guard(organizationId)
  const body = await readIdentityBody(request, patch)
  await throttleWrites(actor.authUserId)
  const result = await updateDepartment(actor.authUserId, id(organizationId), id(departmentId), body)
  if (!result.ok) refuse(result.error)
  return identityJson({ ok: true, status: result.status })
}

const invitation = z.object({
  departmentId: z.string(),
  email: z.string().max(254),
  expiresInHours: z.number().int().optional(),
}).strict()

/**
 * A department-head invitation. The address the issuer types only NAMES the intended recipient: it is stored as a digest and a
 * masked hint and proves nothing. The token is made here, answered ONCE in this private response (the page builds the link to
 * copy), and is never stored or logged: the database gets its digest. No e-mail or message is sent.
 */
export async function postInvitation(guard: OrganizationGuard, request: Request, context: Context<'organizationId'>) {
  const { organizationId } = await context.params
  const actor = await guard(organizationId)
  const body = await readIdentityBody(request, invitation)
  const email = normalizeEmail(body.email)
  const hours = body.expiresInHours ?? DEFAULT_INVITATION_EXPIRY_HOURS
  if (!email || !(INVITATION_EXPIRY_HOURS as readonly number[]).includes(hours)) throw BadRequest()
  // nobody invites themselves (the database refuses the acceptance too; this only says so early)
  if (actor.verifiedEmail && actor.verifiedEmail === email) throw new ApiError(400, 'self_invite', 'אי אפשר להזמין את עצמכם.')
  await throttleCredential('invite-create', actor.authUserId, 30, 3600)

  const token = newInvitationToken()
  const expiresAt = new Date(Date.now() + hours * 3600_000)
  const hint = recipientHint(email)
  const result = await createInvitation(actor.authUserId, {
    organizationId: id(organizationId), departmentId: id(body.departmentId), tokenDigest: invitationTokenDigest(token),
    recipientDigest: recipientDigest(email), recipientHint: hint, expiresAt,
  })
  if (!result.ok) refuse(result.error)
  return identityJson({ ok: true, invitationId: result.invitationId, token, hint, expiresAt: expiresAt.toISOString() }, 201)
}

export async function deleteInvitation(guard: OrganizationGuard, request: Request, context: Context<'organizationId' | 'invitationId'>) {
  // a write with no body still comes from our own pages only (the middleware refuses a foreign Origin too; this is the second lock)
  assertSameOrigin(request)
  const { organizationId, invitationId } = await context.params
  const actor = await guard(organizationId)
  await throttleWrites(actor.authUserId)
  id(organizationId)
  const result = await revokeInvitation(actor.authUserId, id(invitationId))
  if (!result.ok) refuse(result.error)
  return identityJson({ ok: true, status: result.status })
}

export async function deleteHead(guard: OrganizationGuard, request: Request, context: Context<'organizationId' | 'grantId'>) {
  // a write with no body still comes from our own pages only (the middleware refuses a foreign Origin too; this is the second lock)
  assertSameOrigin(request)
  const { organizationId, grantId } = await context.params
  const actor = await guard(organizationId)
  await throttleWrites(actor.authUserId)
  id(organizationId)
  const result = await revokeDepartmentHead(actor.authUserId, id(grantId))
  if (!result.ok) refuse(result.error)
  return identityJson({ ok: true, status: result.status })
}
