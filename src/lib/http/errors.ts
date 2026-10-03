import { NextResponse } from 'next/server'
import { ZodError } from 'zod'

// One structured error shape for every API route:
//   { error: { code, message, details? } }
// Never leak internal detail (stack traces, SQL errors, table names) in the
// message — log those server-side instead (see lib/observability once
// Phase 2/3 adds it) and return a generic, safe message here.
//
// `details` is optional and ADDITIVE: it carries the few machine-readable facts
// a caller can act on (which line was sold out, which field was rejected). A
// route that never passes it produces exactly the envelope it always did, so
// every pre-existing caller is unaffected. Like `message` it must never carry
// internal detail — and never personal data (the POS routes put a customer's
// phone number nowhere near an error).
export class ApiError extends Error {
  status: number
  code: string
  details?: Record<string, unknown>

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const Unauthorized = (message = 'Sign in required.') =>
  new ApiError(401, 'unauthorized', message)

export const Forbidden = (message = 'You do not have access to do that.') =>
  new ApiError(403, 'forbidden', message)

export const NotFound = (message = 'Not found.') => new ApiError(404, 'not_found', message)

export const BadRequest = (message = 'Invalid request.') =>
  new ApiError(400, 'bad_request', message)

export const RateLimited = (message = 'Too many attempts. Try again shortly.') =>
  new ApiError(429, 'rate_limited', message)

/** The one place an ApiError becomes a response, so the envelope cannot drift
 * between the thrown path and any route that builds a response by hand. */
export function errorResponse(err: ApiError): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    },
    { status: err.status }
  )
}

/** Wrap a Route Handler body so any ApiError (or unexpected throw) becomes
 * the one consistent JSON error shape instead of leaking a raw 500/stack.
 * Forwards whatever arguments Next.js passes a route handler (the request,
 * and a { params } context for dynamic routes) straight through.
 *
 * A ZodError is the CALLER's mistake (a body that does not match its schema),
 * so it is a 400 — not the 500 it used to fall through to, which both blamed
 * the server for a client bug and spammed the error log. Only the failing
 * field PATHS are returned, never the received values. */
export function apiRoute<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err)
      if (err instanceof ZodError) {
        const fields = Array.from(new Set(err.issues.map((issue) => issue.path.join('.') || '(body)'))).slice(0, 12)
        return errorResponse(new ApiError(400, 'bad_request', 'Invalid request.', { fields }))
      }
      console.error('Unhandled API error:', err)
      return NextResponse.json(
        { error: { code: 'internal_error', message: 'Something went wrong.' } },
        { status: 500 }
      )
    }
  }
}
