import { NextResponse } from 'next/server'

// One structured error shape for every API route: { error: { code, message } }.
// Never leak internal detail (stack traces, SQL errors, table names) in the
// message — log those server-side instead (see lib/observability once
// Phase 2/3 adds it) and return a generic, safe message here.
export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
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

/** Wrap a Route Handler body so any ApiError (or unexpected throw) becomes
 * the one consistent JSON error shape instead of leaking a raw 500/stack.
 * Forwards whatever arguments Next.js passes a route handler (the request,
 * and a { params } context for dynamic routes) straight through. */
export function apiRoute<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status })
      }
      console.error('Unhandled API error:', err)
      return NextResponse.json(
        { error: { code: 'internal_error', message: 'Something went wrong.' } },
        { status: 500 }
      )
    }
  }
}
