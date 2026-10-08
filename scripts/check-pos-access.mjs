import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let checks = 0
const ok = (value, message) => { assert.ok(value, message); checks++ }
const eq = (value, expected, message) => { assert.deepEqual(value, expected, message); checks++ }
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const STAFF = '33333333-3333-4333-8333-333333333333'
const OTHER = '44444444-4444-4444-8444-444444444444'
const SESSION = '55555555-5555-4555-8555-555555555555'
const FOREIGN_SESSION = '66666666-6666-4666-8666-666666666666'
const POINT = '77777777-7777-4777-8777-777777777777'
const FOREIGN_POINT = '88888888-8888-4888-8888-888888888888'
const ORDER = '99999999-9999-4999-8999-999999999999'
const FOREIGN_ORDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
let identity = null
let user = null
let trace = []
const actor = { staff: { id: STAFF }, branch: { id: A }, quick: true, isManager: false }
const rows = {
  branches: [{ id: A, slug: 'event-a', kind: 'event', active: true }, { id: B, slug: 'event-b', kind: 'event', active: true }],
  staff: [{ id: STAFF, branch_id: A, role: 'staff', badge: null, active: true, handle: 'fixture', handle_set_at: '2026-10-01', auth_user_id: null }],
  pos_branch_settings: [{ branch_id: A, enabled: true }, { branch_id: B, enabled: true }],
  pos_sessions: [{ id: SESSION, branch_id: A }, { id: FOREIGN_SESSION, branch_id: B }],
  pos_points: [{ id: POINT, branch_id: A }, { id: FOREIGN_POINT, branch_id: B }],
  pos_orders: [{ id: ORDER, branch_id: A, session_id: SESSION, ticket_no: 12 }, { id: FOREIGN_ORDER, branch_id: B, session_id: FOREIGN_SESSION, ticket_no: 13 }],
  pos_events: [{ id: 'event-a', branch_id: A, session_id: SESSION, order_id: ORDER }, { id: 'event-b', branch_id: B, session_id: FOREIGN_SESSION, order_id: FOREIGN_ORDER }],
  pos_order_items: [{ id: 'item-a', branch_id: A, point_id: POINT, status: 'delivered', pos_orders: { branch_id: A, session_id: SESSION } }, { id: 'item-b', branch_id: B, point_id: FOREIGN_POINT, status: 'delivered', pos_orders: { branch_id: B, session_id: FOREIGN_SESSION } }],
  pos_point_checkins: [{ id: 'own', branch_id: A, session_id: SESSION, point_id: POINT, staff_id: STAFF }, { id: 'peer', branch_id: A, session_id: SESSION, point_id: POINT, staff_id: OTHER }, { id: 'foreign', branch_id: B, session_id: FOREIGN_SESSION, point_id: FOREIGN_POINT, staff_id: STAFF }],
}
const nested = (row, key) => key.split('.').reduce((value, part) => value?.[part], row)
class Query {
  constructor(table) { this.table = table; this.filters = []; this.cap = null; this.single = false; trace.push(this) }
  select() { return this }
  eq(key, value) { this.filters.push([key, value]); return this }
  lt(key, value) { this.filters.push([key, value, 'lt']); return this }
  order() { return this }
  or() { return this }
  limit(n) { this.cap = n; return this }
  range(from, to) { this.cap = to - from + 1; return this }
  maybeSingle() { this.single = true; return this }
  then(resolve, reject) {
    let data = (rows[this.table] ?? []).filter((row) => this.filters.every(([key, value, op]) => op === 'lt' ? nested(row, key) < value : nested(row, key) === value))
    if (this.cap !== null) data = data.slice(0, this.cap)
    return Promise.resolve({ data: this.single ? data[0] ?? null : data, error: null }).then(resolve, reject)
  }
}
const service = { from: (table) => new Query(table) }
const load = (relative, overrides = {}) => {
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in overrides) return overrides[name]
    if (name === 'server-only') return {}
    return require(name)
  }, module, module.exports)
  return module.exports
}
class ApiError extends Error { constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details } }
const access = load('src/lib/staff/access.ts')
const guard = load('src/lib/pos/server/guard.ts', {
  'next/server': { NextResponse: { json: (body) => body } },
  '@/lib/http/errors': { ApiError },
  '@/lib/rate-limit': { checkRateLimit: async () => true },
  '@/lib/supabase/server': { createServiceRoleClient: () => service, createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) },
  '@/lib/staff/access': access,
  '@/lib/staff/session': { resolveStaffIdentity: async () => identity },
})
const columns = load('src/lib/pos/columns.ts')
const read = load('src/lib/pos/server/read.ts', { '@/lib/supabase/server': { createServiceRoleClient: () => service }, '@/lib/pos/columns': columns, './guard': guard })
const schema = load('src/lib/pos/api.ts').posReadQuery
const rejects = async (run, code) => { await assert.rejects(run, (error) => error.code === code); checks++ }

identity = { id: STAFF, via: 'employee_code', quick: true }
let resolved = await guard.resolvePosIdentity()
eq(resolved.staff.codeOnly, true, 'An opaque cookie selects API reads')
eq(resolved.staff.quick, true, 'An opaque cookie keeps floor assurance')
eq(resolved.staff.auth_user_id, null, 'No Google identity is fabricated')
await rejects(() => guard.requirePosManager(A), 'forbidden')
await rejects(() => guard.requirePosStaff(B), 'forbidden')
const floor = await guard.requirePosStaff(A)
eq(floor.staff.id, STAFF, 'The actor comes from the resolved cookie')
eq(floor.isManager, false, 'The floor actor has no manager permission')
identity = { id: STAFF, via: 'google', quick: true }
resolved = await guard.resolvePosIdentity()
eq(resolved.staff.codeOnly, false, 'Legacy quick JWTs can keep authenticated browser reads')
eq(resolved.staff.quick, true, 'Legacy quick JWTs remain floor-only')
identity = { id: STAFF, via: 'google', quick: false }
rows.staff[0].role = 'owner'
resolved = await guard.resolvePosIdentity()
eq(resolved.staff.quick, false, 'A full Google session stays full')
eq((await guard.requirePosManager(A)).isManager, true, 'Only a full owner may manage')
rows.staff[0].active = false
await rejects(() => guard.requirePosIdentity(), 'forbidden')
rows.staff[0].active = true
identity = null
user = null
eq((await guard.resolvePosIdentity()).signedIn, false, 'No cookie or Google user is anonymous')
user = { id: OTHER }
eq((await guard.resolvePosIdentity()).staff, null, 'A signed-in visitor does not become staff')

ok(schema.safeParse({ kind: 'live', branch: A, session: SESSION }).success, 'A valid live selector parses')
ok(!schema.safeParse({ kind: 'live', branch: A, session: SESSION, staff: OTHER }).success, 'Actor spoofing is rejected')
ok(!schema.safeParse({ kind: 'sql', branch: A, table: 'staff' }).success, 'Arbitrary table reads are impossible')
ok(!schema.safeParse({ kind: 'point_history', branch: A, session: SESSION, point: POINT, limit: '601' }).success, 'History reads have a hard bound')
ok(!schema.safeParse({ kind: 'orders', branch: A, session: SESSION, before: '1.or.true' }).success, 'Filter injection is rejected')
await rejects(() => read.readPosData({ kind: 'live', branch: B, session: FOREIGN_SESSION }, actor), 'forbidden')
await rejects(() => read.readPosData({ kind: 'live', branch: A, session: FOREIGN_SESSION }, actor), 'not_found')
await rejects(() => read.readPosData({ kind: 'point_history', branch: A, session: SESSION, point: FOREIGN_POINT, limit: 60 }, actor), 'not_found')
eq((await read.readPosData({ kind: 'live', branch: A, session: SESSION }, actor)).map((row) => row.id), [ORDER], 'Live orders cannot leave the branch and session')
eq(await read.readPosData({ kind: 'order', branch: A, order: FOREIGN_ORDER }, actor), null, 'A foreign order does not reveal existence')
await rejects(() => read.readPosData({ kind: 'order_events', branch: A, order: FOREIGN_ORDER }, actor), 'not_found')
eq((await read.readPosData({ kind: 'order_events', branch: A, order: ORDER }, actor)).map((row) => row.id), ['event-a'], 'Audit rows are bound to the authorized order and its session')
eq((await read.readPosData({ kind: 'point_history', branch: A, session: SESSION, point: POINT, limit: 60 }, actor)).map((row) => row.id), ['item-a'], 'Station history stays within its point and session')
eq((await read.readPosData({ kind: 'checkin', branch: A, session: SESSION, point: POINT }, actor)).map((row) => row.id), ['own'], 'Presence reads can only name the current actor')
eq(await read.readPosData({ kind: 'checkin', branch: A, point: POINT }, actor), [], 'No active session does not read a different event')
trace = []
await read.readPosData({ kind: 'orders', branch: A, session: SESSION, before: 12 }, actor)
const page = trace.find((query) => query.table === 'pos_orders')
eq(page.cap, 40, 'Paging has a server-defined page size')
ok(page.filters.some(([key, value, op]) => key === 'ticket_no' && value === 12 && op === 'lt'), 'The validated ticket cursor is applied')
rows.pos_point_staff = [{ staff_id: STAFF, pos_points: { branch_id: B, active: true, branches: { kind: 'event', active: true } } }]
identity = { id: STAFF, via: 'employee_code', quick: true }
rows.staff[0].role = 'staff'
const eventMember = await guard.resolvePosIdentity()
eq(eventMember.staff.eventBranchIds, [B], 'Owner-assigned active event stations create explicit event membership')
const eventFloor = await guard.requirePosStaff(B)
eq(eventFloor.branch.id, B, 'Regular branch employee can work an explicitly assigned event')
eq(eventFloor.isManager, false, 'Station assignment never grants event management')
rows.pos_point_staff[0].pos_points.active = false
eq((await guard.resolvePosIdentity()).staff.eventBranchIds, [], 'Deactivated station immediately loses event membership')
await rejects(() => guard.requirePosStaff(B), 'forbidden')
rows.pos_point_staff[0].pos_points.active = true
rows.pos_point_staff[0].pos_points.branches.kind = 'permanent'
eq((await guard.resolvePosIdentity()).staff.eventBranchIds, [], 'Station membership never opens an unrelated permanent branch')
console.log(`POS access checks: ${checks} passed`)
