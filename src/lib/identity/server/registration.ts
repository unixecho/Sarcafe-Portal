import 'server-only'

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { ApiError, BadRequest } from '@/lib/http/errors'
import { REGISTRATION_TOKEN_PREFIX, SESSION_TOKEN_PREFIX, isMembershipState, type MembershipState } from '@/lib/identity/registration'
import { identityUnavailable } from '@/lib/identity/server/organizations'
import { createServiceRoleClient } from '@/lib/supabase/server'

// Employee registration and review (FABLE-003). Every read and write goes through a customer_* function of
// 20261124074218_customer_employee_registration.sql, with the service role, and with the auth user the SERVER resolved as the
// actor; the function rechecks that actor in the database, so nothing here decides authority. Server-only.

type Row = Record<string, unknown>
export type Refusal = { ok: false; error: 'denied' | 'bad_request' | 'conflict' | 'limit' | 'stale' | 'closed' }

async function call(name: string, args: Record<string, unknown>): Promise<Row> {
  let answer: { data: unknown; error: unknown }
  try {
    answer = await createServiceRoleClient().rpc(name, args)
  } catch {
    throw identityUnavailable()
  }
  if (answer.error || !answer.data || typeof answer.data !== 'object') throw identityUnavailable()
  return answer.data as Row
}
const REFUSALS = ['bad_request', 'conflict', 'limit', 'stale', 'closed'] as const
/** A refusal exactly as the database gave it; anything unexpected is 'denied', never a pass. */
const refusal = (row: Row): Refusal => ({ ok: false, error: (REFUSALS as readonly unknown[]).includes(row.error) ? (row.error as Refusal['error']) : 'denied' })
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const list = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : [])

// ---------------------------------------------------------------- secrets: made here, stored only as digests

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
export const newRegistrationToken = (): string => REGISTRATION_TOKEN_PREFIX + randomBytes(32).toString('base64url')
export const newSessionToken = (): string => SESSION_TOKEN_PREFIX + randomBytes(32).toString('base64url')
/** The purpose is part of every digest, so a secret of one kind can never match a row of another (or a department-head invitation). */
export const registrationTokenDigest = (token: string) => sha256(`sarcafe:identity:registration:link:v1:${token}`)
export const sessionTokenDigest = (token: string) => sha256(`sarcafe:identity:registration:session:v1:${token}`)
export const newPhotoId = (): string => randomUUID()

// ---------------------------------------------------------------- reading a bounded body

/**
 * The raw body of a photo upload, read as a stream and cut off past `max` bytes: a body that is larger (declared or not) is refused
 * before it is held in memory. Same origin is checked by the caller.
 */
export async function readBoundedBody(request: Request, max: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) throw new ApiError(413, 'too_large', 'הקובץ גדול מדי. אפשר להעלות תמונה עד 8MB.')
  if (!request.body) throw BadRequest()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      throw new ApiError(413, 'too_large', 'הקובץ גדול מדי. אפשר להעלות תמונה עד 8MB.')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength }
  return out
}

// ---------------------------------------------------------------- who reviews a department

export type ReviewCheck = { ok: true; via: 'department_head' | 'organization_admin' } | { ok: false; error: 'denied' | 'bad_request' }

export async function reviewCheck(authUserId: string, organizationId: string, departmentId: string): Promise<ReviewCheck> {
  const row = await call('customer_dept_review_check', { p_auth_user_id: authUserId, p_organization_id: organizationId, p_department_id: departmentId })
  if (row.ok === true && (row.via === 'department_head' || row.via === 'organization_admin')) return { ok: true, via: row.via }
  return { ok: false, error: row.error === 'bad_request' ? 'bad_request' : 'denied' }
}

// ---------------------------------------------------------------- links

export async function createRegistrationInvite(actor: string, organizationId: string, departmentId: string, tokenDigest: string, expiresAt: Date): Promise<{ ok: true; inviteId: string } | Refusal> {
  const row = await call('customer_registration_invite_create', { p_actor_auth_user_id: actor, p_organization_id: organizationId, p_department_id: departmentId, p_token_digest: tokenDigest, p_expires_at: expiresAt.toISOString() })
  return row.ok === true && typeof row.invite_id === 'string' ? { ok: true, inviteId: row.invite_id } : refusal(row)
}

export async function revokeRegistrationInvite(actor: string, inviteId: string): Promise<{ ok: true; status: string } | Refusal> {
  const row = await call('customer_registration_invite_revoke', { p_actor_auth_user_id: actor, p_invite_id: inviteId })
  return row.ok === true ? { ok: true, status: text(row.status) } : refusal(row)
}

// ---------------------------------------------------------------- the registration session

export type Notice = { id: string; version: string; language: string; body: string }
export type RegistrationView = { organizationName: string; departmentName: string; expiresAt: string; notice: Notice }

const asNotice = (value: unknown): Notice | null => {
  const n = value as Row | null
  return n && typeof n === 'object' && typeof n.id === 'string' && typeof n.body === 'string' ? { id: n.id, version: text(n.version), language: text(n.language), body: n.body } : null
}
const asView = (row: Row): RegistrationView | null => {
  const notice = asNotice(row.notice)
  return notice ? { organizationName: text(row.organization_name), departmentName: text(row.department_name), expiresAt: text(row.expires_at), notice } : null
}

export async function openRegistration(tokenDigest: string, authUserId: string, sessionDigest: string, expiresAt: Date): Promise<({ ok: true } & RegistrationView) | Refusal> {
  const row = await call('customer_registration_open', { p_token_digest: tokenDigest, p_auth_user_id: authUserId, p_session_digest: sessionDigest, p_expires_at: expiresAt.toISOString() })
  const view = row.ok === true ? asView(row) : null
  return view ? { ok: true, ...view } : refusal(row)
}

export async function readRegistration(sessionDigest: string, authUserId: string): Promise<({ ok: true } & RegistrationView) | Refusal> {
  const row = await call('customer_registration_read', { p_session_digest: sessionDigest, p_auth_user_id: authUserId })
  const view = row.ok === true ? asView(row) : null
  return view ? { ok: true, ...view } : refusal(row)
}

// ---------------------------------------------------------------- photos

export type PhotoFacts = { photoId: string; width: number; height: number; byteSize: number; sha256: string }

/**
 * Writes the row of a checked photo ('uploading') and returns the object path the DATABASE made for it (org/<the organization of
 * the session or membership>/<photo id>.jpg); the caller uploads to exactly that path. Null path = refused.
 */
export async function photoIntent(authUserId: string, origin: { sessionDigest: string } | { membershipId: string }, photo: PhotoFacts): Promise<{ ok: true; objectPath: string } | Refusal> {
  const row = await call('customer_photo_intent', {
    p_auth_user_id: authUserId,
    p_session_digest: 'sessionDigest' in origin ? origin.sessionDigest : null,
    p_membership_id: 'membershipId' in origin ? origin.membershipId : null,
    p_photo_id: photo.photoId, p_width: photo.width, p_height: photo.height, p_byte_size: photo.byteSize, p_sha256: photo.sha256,
  })
  return row.ok === true && typeof row.object_path === 'string' ? { ok: true, objectPath: row.object_path } : refusal(row)
}

export async function openPhoto(authUserId: string, scope: { organizationId: string; departmentId: string } | null, membershipId: string, which: 'pending' | 'approved'): Promise<{ objectPath: string; sha256: string } | null> {
  const row = await call('customer_photo_open', {
    p_auth_user_id: authUserId, p_organization_id: scope?.organizationId ?? null, p_department_id: scope?.departmentId ?? null, p_membership_id: membershipId, p_which: which,
  })
  return row.ok === true && typeof row.object_path === 'string' ? { objectPath: row.object_path, sha256: text(row.sha256) } : null
}

export async function photoCleanupDue(limit: number): Promise<Array<{ photoId: string; objectPath: string }>> {
  const row = await call('customer_photo_cleanup_due', { p_limit: limit })
  if (row.ok !== true) throw identityUnavailable()
  return list(row.photos).map((p) => ({ photoId: text(p.photo_id), objectPath: text(p.object_path) }))
}

export async function photoCleanupDone(photoIds: string[]): Promise<{ discarded: number; erased: number; profilesErased: number }> {
  const row = await call('customer_photo_cleanup_done', { p_photo_ids: photoIds })
  if (row.ok !== true) throw identityUnavailable()
  return { discarded: Number(row.discarded) || 0, erased: Number(row.erased) || 0, profilesErased: Number(row.profiles_erased) || 0 }
}

// ---------------------------------------------------------------- the application and changes to it

export type Names = { firstName: string; lastName: string; nickname: string | null }

export async function submitRegistration(sessionDigest: string, authUserId: string, names: Names, photoId: string, noticeId: string): Promise<{ ok: true; membershipId: string } | Refusal> {
  const row = await call('customer_registration_submit', {
    p_session_digest: sessionDigest, p_auth_user_id: authUserId, p_first_name: names.firstName, p_last_name: names.lastName, p_nickname: names.nickname, p_photo_id: photoId, p_notice_id: noticeId,
  })
  return row.ok === true && typeof row.membership_id === 'string' ? { ok: true, membershipId: row.membership_id } : refusal(row)
}

export async function resubmitMembership(authUserId: string, membershipId: string, names: Names, photoId: string | null, noticeId: string): Promise<{ ok: true; status: string; version: number } | Refusal> {
  const row = await call('customer_membership_resubmit', {
    p_auth_user_id: authUserId, p_membership_id: membershipId, p_first_name: names.firstName, p_last_name: names.lastName, p_nickname: names.nickname, p_photo_id: photoId, p_notice_id: noticeId,
  })
  return row.ok === true ? { ok: true, status: text(row.status), version: Number(row.version) || 0 } : refusal(row)
}

// ---------------------------------------------------------------- review

export type DepartmentMember = {
  membershipId: string
  state: MembershipState
  version: number
  firstName: string | null
  lastName: string | null
  nickname: string | null
  submittedAt: string
  updatedAt: string
  reviewedAt: string | null
  reviewReason: string | null
  erased: boolean
  hasPendingPhoto: boolean
  hasApprovedPhoto: boolean
}
export type DepartmentRegistrations = {
  via: 'department_head' | 'organization_admin'
  counts: Record<MembershipState, number>
  members: DepartmentMember[]
  invites: Array<{ id: string; createdAt: string; expiresAt: string; opened: boolean }>
}

export async function listDepartment(actor: string, organizationId: string, departmentId: string, state: MembershipState | null, limit = 100, offset = 0): Promise<({ ok: true } & DepartmentRegistrations) | Refusal> {
  const row = await call('customer_membership_list', { p_actor_auth_user_id: actor, p_organization_id: organizationId, p_department_id: departmentId, p_state: state, p_limit: limit, p_offset: offset })
  if (row.ok !== true) return refusal(row)
  const counts = (row.counts ?? {}) as Row
  return {
    ok: true,
    via: row.via === 'organization_admin' ? 'organization_admin' : 'department_head',
    counts: { pending: Number(counts.pending) || 0, approved: Number(counts.approved) || 0, rejected: Number(counts.rejected) || 0, inactive: Number(counts.inactive) || 0 },
    members: list(row.members).map((m) => ({
      membershipId: text(m.membership_id),
      state: isMembershipState(m.state) ? m.state : 'inactive',
      version: Number(m.version) || 0,
      firstName: textOrNull(m.first_name), lastName: textOrNull(m.last_name), nickname: textOrNull(m.nickname),
      submittedAt: text(m.submitted_at), updatedAt: text(m.updated_at), reviewedAt: textOrNull(m.reviewed_at), reviewReason: textOrNull(m.review_reason),
      erased: m.erased === true, hasPendingPhoto: m.has_pending_photo === true, hasApprovedPhoto: m.has_approved_photo === true,
    })),
    invites: list(row.invites).map((i) => ({ id: text(i.id), createdAt: text(i.created_at), expiresAt: text(i.expires_at), opened: i.opened === true })),
  }
}

/** The membership is named with the organization and department of the route; the database refuses one of another department. */
export async function reviewMembership(actor: string, scope: { organizationId: string; departmentId: string }, membershipId: string, decision: string, reason: string | null, expectedVersion: number): Promise<{ ok: true; status: MembershipState; version: number } | Refusal> {
  const row = await call('customer_membership_review', {
    p_actor_auth_user_id: actor, p_organization_id: scope.organizationId, p_department_id: scope.departmentId, p_membership_id: membershipId, p_decision: decision, p_reason: reason, p_expected_version: expectedVersion,
  })
  return row.ok === true && isMembershipState(row.status) ? { ok: true, status: row.status, version: Number(row.version) || 0 } : refusal(row)
}

// ---------------------------------------------------------------- the person's own applications

export type MyMembership = {
  membershipId: string
  state: MembershipState
  version: number
  organizationName: string
  departmentName: string
  open: boolean
  firstName: string
  lastName: string
  nickname: string | null
  submittedAt: string
  updatedAt: string
  hasPendingPhoto: boolean
  hasApprovedPhoto: boolean
}

export async function myMemberships(authUserId: string): Promise<{ memberships: MyMembership[]; notice: Notice | null }> {
  const row = await call('customer_my_memberships', { p_auth_user_id: authUserId })
  if (row.ok !== true) throw identityUnavailable()
  return {
    memberships: list(row.memberships).map((m) => ({
      membershipId: text(m.membership_id), state: isMembershipState(m.state) ? m.state : 'inactive', version: Number(m.version) || 0,
      organizationName: text(m.organization_name), departmentName: text(m.department_name), open: m.open === true,
      firstName: text(m.first_name), lastName: text(m.last_name), nickname: textOrNull(m.nickname), submittedAt: text(m.submitted_at), updatedAt: text(m.updated_at),
      hasPendingPhoto: m.has_pending_photo === true, hasApprovedPhoto: m.has_approved_photo === true,
    })),
    notice: asNotice(row.notice),
  }
}
