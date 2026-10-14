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
  neq(key, value) { this.filters.push((row) => row[key] !== value); return this }
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
    download: async (object) => { calls.push(['download', bucket, object]); return { data: new Blob([`%PDF-1.7 bytes of ${object}`]), error: null } },
  }) },
}
const errors = load('src/lib/http/errors.ts')
const access = load('src/lib/staff/access.ts')
const overrides = {
  '@/lib/http/errors': errors,
  '@/lib/supabase/server': { createServiceRoleClient: () => service },
  '@/lib/staff/session': { resolveStaffIdentity: async () => me },
  '@/lib/staff/access': access,
  '@/lib/checklists/links': load('src/lib/checklists/links.ts'),
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
    staff_payslips: [{ id: SLIP, staff_id: STAFF, object_path: 'own.pdf', file_name: 'payslip.pdf', pay_month: '2030-01-01', content_type: 'application/pdf', byte_size: 24 }, { id: PEER_SLIP, staff_id: PEER, object_path: 'peer.pdf', file_name: 'peer.pdf', pay_month: '2030-01-01', content_type: 'application/pdf', byte_size: 24 }],
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
response = await quick.POST(pinRequest('/pos', `sarcafe_pos_return=/pos?v=station&p=${SLIP}`))
eq((await response.json()).next, `/pos?v=station&p=${SLIP}`, 'Linked employee keeps an authorized station deep link')
verifiedLogin = { ok: true, staff_id: STAFF }
sessionEvents = []
response = await quick.POST(pinRequest('/pos', `sarcafe_pos_return=/pos?v=station&p=${SLIP}`))
eq((await response.json()).next, `/pos?v=station&p=${SLIP}`, 'Unlinked employee lands where they asked; the home page carries the Gmail-link card instead of a forced redirect')
eq(response.headers.get('cache-control'), 'private, no-store', 'PIN login response cannot be cached')
response = await quick.POST(pinRequest('/staff/schedule'))
eq((await response.json()).next, '/staff', 'Unlinked employee asking for the schedule lands on the home page, where the Gmail-link card is')
response = await quick.POST(pinRequest('/staff'))
eq((await response.json()).next, '/staff', 'Unlinked employee with the default destination lands on the home page, not the profile')
const LINKED = '77777777-7777-4777-8777-777777777777'
response = await quick.POST(pinRequest(`/staff/checklists/${LINKED}`))
eq((await response.json()).next, `/staff/checklists/${LINKED}`, 'A checklist alert link survives the number + code sign-in')
for (const bad of ['/staff/checklists/not-a-uuid', `/staff/checklists/${LINKED}/extra`, `/staff/checklists/..%2F..%2Fowner`, `//evil.example/${LINKED}`]) {
  response = await quick.POST(pinRequest(bad))
  eq(response.status, 400, `A destination that is not exactly one checklist is refused (${bad})`)
}
eq(navigation.safePosReturn('https://foreign.example.test/pos'), null, 'External return destinations are refused')
eq(navigation.safePosReturn(`/pos?v=station&p=${SLIP}&unknown=secret`), `/pos?v=station&p=${SLIP}`, 'Only whitelisted event navigation survives login')
// A checklist cannot be started, saved or submitted before its shift has begun (the real route, fixture database).
{
  const FUTURE = '55555555-5555-4555-8555-555555555555'
  const PAST = '66666666-6666-4666-8666-666666666666'
  const template = { categories: [{ id: 'c', title: 'Fixture', items: [{ id: 'i', label: 'Machine', kind: 'status', issueType: 'equipment', required: true }] }] }
  const checklistsApi = load('src/app/api/checklists/route.ts', {
    ...overrides,
    '@/lib/checklists/server': { ensureChecklistTemplates() {}, syncPublishedChecklists() {}, loadStaffChecklistAssignments: async () => [], flattenDefinition: (d) => d.categories.flatMap((c) => c.items.map((i) => ({ ...i, categoryId: c.id, categoryTitle: c.title }))) },
    '@/lib/checklists/types': load('src/lib/checklists/types.ts'),
    '@/lib/checklists/developer': load('src/lib/checklists/developer.ts'),
    '@/lib/checklists/window': load('src/lib/checklists/window.ts'),
    '@/lib/shifts/time': load('src/lib/shifts/time.ts'),
  })
  const post = (body) => new NextRequest('http://localhost/api/checklists', { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const answers = { i: { result: 'ok', answeredAt: new Date().toISOString() } }
  reset()
  me = { id: STAFF, role: 'staff', badge: null, branch_id: null, active: true, email: null, via: 'employee_code', quick: true }
  rows.branches[0].timezone = 'Asia/Jerusalem'
  rows.shifts = [
    { id: 'sh-future', branch_id: 'branch', shift_date: '2099-01-01', start_time: '07:00', end_time: '13:00' },
    { id: 'sh-past', branch_id: 'branch', shift_date: '2020-01-01', start_time: '07:00', end_time: '13:00' },
  ]
  rows.checklist_assignments = [
    { id: FUTURE, staff_id: STAFF, shift_id: 'sh-future', status: 'pending', template_snapshot: template },
    { id: PAST, staff_id: STAFF, shift_id: 'sh-past', status: 'pending', template_snapshot: template },
  ]
  response = await checklistsApi.POST(post({ action: 'save', assignmentId: FUTURE, answers }))
  eq(response.status, 409, 'Saving a checklist before its shift is refused')
  eq((await response.json()).error.code, 'too_early', 'The refusal says the checklist is still locked')
  response = await checklistsApi.POST(post({ action: 'submit', assignmentId: FUTURE, answers, attested: true }))
  eq(response.status, 409, 'Submitting a checklist before its shift is refused')
  eq(rows.checklist_assignments[0].status, 'pending', 'A refused submit leaves the checklist untouched')
  response = await checklistsApi.POST(post({ action: 'save', assignmentId: PAST, answers }))
  eq(response.status, 200, 'Once the shift has started the checklist can be saved')
  response = await checklistsApi.POST(post({ action: 'submit', assignmentId: PAST, answers, attested: true }))
  eq(response.status, 200, 'Once the shift has started the checklist can be submitted')
  eq(rows.checklist_assignments[1].status, 'submitted', 'The submitted checklist is stored')
}
// An owner can dismiss a checklist nobody sent, take it back, and a dismissed one is closed for the employee (real routes).
{
  const WAITING = '88888888-8888-4888-8888-888888888888'
  const SENT = '99999999-9999-4999-8999-999999999999'
  const template = { categories: [{ id: 'c', title: 'Fixture', items: [{ id: 'i', label: 'Machine', kind: 'status', issueType: 'equipment', required: true }] }] }
  const owner = { id: PEER, via: 'google', quick: false, role: 'owner', badge: null, branch_id: null, active: true, email: null }
  const worker = { id: STAFF, role: 'staff', badge: null, branch_id: null, active: true, email: null, via: 'employee_code', quick: true }
  const ownerApi = load('src/app/api/owner/checklists/route.ts', {
    ...overrides,
    '@/lib/checklists/server': { ensureChecklistTemplates() {}, syncPublishedChecklists() {} },
    '@/lib/checklists/window': load('src/lib/checklists/window.ts'),
    '@/lib/shifts/people': { staffColor: () => null },
    '@/lib/shifts/time': load('src/lib/shifts/time.ts'),
  })
  const checklistsApi = load('src/app/api/checklists/route.ts', {
    ...overrides,
    '@/lib/checklists/server': { ensureChecklistTemplates() {}, syncPublishedChecklists() {}, loadStaffChecklistAssignments: async () => [], flattenDefinition: (d) => d.categories.flatMap((c) => c.items.map((i) => ({ ...i, categoryId: c.id, categoryTitle: c.title }))) },
    '@/lib/checklists/types': load('src/lib/checklists/types.ts'),
    '@/lib/checklists/developer': load('src/lib/checklists/developer.ts'),
    '@/lib/checklists/window': load('src/lib/checklists/window.ts'),
    '@/lib/shifts/time': load('src/lib/shifts/time.ts'),
  })
  const post = (url, body) => new NextRequest(`http://localhost/api/${url}`, { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const answers = { i: { result: 'ok', answeredAt: new Date().toISOString() } }
  reset()
  rows.branches[0].timezone = 'Asia/Jerusalem'
  rows.shifts = [{ id: 'sh-past', branch_id: 'branch', shift_date: '2020-01-01', start_time: '07:00', end_time: '13:00' }]
  rows.checklist_assignments = [
    { id: WAITING, staff_id: STAFF, shift_id: 'sh-past', status: 'pending', template_snapshot: template, manager_resolved_at: null },
    { id: SENT, staff_id: STAFF, shift_id: 'sh-past', status: 'submitted', template_snapshot: template, manager_resolved_at: null },
  ]
  me = worker
  response = await ownerApi.POST(post('owner/checklists', { action: 'dismiss', assignmentId: WAITING }))
  eq(response.status, 403, 'An employee cannot dismiss a checklist')
  eq(rows.checklist_assignments[0].manager_resolved_at, null, 'A refused dismissal changes nothing')
  me = owner
  response = await ownerApi.POST(post('owner/checklists', { action: 'dismiss', assignmentId: WAITING, note: '  closed early  ' }))
  eq(response.status, 200, 'An owner can dismiss an unsent checklist')
  eq([Boolean(rows.checklist_assignments[0].manager_resolved_at), rows.checklist_assignments[0].manager_resolved_by, rows.checklist_assignments[0].manager_note, rows.checklist_assignments[0].status], [true, PEER, 'closed early', 'pending'], 'It records who, when and why (trimmed) and does not touch the status')
  response = await ownerApi.POST(post('owner/checklists', { action: 'dismiss', assignmentId: SENT }))
  eq(response.status, 409, 'A checklist that was already sent cannot be dismissed')
  eq(rows.checklist_assignments[1].manager_resolved_at, null, 'A sent checklist is left alone')
  response = await ownerApi.POST(post('owner/checklists', { action: 'dismiss', assignmentId: '00000000-0000-4000-8000-000000000000' }))
  eq(response.status, 404, 'Dismissing a checklist that does not exist is a 404')
  me = worker
  response = await checklistsApi.POST(post('checklists', { action: 'save', assignmentId: WAITING, answers }))
  eq([response.status, (await response.json()).error.code], [409, 'dismissed'], 'The employee cannot save a dismissed checklist')
  response = await checklistsApi.POST(post('checklists', { action: 'submit', assignmentId: WAITING, answers, attested: true }))
  eq([response.status, rows.checklist_assignments[0].status], [409, 'pending'], 'The employee cannot send a dismissed checklist (a stale screen included)')
  me = owner
  response = await ownerApi.POST(post('owner/checklists', { action: 'restore', assignmentId: WAITING }))
  eq([response.status, rows.checklist_assignments[0].manager_resolved_at, rows.checklist_assignments[0].manager_note], [200, null, null], 'An owner can take the dismissal back')
  me = worker
  response = await checklistsApi.POST(post('checklists', { action: 'submit', assignmentId: WAITING, answers, attested: true }))
  eq([response.status, rows.checklist_assignments[0].status], [200, 'submitted'], 'Once restored the employee can send it again')
  me = owner
  response = await ownerApi.POST(post('owner/checklists', { action: 'restore', assignmentId: SENT }))
  eq(response.status, 409, 'A sent checklist cannot be "restored" either')
}
// Closing opens half an hour before the shift ends, not when it starts (the real route, fixture database, real clock).
{
  const here = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' }).format(new Date())
  if (hhmm >= '23:25') console.log('  (skipped the mid-shift lock check: it is too close to the end of the fixture shift)')
  else {
    const OPEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const CLOSE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const template = { categories: [{ id: 'c', title: 'Fixture', items: [{ id: 'i', label: 'Machine', kind: 'status', issueType: 'equipment', required: true }] }] }
    const midShift = load('src/app/api/checklists/route.ts', {
      ...overrides,
      '@/lib/checklists/server': { ensureChecklistTemplates() {}, syncPublishedChecklists() {}, loadStaffChecklistAssignments: async () => [], flattenDefinition: (d) => d.categories.flatMap((c) => c.items.map((i) => ({ ...i, categoryId: c.id, categoryTitle: c.title }))) },
      '@/lib/checklists/types': load('src/lib/checklists/types.ts'),
      '@/lib/checklists/developer': load('src/lib/checklists/developer.ts'),
      '@/lib/checklists/window': load('src/lib/checklists/window.ts'),
      '@/lib/shifts/time': load('src/lib/shifts/time.ts'),
    })
    const call = (body) => new NextRequest('http://localhost/api/checklists', { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const answers = { i: { result: 'ok', answeredAt: new Date().toISOString() } }
    reset()
    me = { id: STAFF, role: 'staff', badge: null, branch_id: null, active: true, email: null, via: 'employee_code', quick: true }
    rows.branches[0].timezone = 'Asia/Jerusalem'
    rows.shifts = [{ id: 'sh-today', branch_id: 'branch', shift_date: here, start_time: '00:00', end_time: '23:59' }]
    rows.checklist_assignments = [
      { id: OPEN, staff_id: STAFF, shift_id: 'sh-today', checklist_kind: 'opening', status: 'pending', template_snapshot: template, manager_resolved_at: null },
      { id: CLOSE, staff_id: STAFF, shift_id: 'sh-today', checklist_kind: 'closing', status: 'pending', template_snapshot: template, manager_resolved_at: null },
    ]
    response = await midShift.POST(call({ action: 'save', assignmentId: OPEN, answers }))
    eq(response.status, 200, 'In the middle of the shift the opening checklist can be saved')
    response = await midShift.POST(call({ action: 'save', assignmentId: CLOSE, answers }))
    eq([response.status, (await response.json()).error.code], [409, 'too_early'], 'In the middle of the shift the closing checklist is still shut')
    response = await midShift.POST(call({ action: 'submit', assignmentId: CLOSE, answers, attested: true }))
    eq([response.status, rows.checklist_assignments[1].status], [409, 'pending'], 'It cannot be submitted early either, and is left untouched')
  }
}
console.log(`Staff access checks: ${checks} passed`)
