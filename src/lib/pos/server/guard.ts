// The POS's server-side guards, and the small amount of plumbing every /api/pos
// route shares (errors in plain language, body parsing, rate limiting, RPC calls).
//
// IDENTITY IS RESOLVED IN EXACTLY ONE PLACE — resolvePosIdentity() below
// (blueprint §1a.5). Every guard in this file, the /pos page and the bootstrap
// all go through it: the signed-in Google session -> the ACTIVE `staff` row, read
// with the service-role client (`staff` has no select policy for a browser, on
// purpose). Nothing else in the POS may decide "who is this" — not a request body,
// not a header, not a cookie that names a person. That single seam is what lets a
// future fast-PIN operator switch (a shared tablet) be added by changing this one
// function and a small PIN table, without touching a route, an RPC or a screen.
//
// Authorisation is layered on top, never mixed into identity:
//   requirePosIdentity()    — somebody who is active staff. (No branch, no nickname.)
//   requirePosStaff(branch) — + may work that branch + the POS is switched on there
//                             + has CONFIRMED a nickname. Used by every staff route.
//   requirePosManager(branch) — OP, or a general manager scoped to the branch
//                             (canEditMenu). For /api/owner/pos/* and manager-only acts.
//
// The service-role client is used here and in the rest of lib/pos/server ONLY
// after one of those guards has run (or, for the public board, after its token
// has been compared) — it has no notion of "who is asking".

import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { ApiError } from '@/lib/http/errors'
import { checkRateLimit } from '@/lib/rate-limit'
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server'
import { canEditMenu, isOp, type AccessRow } from '@/lib/staff/access'
import type { BranchLite } from '@/lib/pos/api'
import type { PosErrorCode } from '@/lib/pos/types'
import { isQuickSessionId, validatedSessionId } from './quick-login'

// ======================================================================================
// Errors in plain language
// ======================================================================================
// Employees never read `code` — the UI maps each code to its own words. The
// `message` is the fallback a screen shows if it does not know a code, so it is
// written for a cashier, not a developer: no UUIDs, no "session", no status names,
// no "permission". Hebrew first, English after the slash.

const STATUS: Record<PosErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  needs_handle: 409,
  not_enabled: 409,
  no_session: 409,
  bad_request: 400,
  bad_customer: 400,
  bad_line: 400,
  bad_point: 400,
  bad_reason: 400,
  not_found: 404,
  order_void: 409,
  rate_limited: 429,
  internal_error: 500,
  conflict: 409,
  // a line that cannot be priced / routed (lib/pos/types.ts LineProblemCode).
  // 409 = the menu moved under the cashier (they can fix it by choosing again);
  // 422 = the request was well-formed but cannot be sold as asked; 400 = malformed.
  unknown_item: 422,
  sold_out: 409,
  no_point: 422,
  not_sold: 422,
  no_price: 422,
  needs_price_choice: 422,
  unknown_type: 422,
  type_sold_out: 409,
  needs_type: 422,
  unknown_modifier: 422,
  modifier_unavailable: 409,
  modifier_required: 422,
  modifier_too_many: 422,
  modifier_too_few: 422,
  modifier_qty: 422,
  bad_qty: 400,
  bad_custom: 400,
}

type Words = { he: string; en: string }

const TEXT: Record<PosErrorCode, Words> = {
  unauthorized: { he: 'צריך להתחבר מחדש', en: 'Please sign in again' },
  forbidden: { he: 'הפעולה הזאת לא זמינה לך', en: "That action isn't available to you" },
  needs_handle: { he: 'קודם בוחרים כינוי', en: 'Choose a nickname first' },
  not_enabled: { he: 'הקופה עדיין לא פועלת באירוע הזה', en: "The register isn't switched on for this event yet" },
  no_session: { he: 'האירוע סגור כרגע, אי אפשר לפתוח הזמנה חדשה', en: "The event is closed, so a new order can't be started" },
  bad_request: { he: 'משהו בבקשה לא תקין, נסו שוב', en: "Something in that request wasn't right, try again" },
  bad_customer: { he: 'שם הלקוח או הטלפון לא תקינים', en: "The customer's name or phone isn't valid" },
  bad_line: { he: 'אחד הפריטים בהזמנה לא תקין', en: "One of the items isn't valid" },
  bad_point: { he: 'העמדה שנבחרה לא זמינה יותר', en: "That selling point isn't available any more" },
  bad_reason: { he: 'צריך לכתוב סיבה קצרה', en: 'Please give a short reason' },
  not_found: { he: 'לא מצאנו את מה שחיפשת', en: "We couldn't find that" },
  order_void: { he: 'ההזמנה הזאת כבר בוטלה', en: 'That order was already cancelled' },
  rate_limited: { he: 'יותר מדי פעולות בבת אחת, חכו רגע ונסו שוב', en: 'Too many actions at once, wait a moment and try again' },
  internal_error: { he: 'משהו השתבש אצלנו, נסו שוב', en: 'Something went wrong on our side, try again' },
  conflict: { he: 'מישהו אחר כבר טיפל בזה', en: 'Someone else got there first' },
  unknown_item: { he: 'הפריט הוסר מהתפריט', en: 'That item is no longer on the menu' },
  sold_out: { he: 'הפריט אזל', en: 'That item is sold out' },
  no_point: { he: 'אף עמדה לא מכינה את הפריט הזה', en: 'No selling point makes this item' },
  not_sold: { he: 'הפריט הזה לא נמכר באירוע', en: "This item isn't sold at this event" },
  no_price: { he: 'לפריט הזה אין מחיר', en: 'This item has no price' },
  needs_price_choice: { he: 'צריך לבחור מחיר', en: 'Choose a price' },
  unknown_type: { he: 'הסוג שנבחר לא קיים', en: "That option doesn't exist" },
  type_sold_out: { he: 'הסוג שנבחר אזל', en: 'That option is sold out' },
  needs_type: { he: 'צריך לבחור סוג', en: 'Choose an option' },
  unknown_modifier: { he: 'אחת ההתאמות כבר לא קיימת', en: "One of the extras isn't available any more" },
  modifier_unavailable: { he: 'אחת ההתאמות אזלה', en: 'One of the extras is sold out' },
  modifier_required: { he: 'חסרה בחירה שחובה לעשות', en: 'A required choice is missing' },
  modifier_too_many: { he: 'נבחרו יותר מדי התאמות', en: 'Too many extras were chosen' },
  modifier_too_few: { he: 'נבחרו מעט מדי התאמות', en: 'Not enough extras were chosen' },
  modifier_qty: { he: 'הכמות של אחת ההתאמות לא תקינה', en: 'One extra has the wrong quantity' },
  bad_qty: { he: 'הכמות לא תקינה', en: "The quantity isn't valid" },
  bad_custom: { he: 'הפריט האחר לא תקין, בדקו שם ומחיר', en: "That custom item isn't valid, check its name and price" },
}

/** The one constructor for every error a /api/pos route throws. */
export function posError(code: PosErrorCode, details?: Record<string, unknown>, words?: Words): ApiError {
  const t = words ?? TEXT[code]
  return new ApiError(STATUS[code], code, `${t.he} / ${t.en}`, details)
}

/** A JSON response that no cache — browser, CDN or proxy — may keep: staff data
 *  carries customer names and phone numbers. */
export function posJson<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// ======================================================================================
// Request plumbing
// ======================================================================================

const MAX_BODY_BYTES = 131_072 // 60 lines x 24 modifiers is a few KB; this is a ceiling, not a target

/** A state-changing request must come from this app's own pages. SameSite=Lax
 *  cookies already stop a cross-site POST carrying the session; this is the second
 *  lock, the same one the public feedback route uses. */
function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return
  let originHost: string | null = null
  try {
    originHost = new URL(origin).host
  } catch {
    originHost = null
  }
  const host = request.headers.get('host')
  if (!originHost || !host || originHost !== host) throw posError('forbidden')
}

/**
 * Reads and validates a JSON body. Every schema in lib/pos/api.ts is `.strict()`,
 * so a field the route did not expect — an actor, a price — is a 400 rather than
 * something silently ignored (or worse, spread into a write). A malformed or
 * oversized body is also a 400, never a 500.
 */
export async function parseBody<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<z.infer<S>> {
  assertSameOrigin(request)
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) throw posError('bad_request', { reason: 'content_type' })
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw posError('bad_request', { reason: 'too_large' })

  let text: string
  try {
    text = await request.text()
  } catch {
    throw posError('bad_request')
  }
  if (text.length > MAX_BODY_BYTES) throw posError('bad_request', { reason: 'too_large' })

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw posError('bad_request')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    // Paths only — never the received values (a body may contain a phone number).
    const fields = Array.from(new Set(parsed.error.issues.map((i) => i.path.join('.') || '(body)'))).slice(0, 12)
    throw posError('bad_request', { fields })
  }
  return parsed.data
}

/** Validates a query-string object (GET routes). */
export function parseQuery<S extends z.ZodTypeAny>(url: URL, schema: S): z.infer<S> {
  const raw: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    raw[key] = value
  })
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const fields = Array.from(new Set(parsed.error.issues.map((i) => i.path.join('.') || '(query)'))).slice(0, 12)
    throw posError('bad_request', { fields })
  }
  return parsed.data
}

/** Per-person rate limit. Fail-OPEN like the limiter itself: a limiter outage must
 *  never stop a cashier typing in an order somebody has already paid for. */
export async function rateLimit(scope: string, staffId: string, max: number, windowSeconds = 60): Promise<void> {
  if (!(await checkRateLimit(`pos:${scope}:${staffId}`, max, windowSeconds))) throw posError('rate_limited')
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s)

// ======================================================================================
// Calling the database functions
// ======================================================================================

/** A database message that is safe to write to a log: capped, and with anything that looks
 *  like a phone number (a run of 7+ digits, however it is spaced) blanked out — belt and
 *  braces, since the message should never carry row data in the first place. */
export function safeLogMessage(message: unknown): string {
  return String(message ?? '')
    .replace(/\+?\d[\d\s()-]{5,}\d/g, '[number]')
    .slice(0, 200)
}

/**
 * Calls one pos_* function (executable by service_role only) and returns its jsonb
 * result. A transport/SQL failure is a 500 with nothing in it; the log line carries
 * the function name, the SQLSTATE and a short message — NEVER `details` or `hint`,
 * because Postgres puts the whole failing row (phone included) in a constraint
 * violation's DETAIL.
 */
export async function callPosRpc<T extends Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
  const service = createServiceRoleClient()
  const { data, error } = await service.rpc(fn, args)
  if (error) {
    console.error(`pos rpc ${fn} failed:`, error.code, safeLogMessage(error.message))
    throw posError('internal_error')
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    console.error(`pos rpc ${fn} returned an unexpected shape`)
    throw posError('internal_error')
  }
  return data as T
}

const RPC_REASON: Record<string, PosErrorCode> = {
  no_session: 'no_session',
  bad_customer: 'bad_customer',
  bad_line: 'bad_line',
  bad_point: 'bad_point',
  bad_reason: 'bad_reason',
  not_found: 'not_found',
  order_void: 'order_void',
  // the actor was deactivated between the guard and the write
  no_actor: 'forbidden',
}

/** An RPC's `{ok:false, reason}` -> the same-coded ApiError. */
export function rpcFailure(reason: unknown, details?: Record<string, unknown>): ApiError {
  const code = typeof reason === 'string' ? RPC_REASON[reason] : undefined
  if (code) return posError(code, details)
  if (typeof reason === 'string' && /^(bad_|invalid)/.test(reason)) return posError('bad_request', { ...details, reason })
  console.error('pos rpc refused with an unmapped reason:', typeof reason === 'string' ? reason : typeof reason)
  return posError('internal_error')
}

// ======================================================================================
// Identity
// ======================================================================================

export type PosStaffRow = AccessRow & {
  id: string
  auth_user_id: string
  email: string | null
  display_name: string | null
  handle: string
  /** null = the system picked the nickname; the person has not confirmed it yet */
  handle_set_at: string | null
  colour: string | null
  /** This session was opened with employee number + passcode (migration 016): floor work only. Set by resolvePosIdentity. */
  quick?: boolean
}

const STAFF_COLUMNS = 'id, auth_user_id, role, badge, branch_id, active, email, display_name, handle, handle_set_at, colour'

/**
 * THE one place the POS decides who is calling. Never throws for "nobody": the
 * /pos page turns that into a redirect, the API guards into a 401/403.
 *
 * `active = true` is part of the lookup: a removed person's row survives (history
 * still points at it) but resolves to nobody, exactly as in lib/staff/guard.ts.
 */
export async function resolvePosIdentity(): Promise<{ signedIn: boolean; staff: PosStaffRow | null }> {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { signedIn: false, staff: null }

  const service = createServiceRoleClient()
  // The quick-session lookup rides along with the staff read: one extra round trip in
  // parallel, not in series, on the hot path of every write.
  const [{ data, error }, quick] = await Promise.all([
    service.from('staff').select(STAFF_COLUMNS).eq('auth_user_id', user.id).eq('active', true).maybeSingle(),
    // A failed lookup throws -> 500. Never guess "full" when we could not tell.
    validatedSessionId(supabase).then(isQuickSessionId).catch(() => {
      console.error('quick session lookup failed')
      throw posError('internal_error')
    }),
  ])
  // A failed read is an outage, not "this person is nobody": answering 403 (or sending a
  // real staff member to /no-access) over a database blip would be a confident wrong answer.
  if (error) {
    console.error('staff identity read failed:', error.code)
    throw posError('internal_error')
  }
  const row = (data as unknown as PosStaffRow | null) ?? null
  return { signedIn: true, staff: row ? { ...row, quick } : null }
}

/** Active staff, nothing more. (The nickname route and the bootstrap start here.) */
export async function requirePosIdentity(): Promise<PosStaffRow> {
  const { signedIn, staff } = await resolvePosIdentity()
  if (!signedIn) throw posError('unauthorized')
  if (!staff) throw posError('forbidden')
  return staff
}

export type PosActor = {
  staff: {
    id: string
    handle: string
    handleConfirmed: boolean
    colour: string | null
    role: string | null
    badge: string | null
    branch_id: string | null
    email: string | null
    display_name: string | null
  }
  branch: BranchLite
  /** OP, or a general manager of THIS branch — may configure, see stats, void delivered lines.
   *  ALWAYS false for a quick-login session (second-class by construction, blueprint §1a.5). */
  isManager: boolean
  /** The session was opened with employee number + passcode, not Google. */
  quick: boolean
}

function toActor(row: PosStaffRow, branch: BranchLite): PosActor {
  return {
    staff: {
      id: row.id,
      handle: row.handle,
      handleConfirmed: row.handle_set_at !== null && row.handle_set_at !== undefined,
      colour: row.colour ?? null,
      role: row.role ?? null,
      badge: row.badge ?? null,
      branch_id: row.branch_id ?? null,
      email: row.email ?? null,
      display_name: row.display_name ?? null,
    },
    branch,
    isManager: row.quick !== true && canEditMenu(row, branch.id),
    quick: row.quick === true,
  }
}

/** The manager rule in one named place: OP, or a general manager scoped to the
 *  branch. A twin of is_menu_editor() in SQL — change both together (lib/staff/access.ts). */
export function canManagePos(row: AccessRow | null | undefined, branchId: string): boolean {
  return canEditMenu(row, branchId)
}

/** staff.branch_id null = every branch, else it must equal. An OP is never
 *  branch-scoped (lib/staff/access.ts: "a true owner has full access to every
 *  branch by definition"), so an owner row that happens to carry a branch_id is not
 *  locked out of an event. */
export function canAccessBranch(row: AccessRow | null | undefined, branchId: string): boolean {
  if (!row) return false
  if (isOp(row)) return true
  return row.branch_id === null || row.branch_id === undefined || row.branch_id === branchId
}

/** An active branch, by slug or uuid. null when it does not exist (or is switched off). */
export async function loadBranch(ref: string): Promise<BranchLite | null> {
  const service = createServiceRoleClient()
  const { data, error } = await service
    .from('branches')
    .select('id, slug, name, kind')
    .eq(isUuid(ref) ? 'id' : 'slug', ref)
    .eq('active', true)
    .maybeSingle()
  if (error) {
    console.error('branches read failed:', error.code)
    throw posError('internal_error')
  }
  if (!data) return null
  const row = data as unknown as { id: string; slug: string; name: BranchLite['name'] | null; kind: string | null }
  return { id: row.id, slug: row.slug, name: row.name ?? { he: row.slug }, kind: row.kind === 'event' ? 'event' : 'permanent' }
}

async function branchIsEnabled(branchId: string): Promise<boolean> {
  const service = createServiceRoleClient()
  const { data, error } = await service.from('pos_branch_settings').select('enabled').eq('branch_id', branchId).maybeSingle()
  if (error) {
    console.error('pos_branch_settings read failed:', error.code)
    throw posError('internal_error')
  }
  return (data as { enabled?: boolean } | null)?.enabled === true
}

export type StaffGuardOptions = {
  /** Skip the "has confirmed a nickname" check. Only the nickname route and the bootstrap (which REPORTS it) set this. */
  requireHandle?: boolean
  /**
   * Skip the "POS is switched on for this branch" check. Set by the cleanup routes
   * (advance, void, edit): blueprint §7.5 — gate only NEW work, never cleanup. If an
   * owner switches the POS off with tickets still on a screen, the staff must still
   * be able to finish them; otherwise the lines are stranded until it is switched on.
   */
  requireEnabled?: boolean
}

/** Branch-level authorisation for an identity that has already been resolved. */
export async function authorizePosBranch(
  row: PosStaffRow,
  branchRef: string,
  opts: StaffGuardOptions = {}
): Promise<PosActor> {
  const needEnabled = opts.requireEnabled !== false
  // Two independent reads on the hot path of every write: when the ref is already the
  // branch's id they can run together (a slug has to be resolved to an id first).
  const [branch, enabledEarly] = await Promise.all([
    loadBranch(branchRef),
    needEnabled && isUuid(branchRef) ? branchIsEnabled(branchRef) : Promise.resolve<boolean | null>(null),
  ])
  if (!branch) throw posError('not_found')
  if (!canAccessBranch(row, branch.id)) throw posError('forbidden')
  if (needEnabled) {
    const enabled = enabledEarly ?? (await branchIsEnabled(branch.id))
    if (!enabled) throw posError('not_enabled')
  }
  if (opts.requireHandle !== false && !row.handle_set_at) throw posError('needs_handle')
  return toActor(row, branch)
}

/**
 * The guard for every staff route: identity -> may work this branch -> the POS is
 * on there -> the nickname is confirmed. `branchRef` is a SELECTOR the guard
 * validates (slug or uuid), never a claim it believes.
 */
export async function requirePosStaff(branchRef: string, opts: StaffGuardOptions = {}): Promise<PosActor> {
  const row = await requirePosIdentity()
  return authorizePosBranch(row, branchRef, opts)
}

/**
 * For a route whose body names a selling point rather than a branch (check-in):
 * the branch is whatever the point belongs to. The point is looked up only AFTER
 * the caller is known to be active staff, so an anonymous request cannot probe
 * which point ids exist.
 */
export async function requirePosStaffForPoint(pointId: string, opts: StaffGuardOptions = {}): Promise<PosActor & { point: { id: string; name: string } }> {
  const row = await requirePosIdentity()
  const service = createServiceRoleClient()
  const { data } = await service.from('pos_points').select('id, name, branch_id').eq('id', pointId).eq('active', true).maybeSingle()
  const point = data as unknown as { id: string; name: string; branch_id: string } | null
  if (!point) throw posError('not_found')
  const actor = await authorizePosBranch(row, point.branch_id, opts)
  return { ...actor, point: { id: point.id, name: point.name } }
}

/**
 * Manager-only: OP, or a general manager scoped to the branch. Deliberately does
 * NOT require the POS to be switched on (the setup wizard is what switches it on)
 * nor a confirmed nickname (a manager configuring the event is not on a till).
 */
export async function requirePosManager(branchRef: string): Promise<PosActor> {
  const row = await requirePosIdentity()
  // A passcode is too weak a secret for a manager-only act, however privileged the
  // person is: the same refusal as not being a manager at all.
  if (row.quick) throw posError('forbidden')
  const branch = await loadBranch(branchRef)
  if (!branch) throw posError('not_found')
  if (!canManagePos(row, branch.id)) throw posError('forbidden')
  return toActor(row, branch)
}

// ======================================================================================
// Ids that arrive in a URL
// ======================================================================================

/**
 * An order that lives in THIS branch, else 404. The pos_* functions take an order id
 * and trust it: they do not know which branch the caller was authorised for. So every
 * route that receives an order id proves it is inside the branch the guard approved
 * before passing it on — otherwise a person cleared for one event could edit, void or
 * add to another event's order just by knowing its id. A foreign id gets the very same
 * 404 as a missing one, so the answer does not even confirm that it exists.
 */
export async function loadOrderInBranch<T extends Record<string, unknown>>(
  orderId: string,
  branchId: string,
  columns: string
): Promise<T & { branch_id: string }> {
  if (!isUuid(orderId)) throw posError('not_found')
  const service = createServiceRoleClient()
  const { data, error } = await service.from('pos_orders').select(`branch_id, ${columns}`).eq('id', orderId).maybeSingle()
  if (error) {
    console.error('pos_orders read failed:', error.code)
    throw posError('internal_error')
  }
  const row = data as unknown as (T & { branch_id: string }) | null
  if (!row || row.branch_id !== branchId) throw posError('not_found')
  return row
}
