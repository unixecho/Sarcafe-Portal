'use client'

// Typed fetch wrappers over the staff API (/api/pos/*). Browser-only.
//
// The rules, each of which exists because the alternative loses an order:
//
//  - It NEVER throws. A dropped Wi-Fi, a 15 s hang, a captive-portal page that
//    answers 200 with HTML — all of them come back as { ok:false, code:'network' }
//    so the caller has exactly one failure path to handle, and so the outbox can
//    treat "the server never saw this" as retryable without a try/catch around
//    every call site.
//  - A 2xx whose body is not our JSON is a NETWORK failure, not a success: event
//    Wi-Fi often sits behind a captive portal that answers every request with
//    a 200 login page. Believing it would mark a paid-for order as sent.
//  - Request bodies are never logged — they carry a customer's phone number, and
//    there is not a single console.* call in this file on purpose.
//  - Errors arrive in the one envelope of lib/http/errors.ts
//    ({ error: { code, message, details? } }). `code` is for the UI to map to plain
//    language; `message` is the server's own staff-safe fallback (Hebrew / English), for a
//    screen that meets a code it has no words for. Failures raised HERE use the same style.
//  - The actor is never sent. Identity is the session cookie; no body or query
//    string here carries who the caller is.

import type {
  AddItemsBody, AddItemsResponse, AdvanceBody, AdvanceResponse, BootstrapResponse, CheckinBody, CheckinResponse,
  CreateOrderBody, CreateOrderResponse, EditOrderBody, EditOrderResponse, HandleBody, HandleResponse, MenuResponse,
  VoidBody, VoidResponse,
} from './api'
import type { PosErrorCode } from './types'

// What a failure raised in this file says. Same style as the server's messages: Hebrew first,
// English after the slash, no technical words — a screen may show them as its fallback.
const MSG_NO_CONNECTION = 'אין חיבור כרגע / No connection right now'
const MSG_SIGN_IN = 'צריך להתחבר מחדש / Please sign in again'
const MSG_WENT_WRONG = 'משהו השתבש, נסו שוב / Something went wrong, try again'

/** Long enough for a slow tablet on event Wi-Fi, short enough that a dead socket frees the register. */
const REQUEST_TIMEOUT_MS = 15_000

export type ApiFailure = {
  ok: false
  /** HTTP status; 0 when the request never got an answer (offline, timeout, unreadable reply). */
  status: number
  code: PosErrorCode | 'network'
  message: string
  details?: Record<string, unknown>
}
export type ApiResult<T> = { ok: true; data: T } | ApiFailure

function failure(status: number, code: ApiFailure['code'], message: string, details?: Record<string, unknown>): ApiFailure {
  return details ? { ok: false, status, code, message, details } : { ok: false, status, code, message }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** When a reply is not our envelope (a proxy's HTML 502, a WAF page) the status line is all we have. */
function codeForStatus(status: number): PosErrorCode {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'internal_error'
  return 'bad_request'
}

/**
 * Turn a finished HTTP exchange into an ApiResult. Pure, so the envelope handling
 * (the part that decides retry-or-stop) is testable without a network.
 *
 * `redirectedToLogin`: fetch follows redirects, so an expired session that gets
 * bounced to /login would otherwise read as a 200 HTML page. That is "sign in
 * again", not "the network is flaky" — retrying it forever helps nobody.
 */
export function interpretResponse<T>(status: number, text: string, redirectedToLogin = false): ApiResult<T> {
  if (redirectedToLogin) return failure(401, 'unauthorized', MSG_SIGN_IN)

  let body: unknown
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }
  }

  if (status >= 200 && status < 300) {
    if (isRecord(body)) return { ok: true, data: body as T }
    return failure(0, 'network', MSG_NO_CONNECTION)
  }

  const env = isRecord(body) && isRecord(body.error) ? body.error : null
  const code = env && typeof env.code === 'string' && env.code ? (env.code as PosErrorCode) : codeForStatus(status)
  const message = env && typeof env.message === 'string' ? env.message : MSG_WENT_WRONG
  const details = env && isRecord(env.details) ? env.details : undefined
  return failure(status, code, message, details)
}

function isLoginUrl(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith('/login')
  } catch {
    return false
  }
}

async function request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<ApiResult<T>> {
  if (typeof window === 'undefined') return failure(0, 'network', MSG_NO_CONNECTION)
  const controller = new AbortController()
  // The abort covers reading the body too, so a reply that stalls half-way still frees the caller.
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const hasBody = body !== undefined
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      headers: hasBody ? { accept: 'application/json', 'content-type': 'application/json' } : { accept: 'application/json' },
      body: hasBody ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    return interpretResponse<T>(res.status, text, res.redirected && isLoginUrl(res.url))
  } catch {
    return failure(0, 'network', MSG_NO_CONNECTION)
  } finally {
    clearTimeout(timer)
  }
}

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v)
  const s = q.toString()
  return s ? `${path}?${s}` : path
}

const enc = encodeURIComponent

export const posApi = {
  bootstrap: (branch?: string) => request<BootstrapResponse>('GET', withQuery('/api/pos/bootstrap', { branch })),
  /** `since` is the last stamp the caller holds; an unchanged menu answers { unchanged: true } and costs almost nothing. */
  menu: (branch: string, since?: string) => request<MenuResponse>('GET', withQuery('/api/pos/menu', { branch, since })),
  createOrder: (body: CreateOrderBody) => request<CreateOrderResponse>('POST', '/api/pos/orders', body),
  addItems: (orderId: string, body: AddItemsBody) =>
    request<AddItemsResponse>('POST', `/api/pos/orders/${enc(orderId)}/items`, body),
  editOrder: (orderId: string, body: EditOrderBody) =>
    request<EditOrderResponse>('PATCH', `/api/pos/orders/${enc(orderId)}`, body),
  voidItems: (orderId: string, body: VoidBody) =>
    request<VoidResponse>('POST', `/api/pos/orders/${enc(orderId)}/void`, body),
  advance: (body: AdvanceBody) => request<AdvanceResponse>('POST', '/api/pos/items/advance', body),
  checkin: (body: CheckinBody) => request<CheckinResponse>('POST', '/api/pos/checkin', body),
  setHandle: (body: HandleBody) => request<HandleResponse>('POST', '/api/pos/handle', body),
}
