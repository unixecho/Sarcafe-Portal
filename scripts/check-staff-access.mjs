// Isolated route verification: real request validation and response wrappers,
// fixture identity/database/storage; never production staff data or credentials.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { NextRequest } = require('next/server')
const load = (relative, overrides = {}) => {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)((name) => name in overrides ? overrides[name] : name === 'server-only' ? {} : require(name), module, module.exports)
  return module.exports
}
let checks = 0
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++ }
const STAFF = '11111111-1111-4111-8111-111111111111'
const PEER = '22222222-2222-4222-8222-222222222222'
const SLIP = '33333333-3333-4333-8333-333333333333'
const PEER_SLIP = '44444444-4444-4444-8444-444444444444'
let me = null
let trace = []
let failTable = null
let rejectInsert = false
let calls = []
let rows = {}
class Query {
  constructor(table) { this.table = table; this.filters = []; this.single = false; this.mode = 'read'; trace.push(this) }
  select(_columns, opts) { this.head = opts?.head; return this }
  eq(key, value) { this.filters.push((row) => row[key] === value); return this }
  is(key, value) { this.filters.push((row) => row[key] === value); return this }
  in(key, values) { this.filters.push((row) => values.includes(row[key])); return this }
  not(key, _op, value) { this.filters.push((row) => row[key] !== value); return this }
  order() { return this }
  limit(n) { this.cap = n; return this }
  maybeSingle() { this.single = true; return this }
  update(value) { this.mode = 'update'; this.value = value; return this }
  insert(value) { this.mode = 'insert'; this.value = value; return this }
  then(resolve, reject) {
    let data = (rows[this.table] ?? []).filter((row) => this.filters.every((f) => f(row)))
    const count = data.length
    const error = failTable === this.table || this.mode === 'insert' && rejectInsert ? { code: 'fixture_failure' } : null
    if (!error && this.mode === 'update') data.forEach((row) => Object.assign(row, this.value))
    if (!error && this.mode === 'insert') { rows[this.table] ??= []; rows[this.table].push(this.value) }
    if (this.cap) data = data.slice(0, this.cap)
    return Promise.resolve({ data: this.single ? data[0] ?? null : this.head ? null : data, count, error }).then(resolve, reject)
  }
}
const service = {
  from: (table) => new Query(table),
  storage: { from: (bucket) => ({
    createSignedUrl: async (object, seconds, options) => { calls.push(['signed', bucket, object, seconds, options]); return { data: { signedUrl: 'https://fixture.example.test/document' }, error: null } },
    upload: async (object, bytes, options) => { calls.push(['upload', bucket, object, bytes.length, options]); return { error: null } },
    remove: async (objects) => { calls.push(['cleanup', objects]); return { error: null } },
  }) },
}
const errors = load('src/lib/http/errors.ts')
const access = load('src/lib/staff/access.ts')
const overrides = {
  '@/lib/http/errors': errors,
  '@/lib/supabase/server': { createServiceRoleClient: () => service },
  '@/lib/staff/session': { resolveStaffIdentity: async () => me },
  '@/lib/staff/access': access,
  '@/lib/rate-limit': { checkRateLimit: async () => true, checkCredentialRateLimit: async () => true },
}
const guard = load('src/lib/pos/server/guard.ts', overrides)
overrides['@/lib/pos/server/guard'] = guard
const records = load('src/lib/staff/records.ts', overrides)
overrides['@/lib/staff/records'] = records
overrides['@/lib/owner/guard'] = { requireOwner: async () => { if (!me) throw errors.Unauthorized(); if (me.quick || me.via !== 'google' || !access.isOp(me)) throw errors.Forbidden(); return me } }
const slips = load('src/app/api/staff/payslips/[id]/route.ts', overrides)
const upload = load('src/app/api/owner/staff/[id]/payslips/route.ts', overrides)
const updates = load('src/app/api/staff/notifications/route.ts', overrides)
const ctx = (id) => ({ params: Promise.resolve({ id }) })
const request = (body, origin = 'http://localhost') => new NextRequest('http://localhost/api/staff/notifications', { method: 'POST', headers: { origin, host: 'localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) })
const privateResponse = (response) => { eq(response.headers.get('cache-control'), 'private, no-store', 'Private success/error cannot be cached'); eq(response.headers.get('referrer-policy'), 'no-referrer', 'Private links omit referrer') }
const reset = () => {
  trace = []; calls = []; failTable = null; rejectInsert = false
  rows = {
    staff: [{ id: STAFF, first_name: 'Fixture', active: true }],
    staff_payslips: [{ id: SLIP, staff_id: STAFF, object_path: 'own.pdf', file_name: 'payslip.pdf' }, { id: PEER_SLIP, staff_id: PEER, object_path: 'peer.pdf', file_name: 'peer.pdf' }],
    schedule_notifications: [{ id: SLIP, staff_id: STAFF, title: 'Own', read_at: null }, { id: PEER_SLIP, staff_id: PEER, title: 'Peer', read_at: null }],
    schedule_weeks: [{ branch_id: 'branch', published_snapshot: { shifts: [{ id: 'shift', shift_date: '2030-01-01', start_time: '07:00:00', end_time: '14:00:00' }], assignments: [{ id: 'assignment', shift_id: 'shift', staff_id: STAFF }, { id: 'other', shift_id: 'shift', staff_id: PEER }] } }],
    branches: [{ id: 'branch', name: { he: 'Fixture branch' } }],
    checklist_assignments: [{ id: SLIP, staff_id: STAFF, checklist_kind: 'opening' }, { id: PEER_SLIP, staff_id: PEER, checklist_kind: 'closing' }],
    pos_orders: [{ id: SLIP, created_by: STAFF }, { id: PEER_SLIP, created_by: PEER }],
  }
}
reset()
let response = await slips.GET(new NextRequest('http://localhost/'), ctx(SLIP))
eq(response.status, 401, 'Anonymous cannot download payslips'); privateResponse(response)
for (const identity of [{ id: STAFF, via: 'employee_code', quick: true }, { id: STAFF, via: 'google', quick: true }]) {
  me = identity
  response = await slips.GET(new NextRequest('http://localhost/'), ctx(SLIP))
  eq(response.status, 403, 'Opaque and legacy PIN both cannot download payslips'); privateResponse(response)
}
me = { id: STAFF, via: 'google', quick: false, active: true, role: 'staff' }
response = await slips.GET(new NextRequest('http://localhost/'), ctx(PEER_SLIP))
eq(response.status, 404, 'Google employee cannot discover another employee payslip')
eq(calls.length, 0, 'Foreign payslip never produces signed URL')
response = await slips.GET(new NextRequest('http://localhost/'), ctx(SLIP))
eq(response.status, 303, 'Google employee can download own payslip'); privateResponse(response)
eq(calls[0].slice(0, 4), ['signed', 'staff-payslips', 'own.pdf', 60], 'Download signs exact authorized object for one minute')
me = { ...me, role: 'owner' }
response = await slips.GET(new NextRequest('http://localhost/'), ctx(PEER_SLIP))
eq(response.status, 303, 'Full owner can download employee payslip')
reset(); me = { id: STAFF, via: 'employee_code', quick: true }
response = await updates.GET()
eq((await response.json()).notifications.map((n) => n.id), [SLIP], 'PIN dashboard only returns own notifications'); privateResponse(response)
response = await updates.POST(request({ ids: [SLIP, PEER_SLIP] }))
eq(response.status, 200, 'Read acknowledgement succeeds')
eq(rows.schedule_notifications[1].read_at, null, 'A peer notification cannot be marked read')
response = await updates.POST(request({ ids: [SLIP] }, 'https://foreign.example.test'))
eq(response.status, 403, 'Cross-origin notification writes are refused')
failTable = 'schedule_notifications'; response = await updates.GET()
eq(response.status, 503, 'Failed notification read is unavailable, never zero unread'); privateResponse(response)
reset()
const history = await records.loadStaffRecords(STAFF, false)
eq(history.shifts.map((s) => [s.date, s.start, s.end]), [['2030-01-01', '07:00', '14:00']], 'History reads published snapshot fields and own assignments')
eq(history.orders.length, 1, 'History filters event orders to employee')
eq(history.checklists.length, 1, 'History filters checklists to employee')
eq(history.payslips.length, 0, 'PIN history excludes private payslip metadata')
eq(trace.some((q) => q.table === 'staff_payslips'), false, 'PIN profile never queries private documents')
const formRequest = (bytes, origin = 'http://localhost') => {
  const form = new FormData(); form.set('month', '2030-01'); form.set('file', new File([bytes], 'untrusted-name.exe', { type: 'application/octet-stream' }))
  return new NextRequest('http://localhost/api/owner/staff/payslips', { method: 'POST', headers: { origin, host: 'localhost' }, body: form })
}
response = await upload.POST(formRequest('%PDF-1.7 fixture'), ctx(STAFF))
eq(response.status, 403, 'PIN cannot upload employee payslips')
me = { id: STAFF, via: 'google', quick: false, active: true, role: 'owner' }
response = await upload.POST(formRequest('not a real format'), ctx(STAFF))
eq(response.status, 400, 'Renamed executable is rejected before Storage upload')
eq(calls.length, 0, 'Rejected file writes no Storage object')
response = await upload.POST(formRequest('%PDF-1.7 fixture', 'https://foreign.example.test'), ctx(STAFF))
eq(response.status, 403, 'Cross-origin payslip upload is refused')
response = await upload.POST(formRequest('%PDF-1.7 fixture'), ctx(STAFF))
eq(response.status, 200, 'Full owner can upload PDF detected from bytes'); privateResponse(response)
eq(calls[0][4].contentType, 'application/pdf', 'Stored content type comes from detected format')
eq(rows.staff_payslips.at(-1).file_name, 'תלוש 2030-01.pdf', 'Unsafe supplied filename is discarded')
rejectInsert = true
response = await upload.POST(formRequest('%PDF-1.7 fixture'), ctx(STAFF))
eq(response.status, 503, 'Metadata insertion failure is reported'); privateResponse(response)
eq(calls.at(-1)[0], 'cleanup', 'Failed metadata insertion removes orphan uploaded object')
reset()
let sessionEvents = []
let verifiedLogin = { ok: true, staff_id: STAFF, auth_user_id: PEER, email: 'fixture@example.test' }
const navigation = load('src/lib/staff/navigation.ts')
const quick = load('src/app/api/auth/quick-login/route.ts', {
  ...overrides,
  '@/lib/supabase/server': {
    createServiceRoleClient: () => ({ ...service, rpc: async () => ({ data: verifiedLogin, error: null }) }),
    createServerSupabaseClient: async () => ({ auth: { signOut: async ({ scope }) => { sessionEvents.push(`signout:${scope}`); return { error: null } } } }),
  },
  '@/lib/staff/session': {
    issueEmployeeSession: async (_response, staffId) => { sessionEvents.push(`opaque:${staffId}`) },
    revokeEmployeeSession: async () => { sessionEvents.push('revoke:old') },
  },
  '@/lib/staff/navigation': navigation,
  '@/lib/rate-limit': { checkCredentialRateLimit: async () => true, credentialFingerprint: (value) => `fixture-${value}`, clientIp: () => 'fixture' },
})
const pinRequest = (next, cookie) => new NextRequest('http://localhost/api/auth/quick-login', { method: 'POST', headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ employeeNo: 17, passcode: '482951', next }) })
response = await quick.POST(pinRequest('/staff'))
eq(response.status, 200, 'Linked employee PIN login succeeds')
eq(sessionEvents, ['signout:local', 'revoke:old', `opaque:${STAFF}`], 'PIN replaces the previous identity with opaque floor session even when Google-linked')
verifiedLogin = { ok: true, staff_id: STAFF }
sessionEvents = []
response = await quick.POST(pinRequest('/pos', `sarcafe_pos_return=/pos?v=station&p=${SLIP}`))
eq((await response.json()).next, `/pos?v=station&p=${SLIP}`, 'Station deep link survives first PIN login without Google')
eq(response.headers.get('cache-control'), 'private, no-store', 'PIN login response cannot be cached')
response = await quick.POST(pinRequest('/staff/schedule'))
eq((await response.json()).next, '/staff', 'PIN cannot use a schedule return path to bypass Google')
eq(navigation.safePosReturn('https://foreign.example.test/pos'), null, 'External return destinations are refused')
eq(navigation.safePosReturn(`/pos?v=station&p=${SLIP}&unknown=secret`), `/pos?v=station&p=${SLIP}`, 'Only whitelisted event navigation survives login')
console.log(`Staff access checks: ${checks} passed`)
