import 'server-only'

import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { ApiError, BadRequest, Forbidden, RateLimited } from '@/lib/http/errors'
import { checkCredentialRateLimit, checkRateLimit, credentialFingerprint } from '@/lib/rate-limit'

// What every identity route shares: private responses, same-origin JSON bodies, the refusal vocabulary and the throttles.

/** Nothing an identity route answers may be stored or carried elsewhere: not by a browser, a proxy, or a Referer header. */
export const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer' } as const

export const identityJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: PRIVATE_HEADERS })

/** A write must come from our own pages (the middleware already refuses a foreign Origin; this is the second lock, the POS pattern). */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return
  let originHost: string | null = null
  try {
    originHost = new URL(origin).host
  } catch {
    originHost = null
  }
  const host = request.headers.get('host')
  if (!originHost || !host || originHost !== host) throw Forbidden()
}

const MAX_BODY_BYTES = 8 * 1024

/** A small, strict JSON body from our own origin. A form post, a large body or an unknown field is 400; values are never echoed. */
export async function readIdentityBody<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<z.infer<S>> {
  assertSameOrigin(request)
  if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) throw BadRequest()
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw BadRequest()
  let raw: unknown
  try {
    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) throw new Error('too large')
    raw = JSON.parse(text)
  } catch {
    throw BadRequest()
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const fields = Array.from(new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(body)'))).slice(0, 12)
    throw new ApiError(400, 'bad_request', 'Invalid request.', { fields })
  }
  return parsed.data
}

/**
 * A refusal from the database as a response. 'denied' is ONE answer for "not yours", "no such organization / department /
 * invitation" and "not allowed": the caller never learns which. 'conflict' and 'limit' are said only after authority has passed.
 */
export function refuse(error: 'denied' | 'bad_request' | 'conflict' | 'limit'): never {
  if (error === 'bad_request') throw BadRequest()
  if (error === 'conflict') throw new ApiError(409, 'conflict', 'כבר קיים או כבר טופל.')
  if (error === 'limit') throw new ApiError(409, 'limit', 'הגעתם למספר המרבי.')
  throw Forbidden()
}

/** Ordinary writes: blunt abuse, and stay up when the limiter is down (the database still rechecks every actor). */
export async function throttleWrites(authUserId: string) {
  if (!(await checkRateLimit(`identity-write:${credentialFingerprint(authUserId)}`, 120, 3600))) throw RateLimited()
}

/**
 * Anything that makes, trades or spends an invitation token. Fails CLOSED: when the limiter cannot say an attempt is allowed, the
 * attempt is refused (429) and nothing is created or consumed.
 */
export async function throttleCredential(kind: 'invite-create' | 'invite-exchange' | 'invite-status' | 'invite-accept', subject: string, max: number, windowSeconds: number) {
  if (!(await checkCredentialRateLimit(`identity-${kind}:${credentialFingerprint(subject)}`, max, windowSeconds))) throw RateLimited()
}
