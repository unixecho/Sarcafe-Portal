import 'server-only'

import { createHash } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { ApiError, BadRequest, Forbidden } from '@/lib/http/errors'
import {
  DEFAULT_REGISTRATION_EXPIRY_HOURS, NAME_MAX, NICKNAME_MAX, PHOTO_UPLOAD_MAX_BYTES, REGISTRATION_COOKIE_PATH, REGISTRATION_EXPIRY_HOURS,
  REGISTRATION_INVITE_COOKIE, REGISTRATION_INVITE_MAX_AGE, REGISTRATION_SESSION_COOKIE, REGISTRATION_SESSION_MAX_AGE, isMembershipState,
  isRegistrationToken, isSessionToken, normalizeName,
} from '@/lib/identity/registration'
import { isUuid } from '@/lib/identity/rules'
import type { IdentityActor } from '@/lib/identity/server/guard'
import { PRIVATE_HEADERS, assertSameOrigin, identityJson, readIdentityBody, refuse, throttleCredential, throttleWrites } from '@/lib/identity/server/http'
import { PORTRAIT_TEXT, processPortrait } from '@/lib/identity/server/photo'
import { getPhoto, putPhoto } from '@/lib/identity/server/photo-store'
import {
  createRegistrationInvite, listDepartment, myMemberships, newPhotoId, newRegistrationToken, newSessionToken, openPhoto, openRegistration, photoIntent,
  readBoundedBody, readRegistration, registrationTokenDigest, resubmitMembership, reviewMembership, revokeRegistrationInvite, sessionTokenDigest, submitRegistration,
} from '@/lib/identity/server/registration'
import { clientIp } from '@/lib/rate-limit'

// Employee registration and review (FABLE-003), written once; each route file names the handler it serves. Who may do what is
// decided by the guards (src/lib/identity/server/guard.ts) and AGAIN by the customer_* function behind every call.
//
//   the employee      /api/benefits/register/*        a proven Google sign-in + the link (cookie) + then a registration session (cookie)
//   the employee      /api/benefits/me/*              a proven Google sign-in; only their own applications
//   a reviewer        /api/benefits/manage/organizations/[o]/departments/[d]/{registrations,members}/*   the department's head or
//                                                     an administrator of its organization (requireDepartmentReviewer)
//
// Secrets never reach a URL a server sees, a log or a script-readable place: the link's token travels in the fragment, then in an
// HttpOnly cookie sent only to /api/benefits/register; the registration session's secret likewise; the database holds digests.

type Context<K extends string> = { params: Promise<Record<K, string>> }
/** The guard of the employee's routes (requireBenefitsUser), passed in by the route file so the route names it. */
export type UserGuard = () => Promise<IdentityActor>
/** The guard of a reviewer's routes (requireDepartmentReviewer), passed in by the route file. */
export type ReviewerGuard = (organizationId: string, departmentId: string) => Promise<IdentityActor>

const cookie = (name: string, value: string, maxAge: number) => ({
  name, value, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: REGISTRATION_COOKIE_PATH, maxAge,
})
const forgetLink = cookie(REGISTRATION_INVITE_COOKIE, '', 0)
const forgetSession = cookie(REGISTRATION_SESSION_COOKIE, '', 0)

/** One sentence for every reason a link or a session cannot be used: it never says which (unknown, used, expired, revoked, off …). */
const unavailable = (...forget: Array<typeof forgetLink>) => {
  const response = identityJson({ error: { code: 'registration_unavailable', message: 'הקישור אינו זמין. בקשו קישור חדש ממי ששלח לכם אותו.' } }, 403)
  for (const c of forget) response.cookies.set(c)
  return response
}

const id = (value: string): string => {
  if (!isUuid(value)) throw BadRequest()
  return value
}

const names = z.object({
  firstName: z.string().max(200),
  lastName: z.string().max(200),
  nickname: z.string().max(200).optional().nullable(),
})
const readNames = (body: z.infer<typeof names>) => {
  const firstName = normalizeName(body.firstName, NAME_MAX)
  const lastName = normalizeName(body.lastName, NAME_MAX)
  const nickname = body.nickname == null || body.nickname.trim() === '' ? null : normalizeName(body.nickname, NICKNAME_MAX)
  if (!firstName || !lastName || (body.nickname && body.nickname.trim() !== '' && !nickname)) throw new ApiError(400, 'bad_request', 'בדקו את השם הפרטי, שם המשפחה והכינוי.', { fields: ['firstName', 'lastName', 'nickname'] })
  return { firstName, lastName, nickname }
}

/** Checks, re-encodes and stores one photo for a session or an own membership. The row is written before the object (cleanup finds strays). */
async function storePortrait(request: Request, actor: IdentityActor, origin: { sessionDigest: string } | { membershipId: string }) {
  assertSameOrigin(request)
  const type = (request.headers.get('content-type') ?? '').toLowerCase()
  if (!/^(image\/(jpeg|png|webp)|application\/octet-stream)\b/.test(type)) throw new ApiError(415, 'unsupported', PORTRAIT_TEXT.not_an_image)
  await throttleCredential('register-photo', actor.authUserId, 30, 3600)
  const bytes = await readBoundedBody(request, PHOTO_UPLOAD_MAX_BYTES)
  const checked = await processPortrait(bytes)
  if (!checked.ok) throw new ApiError(checked.reason === 'too_large' ? 413 : 422, checked.reason, PORTRAIT_TEXT[checked.reason])
  const { jpeg, width, height, sha256 } = checked.portrait
  const photoId = newPhotoId()
  const intent = await photoIntent(actor.authUserId, origin, { photoId, width, height, byteSize: jpeg.length, sha256 })
  if (!intent.ok) return intent
  try {
    await putPhoto(intent.objectPath, jpeg)
  } catch {
    // the row stays 'uploading' and the cleanup job discards it; the person simply tries again
    throw new ApiError(503, 'unavailable', 'לא הצלחנו לשמור את התמונה כרגע. נסו שוב בעוד רגע.')
  }
  return { ok: true as const, photoId, width, height }
}

/** A stored photo as an image response that nothing may keep, forward or reinterpret. */
async function photoResponse(objectPath: string, sha256: string) {
  let bytes: Buffer | null
  try {
    bytes = await getPhoto(objectPath)
  } catch {
    throw new ApiError(503, 'unavailable', 'התמונה אינה זמינה כרגע. נסו שוב בעוד רגע.')
  }
  // the object must be the very one the database recorded (an object swapped in storage is not shown)
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== sha256) throw Forbidden()
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      ...PRIVATE_HEADERS,
      'Content-Type': 'image/jpeg',
      'Content-Length': String(bytes.length),
      'Content-Disposition': 'inline; filename="photo.jpg"',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}
const which = (request: NextRequest): 'pending' | 'approved' => {
  const value = request.nextUrl.searchParams.get('which') ?? 'approved'
  if (value !== 'pending' && value !== 'approved') throw BadRequest()
  return value
}

// ================================================================ the employee: /api/benefits/register/*

/** PUBLIC: the link's token (from the URL fragment) becomes an HttpOnly cookie. Nothing is asked of the database; every well-formed token gets the same answer. */
export async function registerExchange(request: NextRequest) {
  const body = await readIdentityBody(request, z.object({ token: z.string().max(80) }).strict())
  await throttleCredential('register-exchange', clientIp(request), 20, 600)
  if (!isRegistrationToken(body.token)) throw BadRequest()
  const response = identityJson({ ok: true })
  response.cookies.set(cookie(REGISTRATION_INVITE_COOKIE, body.token, REGISTRATION_INVITE_MAX_AGE))
  return response
}

/** "Not now": forget the link and any registration session on this device. */
export async function registerForget(request: NextRequest) {
  assertSameOrigin(request)
  const response = identityJson({ ok: true })
  response.cookies.set(forgetLink)
  response.cookies.set(forgetSession)
  return response
}

/** A proven Google sign-in opens the link: a registration session (one hour) for THIS person and THIS link. */
export async function registerOpen(guard: UserGuard, request: NextRequest) {
  assertSameOrigin(request)
  const actor = await guard()
  const token = request.cookies.get(REGISTRATION_INVITE_COOKIE)?.value
  if (!isRegistrationToken(token)) return unavailable(forgetLink)
  await throttleCredential('register-open', actor.authUserId, 10, 600)
  const secret = newSessionToken()
  const opened = await openRegistration(registrationTokenDigest(token), actor.authUserId, sessionTokenDigest(secret), new Date(Date.now() + REGISTRATION_SESSION_MAX_AGE * 1000))
  if (!opened.ok) {
    if (opened.error === 'denied') return unavailable(forgetLink, forgetSession)
    refuse(opened.error)
  }
  const { ok: _ok, ...view } = opened
  const response = identityJson({ state: 'ready', ...view })
  response.cookies.set(cookie(REGISTRATION_SESSION_COOKIE, secret, REGISTRATION_SESSION_MAX_AGE))
  response.cookies.set(forgetLink)
  return response
}

/**
 * What the registration page shows (signed in):
 *   ready        a live registration session: the organization, the department and the notice to accept
 *   link         a link on this device that has not been opened yet (the page opens it)
 *   none         nothing on this device
 *   unavailable  the session ended (used, expired, revoked; one answer)
 *   closed       registration is not open (no published notice)
 */
export async function registerStatus(guard: UserGuard, request: NextRequest) {
  const actor = await guard()
  const secret = request.cookies.get(REGISTRATION_SESSION_COOKIE)?.value
  if (isSessionToken(secret)) {
    await throttleCredential('register-status', actor.authUserId, 60, 600)
    const view = await readRegistration(sessionTokenDigest(secret), actor.authUserId)
    if (view.ok) { const { ok: _ok, ...rest } = view; return identityJson({ state: 'ready', ...rest }) }
    if (view.error === 'closed') return identityJson({ state: 'closed' })
    const response = identityJson({ state: request.cookies.get(REGISTRATION_INVITE_COOKIE) ? 'link' : 'unavailable' })
    response.cookies.set(forgetSession)
    return response
  }
  return identityJson({ state: isRegistrationToken(request.cookies.get(REGISTRATION_INVITE_COOKIE)?.value) ? 'link' : 'none' })
}

/** The photo, during registration: checked and re-encoded here, stored privately, recorded against the session. */
export async function registerPhoto(guard: UserGuard, request: NextRequest) {
  const actor = await guard()
  const secret = request.cookies.get(REGISTRATION_SESSION_COOKIE)?.value
  if (!isSessionToken(secret)) return unavailable(forgetSession)
  const stored = await storePortrait(request, actor, { sessionDigest: sessionTokenDigest(secret) })
  if (!stored.ok) {
    if (stored.error === 'denied') return unavailable(forgetSession)
    refuse(stored.error)
  }
  return identityJson({ ok: true, photoId: stored.photoId, width: stored.width, height: stored.height }, 201)
}

const submitBody = names.extend({ photoId: z.string(), noticeId: z.string(), accept: z.literal(true) }).strict()

/** The application: one transaction in the database, once. It is PENDING until a reviewer decides. */
export async function registerSubmit(guard: UserGuard, request: NextRequest) {
  const body = await readIdentityBody(request, submitBody)
  const actor = await guard()
  const secret = request.cookies.get(REGISTRATION_SESSION_COOKIE)?.value
  if (!isSessionToken(secret)) return unavailable(forgetSession)
  const person = readNames(body)
  await throttleCredential('register-submit', actor.authUserId, 10, 600)
  const result = await submitRegistration(sessionTokenDigest(secret), actor.authUserId, person, id(body.photoId), id(body.noticeId))
  if (!result.ok) {
    if (result.error === 'denied') return unavailable(forgetSession)
    refuse(result.error)
  }
  const response = identityJson({ ok: true, membershipId: result.membershipId, state: 'pending' }, 201)
  response.cookies.set(forgetSession)
  return response
}

// ================================================================ the employee's own applications: /api/benefits/me/*

export async function meList(guard: UserGuard) {
  const actor = await guard()
  return identityJson(await myMemberships(actor.authUserId))
}

const changeBody = names.extend({ photoId: z.string().nullable().optional(), noticeId: z.string() }).strict()

/** A change by the employee. A changed name, nickname or photo sends the membership back to review. */
export async function meChange(guard: UserGuard, request: NextRequest, context: Context<'membershipId'>) {
  const { membershipId } = await context.params
  const body = await readIdentityBody(request, changeBody)
  const actor = await guard()
  const person = readNames(body)
  await throttleCredential('member-change', actor.authUserId, 20, 3600)
  const result = await resubmitMembership(actor.authUserId, id(membershipId), person, body.photoId ? id(body.photoId) : null, id(body.noticeId))
  if (!result.ok) refuse(result.error)
  return identityJson({ ok: true, status: result.status, version: result.version })
}

export async function mePhotoUpload(guard: UserGuard, request: NextRequest, context: Context<'membershipId'>) {
  const { membershipId } = await context.params
  const actor = await guard()
  const stored = await storePortrait(request, actor, { membershipId: id(membershipId) })
  if (!stored.ok) refuse(stored.error)
  return identityJson({ ok: true, photoId: stored.photoId, width: stored.width, height: stored.height }, 201)
}

/** The employee's own photo (pending or approved), through the proxy, with its audit row. */
export async function mePhoto(guard: UserGuard, request: NextRequest, context: Context<'membershipId'>) {
  const { membershipId } = await context.params
  const actor = await guard()
  const kind = which(request)
  await throttleCredential('photo-read', actor.authUserId, 300, 3600)
  const photo = await openPhoto(actor.authUserId, null, id(membershipId), kind)
  if (!photo) throw Forbidden()
  return photoResponse(photo.objectPath, photo.sha256)
}

// ================================================================ a reviewer: /api/benefits/manage/organizations/[o]/departments/[d]/…

type DepartmentContext = Context<'organizationId' | 'departmentId'>

export async function departmentRegistrations(guard: ReviewerGuard, request: NextRequest, context: DepartmentContext) {
  const { organizationId, departmentId } = await context.params
  const actor = await guard(organizationId, departmentId)
  const state = request.nextUrl.searchParams.get('state')
  const offset = Number(request.nextUrl.searchParams.get('offset') ?? 0)
  if ((state !== null && !isMembershipState(state)) || !Number.isInteger(offset) || offset < 0 || offset > 100_000) throw BadRequest()
  const result = await listDepartment(actor.authUserId, organizationId, departmentId, state, 100, offset)
  if (!result.ok) refuse(result.error)
  const { ok: _ok, ...body } = result
  return identityJson(body)
}

/** A single-use registration link. The token is made here, answered ONCE in this private response, and never stored or logged. */
export async function departmentInvite(guard: ReviewerGuard, request: NextRequest, context: DepartmentContext) {
  const { organizationId, departmentId } = await context.params
  const actor = await guard(organizationId, departmentId)
  const body = await readIdentityBody(request, z.object({ expiresInHours: z.number().int().optional() }).strict())
  const hours = body.expiresInHours ?? DEFAULT_REGISTRATION_EXPIRY_HOURS
  if (!(REGISTRATION_EXPIRY_HOURS as readonly number[]).includes(hours)) throw BadRequest()
  await throttleCredential('register-create', actor.authUserId, 60, 3600)
  const token = newRegistrationToken()
  const expiresAt = new Date(Date.now() + hours * 3600_000)
  const result = await createRegistrationInvite(actor.authUserId, organizationId, departmentId, registrationTokenDigest(token), expiresAt)
  if (!result.ok) refuse(result.error)
  return identityJson({ ok: true, inviteId: result.inviteId, token, expiresAt: expiresAt.toISOString() }, 201)
}

export async function departmentInviteRevoke(guard: ReviewerGuard, request: NextRequest, context: Context<'organizationId' | 'departmentId' | 'inviteId'>) {
  assertSameOrigin(request)
  const { organizationId, departmentId, inviteId } = await context.params
  const actor = await guard(organizationId, departmentId)
  await throttleWrites(actor.authUserId)
  const result = await revokeRegistrationInvite(actor.authUserId, id(inviteId))
  if (!result.ok) refuse(result.error)
  return identityJson({ ok: true, status: result.status })
}

const reviewBody = z.object({
  decision: z.enum(['approve', 'reject', 'deactivate', 'reactivate']),
  reason: z.string().max(300).optional().nullable(),
  version: z.number().int().min(1),
}).strict()

export async function departmentReview(guard: ReviewerGuard, request: NextRequest, context: Context<'organizationId' | 'departmentId' | 'membershipId'>) {
  const { organizationId, departmentId, membershipId } = await context.params
  const actor = await guard(organizationId, departmentId)
  const body = await readIdentityBody(request, reviewBody)
  await throttleWrites(actor.authUserId)
  const reason = body.reason?.replace(/\s+/g, ' ').trim() || null
  const result = await reviewMembership(actor.authUserId, { organizationId, departmentId }, id(membershipId), body.decision, reason, body.version)
  if (!result.ok) refuse(result.error)
  return identityJson({ ok: true, state: result.status, version: result.version })
}

export async function departmentPhoto(guard: ReviewerGuard, request: NextRequest, context: Context<'organizationId' | 'departmentId' | 'membershipId'>) {
  const { organizationId, departmentId, membershipId } = await context.params
  const actor = await guard(organizationId, departmentId)
  const kind = which(request)
  await throttleCredential('photo-read', actor.authUserId, 300, 3600)
  const photo = await openPhoto(actor.authUserId, { organizationId, departmentId }, id(membershipId), kind)
  if (!photo) throw Forbidden()
  return photoResponse(photo.objectPath, photo.sha256)
}
