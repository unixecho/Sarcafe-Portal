import 'server-only'

import { createHash } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { ApiError, BadRequest, Forbidden } from '@/lib/http/errors'
import { isUuid } from '@/lib/identity/rules'
import { CARD_LIFETIME_SECONDS, parseScannedCredential } from '@/lib/identity/verification'
import type { IdentityActor } from '@/lib/identity/server/guard'
import { PRIVATE_HEADERS, assertSameOrigin, identityJson, readIdentityBody, refuse, throttleCredential, throttleWrites } from '@/lib/identity/server/http'
import { getPhoto } from '@/lib/identity/server/photo-store'
import {
  credentialTokenDigest, decideVerification, grantScanner, issueCredential, listScanners, newCredentialToken, revokeCredentials, revokeScanner,
  scanCredential, scannerScope, verificationPhoto,
} from '@/lib/identity/server/verification'

// QR credentials and staff verification (FABLE-004), written once; each route file names its guard and passes it in.
//   the employee's card    /api/benefits/me/[membershipId]/card     requireBenefitsUser (a proven Google session; only their own)
//   the operator           /api/benefits/verify/*                   requireScanner: a proven Google session; the scanner grant is
//                                                                    decided by the database on every call (the business is this
//                                                                    deployment's constant, never a value from a request)
//   the owner              /api/owner/members/scanners/*            requireOwnerBusiness (a full owner session + Sarcafe business)

type Context<K extends string> = { params: Promise<Record<K, string>> }
export type UserGuard = () => Promise<IdentityActor>
/** The operator's guard: who is scanning, and for which business (the deployment's own, never the request's). */
export type ScannerGuard = () => Promise<IdentityActor & { businessId: string }>
export type OwnerGuard = () => Promise<IdentityActor & { businessId: string }>

const id = (value: string): string => {
  if (!isUuid(value)) throw BadRequest()
  return value
}

// ================================================================ the employee's card

/**
 * A fresh QR token for the employee's own approved membership, valid CARD_LIFETIME_SECONDS. It is answered ONCE in this private
 * response and never stored (the database gets its digest); every earlier card of that membership stops working at once.
 */
export async function cardIssue(guard: UserGuard, request: NextRequest, context: Context<'membershipId'>) {
  assertSameOrigin(request)
  const { membershipId } = await context.params
  const actor = await guard()
  await throttleCredential('card-issue', actor.authUserId, 120, 3600)
  const token = newCredentialToken()
  const result = await issueCredential(actor.authUserId, id(membershipId), credentialTokenDigest(token), new Date(Date.now() + CARD_LIFETIME_SECONDS * 1000))
  if (!result.ok) refuse(result.error === 'expired' ? 'denied' : result.error)
  return identityJson({ ok: true, token, expiresAt: result.expiresAt }, 201)
}

/** "Hide the card": every live card of the own membership stops working now. */
export async function cardRevoke(guard: UserGuard, request: NextRequest, context: Context<'membershipId'>) {
  assertSameOrigin(request)
  const { membershipId } = await context.params
  const actor = await guard()
  const result = await revokeCredentials(actor.authUserId, id(membershipId))
  if (!result.ok) refuse(result.error === 'expired' ? 'denied' : result.error)
  return identityJson({ ok: true, status: result.status })
}

// ================================================================ the operator

/** Where this operator may scan: the branches of their live grants. A 403 when they hold none (being staff is not enough). */
export async function verifyScope(guard: ScannerGuard) {
  const actor = await guard()
  const scope = await scannerScope(actor.authUserId, actor.businessId)
  if (!scope.ok) refuse(scope.error === 'expired' ? 'denied' : scope.error)
  return identityJson({ branches: scope.branches })
}

const scanBody = z.object({ branchId: z.string(), code: z.string().max(200) }).strict()

/**
 * One scan. The decoded text is checked for the exact token shape here (a URL, a receipt code or anything else is "not a card" and
 * never reaches the database, a log or a page); the database decides everything else and answers one refusal for all of it.
 */
export async function verifyScan(guard: ScannerGuard, request: NextRequest) {
  const body = await readIdentityBody(request, scanBody)
  const actor = await guard()
  const branchId = id(body.branchId)
  await throttleCredential('verify-scan', actor.authUserId, 60, 60)
  const token = parseScannedCredential(body.code)
  if (!token) throw new ApiError(400, 'not_a_card', 'זה לא כרטיס הטבה. סרקו את הכרטיס שבטלפון של העובד.')
  const view = await scanCredential(actor.authUserId, actor.businessId, branchId, credentialTokenDigest(token))
  if (!view.ok) {
    if (view.error === 'denied') throw new ApiError(403, 'card_unavailable', 'הכרטיס אינו בתוקף כאן. אין לתת את ההטבה.')
    refuse(view.error === 'expired' ? 'denied' : view.error)
  }
  const { ok: _ok, ...rest } = view
  return identityJson(rest, 201)
}

/** The open verification's photo, for the operator who scanned it, through the private proxy (rechecked and audited every time). */
export async function verifyPhoto(guard: ScannerGuard, _request: NextRequest, context: Context<'verificationId'>) {
  const { verificationId } = await context.params
  const actor = await guard()
  await throttleCredential('photo-read', actor.authUserId, 300, 3600)
  const photo = await verificationPhoto(actor.authUserId, id(verificationId))
  if (!photo) throw Forbidden()
  let bytes: Buffer | null
  try {
    bytes = await getPhoto(photo.objectPath)
  } catch {
    throw new ApiError(503, 'unavailable', 'התמונה אינה זמינה כרגע. נסו שוב בעוד רגע.')
  }
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== photo.sha256) throw Forbidden()
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      ...PRIVATE_HEADERS, 'Content-Type': 'image/jpeg', 'Content-Length': String(bytes.length), 'Content-Disposition': 'inline; filename="photo.jpg"',
      'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}

const decideBody = z.object({ decision: z.enum(['match', 'mismatch', 'cancel']) }).strict()

export async function verifyDecide(guard: ScannerGuard, request: NextRequest, context: Context<'verificationId'>) {
  const { verificationId } = await context.params
  const body = await readIdentityBody(request, decideBody)
  const actor = await guard()
  await throttleWrites(actor.authUserId)
  const result = await decideVerification(actor.authUserId, id(verificationId), body.decision)
  if (!result.ok) {
    if (result.error === 'expired') throw new ApiError(409, 'expired', 'עבר הזמן. סרקו שוב.')
    refuse(result.error)
  }
  return identityJson({ ok: true, state: result.status })
}

// ================================================================ the owner: who may scan

export async function scannersList(guard: OwnerGuard) {
  const actor = await guard()
  const result = await listScanners(actor.authUserId, actor.businessId)
  if (!result.ok) refuse(result.error === 'expired' ? 'denied' : result.error)
  const { ok: _ok, ...body } = result
  return identityJson(body)
}

export async function scannersGrant(guard: OwnerGuard, request: NextRequest) {
  const actor = await guard()
  const body = await readIdentityBody(request, z.object({ staffId: z.string(), branchId: z.string().nullable() }).strict())
  await throttleWrites(actor.authUserId)
  const result = await grantScanner(actor.authUserId, actor.businessId, id(body.staffId), body.branchId === null ? null : id(body.branchId))
  if (!result.ok) refuse(result.error === 'expired' ? 'denied' : result.error)
  return identityJson({ ok: true, status: result.status, grantId: result.grantId }, result.status === 'created' ? 201 : 200)
}

export async function scannersRevoke(guard: OwnerGuard, request: NextRequest, context: Context<'grantId'>) {
  assertSameOrigin(request)
  const { grantId } = await context.params
  const actor = await guard()
  await throttleWrites(actor.authUserId)
  const result = await revokeScanner(actor.authUserId, id(grantId))
  if (!result.ok) refuse(result.error === 'expired' ? 'denied' : result.error)
  return identityJson({ ok: true, status: result.status })
}
