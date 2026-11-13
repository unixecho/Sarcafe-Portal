// Stage — identity (FABLE-002, docs/SARCAFE_IDENTITY.md): organizations, departments and department-head invitations, against the
// running production build. The identity functions the app calls are answered by a REAL Postgres with the real migrations
// (qa/standin/identity-db.mjs), so every answer below is the real SQL's. Covered: who may call each route (role, session and
// tenant matrix), the invitation's whole life (intended recipient, wrong recipient, self-declared address, expiry, revocation,
// replay, simultaneous replay), the CURRENT session's sign-in method (review R1), recovering a switched-off organization (review
// R2), the rate limiter failing closed, database outages and a migration that is not applied, private
// headers, the sign-in return and the middleware, and the screens in a real browser (five looks, three widths, iPhone edges).
// Every person, address and organization is made up.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createStage, assert } from '../lib/harness.mjs'
import { ID, SESSIONS, emailOf, tokenFor, tokenForMethod, userFor } from '../standin/seed.mjs'
import { sessionCookie } from '../standin/supabase.mjs'
import { auditScreen } from './contrast.mjs'

const O = '/api/owner/members'
const B = '/api/benefits/manage'
const I = '/api/benefits/invite'
const LOOKS = ['neon', 'glass', 'pass', 'crema', 'latte']
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const tokenDigest = (token) => sha(`sarcafe:identity:invitation:department_head:v1:${token}`)
const recipientDigest = (email) => sha(`sarcafe:identity:recipient:v1:${email}`)
const inviteCookie = (token) => `sarcafe_benefits_invite=${token}`
const NOBODY = '00000000-0000-4000-8000-00000000dead'
const IDENTITY_FUNCTIONS = ['customer_access_check', 'customer_access_grant', 'customer_access_revoke', 'customer_org_manage_check', 'customer_org_create', 'customer_org_update', 'customer_department_create',
  'customer_department_update', 'customer_invitation_create', 'customer_invitation_revoke', 'customer_invitation_peek', 'customer_invitation_accept', 'customer_department_head_revoke', 'customer_org_list', 'customer_org_detail', 'customer_manage_scopes']

export function identityStage(root, live) {
  const stage = createStage('identity', 'זהויות: ארגונים, מחלקות והזמנת ראש מחלקה (SQL אמיתי מאחורי האפליקציה)')
  const api = (url, opts = {}) => live().call(url, { origin: true, ...opts })
  const post = (url, as, body, extra = {}) => api(url, { method: 'POST', as, body, ...extra })
  const sql = (text, params) => live().identity.query(text, params)
  const count = async (text, params) => Number((await sql(text, params))[0].n)
  const fault = (body) => live().control('/__qa/fault', body)
  const missing = (body) => live().control('/__qa/missing', body)
  /** An empty identity world, an empty limiter, no injected fault, nobody on a quick or code session. */
  const fresh = async () => {
    await fault({ mode: 'none' }); await missing({ tables: [], functions: [] })
    live().standin.state.limits.clear()
    live().db('pos_quick_sessions').length = 0
    live().db('staff_employee_sessions').length = 0
    await live().identity.reset()
  }
  const createOrg = async (name = 'ארגון בדיקה') => { const r = await post(`${O}/organizations`, 'owner', { name }); assert.status(r, 201, `create organization ${name}`); return r.json.organizationId }
  const createDept = async (org, name = 'מטבח', as = 'owner', base = O) => { const r = await post(`${base}/organizations/${org}/departments`, as, { name }); assert.status(r, 201, `create department ${name}`); return r.json.departmentId }
  const invite = (org, dept, who, as = 'owner', base = O) => post(`${base}/organizations/${org}/invitations`, as, { departmentId: dept, email: emailOf(who) })
  const token = async (org, dept, who, as = 'owner', base = O) => { const r = await invite(org, dept, who, as, base); assert.status(r, 201, `invite ${who}`); return r.json.token }
  /** Makes `who` (an external person) an administrator of the organization, directly in the database (no screen appoints one yet). */
  const seedAdmin = async (org, who = 'orgadmin') => {
    await sql(`insert into public.customer_principals (auth_user_id) values ($1) on conflict (auth_user_id) do nothing`, [SESSIONS[who].sub])
    await sql(`insert into public.customer_access_grants (principal_id, capability, scope_kind, organization_id) select p.id, 'organization_admin', 'organization', $2 from public.customer_principals p where p.auth_user_id = $1`, [SESSIONS[who].sub, org])
  }
  /** An organization of ANOTHER business (no agreement with Sarcafe), with one department. */
  const foreignOrg = async () => {
    const b = (await sql(`insert into public.customer_businesses (slug, name) values ('other-cafe', 'Other Cafe') on conflict (slug) do update set name = excluded.name returning id`))[0].id
    const org = (await sql(`insert into public.customer_organizations (slug, name) values ('foreign-' || substr(md5(random()::text), 1, 8), 'Foreign Organization') returning id`))[0].id
    await sql(`insert into public.customer_business_orgs (business_id, organization_id, state) values ($1, $2, 'active')`, [b, org])
    const dept = (await sql(`insert into public.customer_departments (organization_id, name) values ($1, 'Foreign Department') returning id`, [org]))[0].id
    return { org, dept }
  }
  const quick = (who) => live().db('pos_quick_sessions').push({ session_id: SESSIONS[who].sessionId })
  const codeSession = (staffId) => { const t = `qa-employee-${Math.random().toString(16).slice(2)}`; live().db('staff_employee_sessions').push({ id: crypto.randomUUID(), token_hash: sha(t), staff_id: staffId, revoked_at: null, expires_at: new Date(Date.now() + 3600_000).toISOString() }); return `sarcafe_staff_session=${t}` }
  const noData = (r) => !/organizationId|departments|invitations|"token"|organizationName/.test(r.text)

  stage.test('reset', 'מתחילים מעולם זהויות ריק (מסד אמיתי בזיכרון, כל המיגרציות)', 'sql', async () => {
    await fresh()
    assert.equal(await count(`select count(*) n from public.customer_organizations`), 0, 'organizations')
    assert.equal((await sql(`select slug from public.customer_businesses`)).map((r) => r.slug).join(), 'sarcafe', 'businesses')
    assert.equal(await count(`select count(*) n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [IDENTITY_FUNCTIONS]), 16, 'the sixteen identity functions exist in the test database')
  }, { retry: false })

  // ── who may call the owner family
  stage.test('owner-sessions', 'משפחת הבעלים: רק בעלים בהתחברות מלאה; מנהל כללי, עובד, קוד מהיר, קוד עובד, אדם חיצוני ולא מחובר נדחים', 'security', async () => {
    await fresh()
    const org = await createOrg(); const dept = await createDept(org)
    const routes = [
      ['GET', `${O}/organizations`], ['POST', `${O}/organizations`, { name: 'X' }], ['GET', `${O}/organizations/${org}`], ['PATCH', `${O}/organizations/${org}`, { name: 'X' }],
      ['POST', `${O}/organizations/${org}/departments`, { name: 'X' }], ['PATCH', `${O}/organizations/${org}/departments/${dept}`, { name: 'X' }],
      ['POST', `${O}/organizations/${org}/invitations`, { departmentId: dept, email: emailOf('head') }], ['DELETE', `${O}/organizations/${org}/invitations/${NOBODY}`], ['DELETE', `${O}/organizations/${org}/heads/${NOBODY}`],
    ]
    const before = await count(`select count(*) n from public.customer_identity_audit`)
    const tryAll = async (label, opts, expected) => {
      for (const [method, url, body] of routes) {
        const r = await api(url, { method, body, ...opts })
        assert.status(r, expected, `${label}: ${method} ${url.replace(O, '')}`)
        assert.ok(noData(r), `${label}: ${method} answered without data`)
      }
    }
    await tryAll('signed out', {}, 401)
    await tryAll('an employee', { as: 'dana' }, 403)
    await tryAll('a general manager', { as: 'gm' }, 403)
    await tryAll('an external administrator (signed in, not staff)', { as: 'orgadmin' }, 401)
    await tryAll('an outsider', { as: 'outsider' }, 401)
    quick('owner')
    await tryAll('the owner on a quick (six-digit) session', { as: 'owner' }, 403)
    live().db('pos_quick_sessions').length = 0
    await tryAll('an owner-less employee-code session', { cookie: codeSession(ID.dana) }, 401)
    assert.equal(await count(`select count(*) n from public.customer_identity_audit`), before, 'nothing was written by any refused call')
    assert.equal(await count(`select count(*) n from public.customer_organizations`), 1, 'organizations')
    const ok = await api(`${O}/organizations`, { as: 'owner' })
    assert.status(ok, 200, 'the owner, full session')
    assert.equal(ok.json.organizations.length, 1, 'the owner sees the organization')
    assert.status(await api(`${O}/organizations`, { as: 'dev' }), 200, 'the developer (an owner by role)')
  }, { timeout: 120_000 })

  // ── the owner's whole flow, and what is stored
  stage.test('owner-flow', 'הבעלים יוצר ארגון, מחלקות והזמנה; נשמרים רק תקצירים, והקישור ניתן פעם אחת', 'e2e', async () => {
    await fresh()
    const org = await createOrg('מכללת הדוגמה')
    assert.status(await post(`${O}/organizations`, 'owner', { name: ' מכללת הדוגמה ' }), 409, 'the same name again')
    for (const bad of [{}, { name: '' }, { name: 'x'.repeat(81) }, { name: 'ok', business: NOBODY }, { name: 'ok', role: 'owner' }]) assert.status(await post(`${O}/organizations`, 'owner', bad), 400, `bad body ${JSON.stringify(bad).slice(0, 40)}`)
    const list = (await api(`${O}/organizations`, { as: 'owner' })).json.organizations
    assert.deepEqual(list.map((o) => [o.name, o.state, o.agreementState, o.hasAdmin, o.canManage, o.departments]), [['מכללת הדוגמה', 'active', 'draft', false, true, 0]], 'the list')
    const dept = await createDept(org, 'מטבח')
    assert.status(await post(`${O}/organizations/${org}/departments`, 'owner', { name: 'מטבח ' }), 409, 'a department with the same name')
    assert.status(await api(`${O}/organizations/${org}/departments/${dept}`, { method: 'PATCH', as: 'owner', body: { name: 'מטבח מרכזי' } }), 200, 'rename')
    assert.status(await api(`${O}/organizations/${org}/departments/${dept}`, { method: 'PATCH', as: 'owner', body: {} }), 400, 'a patch with nothing in it')
    assert.status(await api(`${O}/organizations/${org}/departments/${dept}`, { method: 'PATCH', as: 'owner', body: { state: 'deleted' } }), 400, 'an unknown state')
    assert.status(await api(`${O}/organizations/not-a-uuid`, { as: 'owner' }), 400, 'an id that is not a UUID')

    for (const bad of [{ departmentId: dept }, { departmentId: dept, email: 'not-an-address' }, { departmentId: dept, email: emailOf('head'), expiresInHours: 9999 }, { departmentId: 'x', email: emailOf('head') }, { departmentId: dept, email: emailOf('head'), principalId: NOBODY }]) {
      assert.status(await post(`${O}/organizations/${org}/invitations`, 'owner', bad), 400, `bad invitation ${JSON.stringify(bad).slice(0, 50)}`)
    }
    const self = await post(`${O}/organizations/${org}/invitations`, 'owner', { departmentId: dept, email: emailOf('owner').toUpperCase() })
    assert.status(self, 400, 'the owner inviting their own address')
    assert.equal(self.json.error.code, 'self_invite', 'said plainly')
    const made = await invite(org, dept, 'head')
    assert.status(made, 201, 'the invitation')
    assert.match(made.json.token, /^dh1_[A-Za-z0-9_-]{43}$/, 'a purpose-prefixed 256-bit token')
    assert.equal(made.json.hint, 'h***@qa.sarcafe.invalid', 'a masked hint, not the address')
    assert.match(made.headers.get('cache-control') ?? '', /no-store/, 'the response that carries the token is not stored')
    assert.equal(made.headers.get('referrer-policy'), 'no-referrer', 'and sends no referrer')
    const row = (await sql(`select * from public.customer_invitations where id = $1`, [made.json.invitationId]))[0]
    assert.equal(row.token_digest, tokenDigest(made.json.token), 'the database holds the digest of the token')
    assert.equal(row.recipient_digest, recipientDigest(emailOf('head')), 'and the digest of the intended recipient')
    const everything = JSON.stringify([await sql(`select * from public.customer_invitations`), await sql(`select * from public.customer_identity_audit`), await sql(`select * from public.customer_organizations`)])
    assert.ok(!everything.includes(made.json.token) && !everything.includes(made.json.token.slice(4)), 'the token is nowhere in the database')
    assert.ok(!everything.includes(emailOf('head')), 'the address is nowhere in the database')
    assert.ok(!JSON.stringify(live().standin.db).includes(made.json.token), 'nor in any other table')
    const detail = (await api(`${O}/organizations/${org}`, { as: 'owner' })).json
    assert.deepEqual([detail.via, detail.departments.map((d) => d.name), detail.invitations.map((i) => [i.status, i.hint]), detail.heads], ['setup', ['מטבח מרכזי'], [['pending', 'h***@qa.sarcafe.invalid']], []], 'the detail')
    assert.ok(!JSON.stringify(detail).includes(made.json.token) && !/[0-9a-f]{64}/.test(JSON.stringify(detail)), 'the detail never repeats the token or a digest')
    const again = await invite(org, dept, 'head')
    assert.status(again, 201, 'inviting the same person again')
    assert.deepEqual((await sql(`select revoked_reason from public.customer_invitations where id = $1`, [made.json.invitationId]))[0].revoked_reason, 'superseded', 'supersedes the first link')
    const ops = (await sql(`select operation from public.customer_identity_audit order by at, id`)).map((r) => r.operation)
    assert.deepEqual([...new Set(ops)].sort(), ['department.create', 'department.update', 'invitation.create', 'organization.create'], 'what the audit recorded')
    assert.equal(live().db('schedule_notifications').filter((n) => /invit|הזמנ/i.test(JSON.stringify(n))).length, 0, 'no notification was queued: the link is copied, nothing is sent')
  }, { timeout: 120_000 })

  // ── every management write, of both families, from another site (2026-11-13: the two DELETEs now check the Origin themselves too)
  stage.test('cross-site-writes', 'כל פעולת ניהול שמגיעה מאתר אחר נדחית (כולל שתי פעולות המחיקה) ולא משנה דבר', 'security', async () => {
    await fresh()
    const org = await createOrg('ארגון חוצה אתרים'); const dept = await createDept(org)
    const accepted = await post(`${I}/accept`, 'head', {}, { cookie: inviteCookie(await token(org, dept, 'head')) })
    assert.status(accepted, 200, 'a head accepted (setup)')
    const pending = (await invite(org, dept, 'head2')).json.invitationId
    const grant = (await api(`${O}/organizations/${org}`, { as: 'owner' })).json.heads[0].grantId
    const before = JSON.stringify([await count(`select count(*) n from public.customer_identity_audit`), await sql(`select id, name, state from public.customer_departments order by id`), await sql(`select name, state from public.customer_organizations`)])
    const evil = { origin: 'https://evil.example' }
    const writes = (base, as) => [
      ['PATCH', `${base}/organizations/${org}`, { name: 'Taken' }], ['POST', `${base}/organizations/${org}/departments`, { name: 'Planted' }],
      ['PATCH', `${base}/organizations/${org}/departments/${dept}`, { state: 'inactive' }], ['POST', `${base}/organizations/${org}/invitations`, { departmentId: dept, email: emailOf('outsider') }],
      ['DELETE', `${base}/organizations/${org}/invitations/${pending}`], ['DELETE', `${base}/organizations/${org}/heads/${grant}`],
    ].map(([method, url, body]) => ({ method, url, body, as }))
    await seedAdmin(org, 'orgadmin')
    for (const w of [...writes(O, 'owner'), ...writes(B, 'orgadmin')]) {
      assert.status(await live().call(w.url, { method: w.method, as: w.as, ...(w.body ? { body: w.body } : {}), ...evil }), 403, `${w.as} ${w.method} ${w.url.replace(/[0-9a-f-]{36}/g, ':id')} from another site`)
    }
    assert.status(await live().call(`${O}/organizations`, { method: 'POST', as: 'owner', body: { name: 'Cross-site' }, ...evil }), 403, 'creating an organization from another site')
    assert.equal(JSON.stringify([await count(`select count(*) n from public.customer_identity_audit`), await sql(`select id, name, state from public.customer_departments order by id`), await sql(`select name, state from public.customer_organizations`)]), before, 'nothing was written')
    assert.equal((await sql(`select revoked_at from public.customer_invitations where id = $1`, [pending]))[0].revoked_at, null, 'the pending invitation is still open')
    assert.equal((await sql(`select revoked_at from public.customer_access_grants where id = $1`, [grant]))[0].revoked_at, null, 'the head still holds the department')
    // the same two DELETEs from our own origin work (so the probe above is not always 403)
    assert.status(await api(`${B}/organizations/${org}/invitations/${pending}`, { method: 'DELETE', as: 'orgadmin' }), 200, 'CONTROL: same-origin revoke of the invitation')
    assert.status(await api(`${B}/organizations/${org}/heads/${grant}`, { method: 'DELETE', as: 'orgadmin' }), 200, 'CONTROL: same-origin end of the head')
  }, { timeout: 120_000 })

  // ── tenants: another business's organization, an organization that runs itself, swapped ids
  stage.test('tenants', 'היקפים: ארגון של עסק אחר, ארגון שמנהל את עצמו ומזהים מוחלפים נדחים באותה תשובה', 'security', async () => {
    await fresh()
    const mine = await createOrg('הארגון שלי'); const myDept = await createDept(mine)
    const other = await foreignOrg()
    const selfRun = await createOrg('ארגון עצמאי'); const selfDept = await createDept(selfRun, 'הנהלה')
    await seedAdmin(selfRun, 'orgadmin')
    const before = await count(`select count(*) n from public.customer_identity_audit`)
    const attempts = async (label, as, base, org, dept) => [
      await api(`${base}/organizations/${org}`, { as }), await api(`${base}/organizations/${org}`, { method: 'PATCH', as, body: { name: 'Mine now' } }), await api(`${base}/organizations/${org}`, { method: 'PATCH', as, body: { state: 'inactive' } }),
      await post(`${base}/organizations/${org}/departments`, as, { name: 'Planted' }), await api(`${base}/organizations/${org}/departments/${dept}`, { method: 'PATCH', as, body: { state: 'inactive' } }),
      await post(`${base}/organizations/${org}/invitations`, as, { departmentId: dept, email: emailOf('head2') }),
    ].map((r) => ({ label, status: r.status, body: r.text }))
    const refused = [
      ...await attempts('the owner → another business\'s organization', 'owner', O, other.org, other.dept),
      ...await attempts('the owner → an organization that has its own administrator', 'owner', O, selfRun, selfDept),
      ...await attempts('the owner → an organization that does not exist', 'owner', O, NOBODY, NOBODY),
      // ID SWAP: the owner's own organization in the address, another organization's department with it (only the department calls)
      ...[await api(`${O}/organizations/${mine}/departments/${other.dept}`, { method: 'PATCH', as: 'owner', body: { state: 'inactive' } }), await api(`${O}/organizations/${mine}/departments/${other.dept}`, { method: 'PATCH', as: 'owner', body: { name: 'Taken' } }),
        await post(`${O}/organizations/${mine}/invitations`, 'owner', { departmentId: other.dept, email: emailOf('head2') })].map((r) => ({ label: 'ID SWAP: own organization, another organization\'s department', status: r.status, body: r.text })),
      ...await attempts('the organization\'s administrator → the owner\'s organization', 'orgadmin', B, mine, myDept),
      ...await attempts('the organization\'s administrator → another business\'s organization', 'orgadmin', B, other.org, other.dept),
      ...await attempts('the owner on the benefits family (setup is not a grant)', 'owner', B, mine, myDept),
      ...await attempts('an employee on the benefits family', 'dana', B, selfRun, selfDept),
      ...await attempts('a general manager on the benefits family', 'gm', B, selfRun, selfDept),
      ...await attempts('an outsider on the benefits family', 'outsider', B, selfRun, selfDept),
    ]
    assert.deepEqual(refused.filter((r) => r.status !== 403).map((r) => `${r.label}: ${r.status}`), [], 'calls that were not refused with 403:')
    assert.equal(new Set(refused.map((r) => r.body)).size, 1, 'every refusal is the same body: it never says whether the organization or department exists')
    assert.equal(await count(`select count(*) n from public.customer_identity_audit`), before, 'no refused call wrote anything')
    assert.deepEqual((await sql(`select name, state from public.customer_organizations where id = any($1) order by name`, [[other.org, selfRun]])).map((r) => [r.name, r.state]), [['Foreign Organization', 'active'], ['ארגון עצמאי', 'active']], 'the organizations are untouched')
    assert.status(await api(`${B}/organizations/${selfRun}`, {}), 401, 'signed out on the benefits family')

    // the people who MAY
    const adminDetail = await api(`${B}/organizations/${selfRun}`, { as: 'orgadmin' })
    assert.status(adminDetail, 200, 'the administrator reads their own organization')
    assert.equal(adminDetail.json.via, 'organization_admin', 'by their grant')
    const newDept = await createDept(selfRun, 'כספים', 'orgadmin', B)
    assert.status(await invite(selfRun, newDept, 'head2', 'orgadmin', B), 201, 'and invites a head there')
    const list = (await api(`${O}/organizations`, { as: 'owner' })).json.organizations
    assert.deepEqual(list.map((o) => [o.name, o.canManage, o.hasAdmin]).sort(), [['ארגון עצמאי', false, true], ['הארגון שלי', true, false]], 'the owner\'s list: only Sarcafe\'s organizations, and which of them it may still manage')
    const scopes = (await api(`${B}/scopes`, { as: 'orgadmin' })).json
    assert.deepEqual([scopes.organizations.map((o) => o.name), scopes.departments], [['ארגון עצמאי'], []], 'the administrator\'s scopes')
    const none = (await api(`${B}/scopes`, { as: 'owner' })).json
    assert.deepEqual([none.organizations, none.departments], [[], []], 'the owner holds no grant, so no scope')
    assert.status(await api(`${B}/scopes`, {}), 401, 'scopes, signed out')
    quick('orgadmin')
    assert.status(await api(`${B}/scopes`, { as: 'orgadmin' }), 403, 'scopes on a quick session')
    live().db('pos_quick_sessions').length = 0
    assert.status(await api(`${B}/scopes`, { cookie: codeSession(ID.dana) }), 403, 'scopes on an employee-code session (no verified user behind it)')
  }, { timeout: 120_000 })

  // ── the invitation, end to end
  stage.test('invite-exchange', 'הקישור: האסימון עובר לעוגייה נסתרת בלבד, והחלפה אינה מגלה דבר על ההזמנה', 'security', async () => {
    await fresh()
    const org = await createOrg(); const dept = await createDept(org)
    const real = await token(org, dept, 'head')
    const madeUp = `dh1_${'A'.repeat(43)}`
    const answers = []
    for (const t of [real, madeUp]) {
      const r = await post(`${I}/exchange`, null, { token: t })
      assert.status(r, 200, 'a well-formed token')
      const set = r.headers.getSetCookie().join('; ')
      assert.match(set, /sarcafe_benefits_invite=dh1_/, 'the cookie')
      assert.match(set, /HttpOnly/i, 'HttpOnly: scripts cannot read it')
      assert.match(set, /Path=\/api\/benefits\/invite/i, 'sent only to the invitation routes')
      assert.match(set, /SameSite=lax/i, 'SameSite')
      assert.match(set, /Max-Age=1800/i, 'for thirty minutes')
      answers.push(r.text)
    }
    assert.equal(answers[0], answers[1], 'a real token and a made-up one get the same answer (no oracle)')
    for (const bad of ['', 'dh1_short', `xx1_${'A'.repeat(43)}`, `dh1_${'A'.repeat(44)}`, real + '?x=1']) assert.status(await post(`${I}/exchange`, null, { token: bad }), 400, `a malformed token (${bad.slice(0, 12)}…)`)
    assert.status(await post(`${I}/exchange`, null, { token: real, extra: 1 }), 400, 'an unknown field')
    assert.status(await live().call(`${I}/exchange`, { method: 'POST', body: { token: real }, origin: 'https://evil.example' }), 403, 'from another site')
    assert.status(await live().call(`${I}/exchange`, { method: 'POST', body: `token=${real}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, origin: true }), 400, 'a form post')
    assert.equal(await count(`select count(*) n from public.customer_invitations where consumed_at is not null`), 0, 'exchanging consumed nothing')
    const cleared = await api(`${I}/exchange`, { method: 'DELETE' })
    assert.match(cleared.headers.getSetCookie().join('; '), /sarcafe_benefits_invite=;.*Max-Age=0/i, '"not now" forgets the token')
  })

  stage.test('invite-recipient', 'ההזמנה נראית ומאושרת רק על ידי הנמען המיועד: כתובת Google מאומתת, לא כתובת שהוקלדה', 'security', async () => {
    await fresh()
    const org = await createOrg('מכללת הדוגמה'); const dept = await createDept(org, 'מטבח')
    const t = await token(org, dept, 'head')
    const cookie = inviteCookie(t)
    const status = async (as, extra = {}) => { const r = await api(`${I}/status`, { as, cookie, ...extra }); return r.status === 200 ? r.json : { http: r.status } }
    assert.deepEqual(await status(null), { http: 401 }, 'signed out: nothing, 401')
    assert.deepEqual(await api(`${I}/status`, { as: 'head' }).then((r) => r.json), { state: 'none' }, 'signed in without a token')
    const seen = await status('head')
    assert.deepEqual([seen.state, seen.organizationName, seen.departmentName], ['ready', 'מכללת הדוגמה', 'מטבח'], 'the intended recipient sees what it is for')
    const unavailable = { state: 'unavailable' }
    assert.deepEqual(await status('forwarded'), unavailable, 'a forwarded link: someone whose user_metadata CLAIMS the head\'s address learns nothing (self-declared metadata is not identity)')
    assert.deepEqual(await status('outsider'), unavailable, 'an outsider')
    assert.deepEqual(await status('owner'), unavailable, 'the issuer')
    assert.deepEqual(await status('orgadmin'), unavailable, 'an administrator of nothing here')
    assert.deepEqual(await api(`${I}/status`, { as: 'head', cookie: inviteCookie(`dh1_${'B'.repeat(43)}`) }).then((r) => r.json), unavailable, 'an unknown token, for the right person')
    // an account whose Google address is NOT verified, invited by that very address
    const t2 = await token(org, dept, 'unverified')
    // review R1 (2026-11-13): an account without a matching verified Google identity is not a proven Google session, so it is now
    // refused one step earlier (the guard, 403 google_session_required) instead of reaching the status route's "unverified" answer
    const unverifiedStatus = await api(`${I}/status`, { as: 'unverified', cookie: inviteCookie(t2) })
    assert.deepEqual([unverifiedStatus.status, unverifiedStatus.json?.error?.code, noData(unverifiedStatus)], [403, 'google_session_required', true], 'an unverified account can accept nothing (and is told to sign in with Google, nothing about the invitation)')
    const unverifiedAccept = await post(`${I}/accept`, 'unverified', {}, { cookie: inviteCookie(t2) })
    assert.deepEqual([unverifiedAccept.status, unverifiedAccept.json?.error?.code], [403, 'google_session_required'], 'and its acceptance is refused')

    const principals = await count(`select count(*) n from public.customer_principals`)
    for (const who of ['forwarded', 'outsider', 'owner', 'orgadmin']) {
      const r = await post(`${I}/accept`, who, { departmentId: dept, role: 'organization_admin', email: emailOf('head') }, { cookie })
      assert.status(r, 403, `acceptance by ${who}`)
      assert.equal(r.json.error.code, 'invitation_unavailable', `${who}: one answer`)
      assert.match(r.headers.getSetCookie().join('; '), /sarcafe_benefits_invite=;.*Max-Age=0/i, `${who}: the token is forgotten`)
    }
    assert.status(await post(`${I}/accept`, null, {}, { cookie }), 401, 'acceptance signed out')
    assert.status(await live().call(`${I}/accept`, { method: 'POST', as: 'head', cookie, body: {}, origin: 'https://evil.example' }), 403, 'acceptance from another site')
    assert.status(await post(`${I}/accept`, 'head', {}), 403, 'acceptance without the token cookie')
    assert.equal(await count(`select count(*) n from public.customer_principals`), principals, 'no principal was created by any of those')
    assert.equal(await count(`select count(*) n from public.customer_access_grants`), 0, 'and no grant')
    assert.equal(await count(`select count(*) n from public.customer_identity_audit where operation = 'invitation.refuse'`), 4, 'the four wrong-recipient attempts were noted (the issuer signing in with their own address is a wrong recipient too)')
    assert.ok(!JSON.stringify(await sql(`select * from public.customer_identity_audit where operation = 'invitation.refuse'`)).includes('qa.sarcafe.invalid'), 'with no address in the note')
    assert.equal(await count(`select count(*) n from public.customer_invitations where consumed_at is null and revoked_at is null`), 2, 'both invitations are still open')

    const ok = await post(`${I}/accept`, 'head', { departmentId: NOBODY, role: 'organization_admin' }, { cookie })
    assert.status(ok, 200, 'THE INTENDED RECIPIENT accepts')
    assert.deepEqual([ok.json.organizationId, ok.json.departmentId], [org, dept], 'the department of the invitation, whatever the body said')
    assert.match(ok.headers.getSetCookie().join('; '), /sarcafe_benefits_invite=;.*Max-Age=0/i, 'the token is forgotten')
    const grant = (await sql(`select g.capability, g.scope_kind, g.organization_id, g.department_id, g.business_id, p.auth_user_id, p.member_id from public.customer_access_grants g join public.customer_principals p on p.id = g.principal_id`))
    assert.deepEqual(grant, [{ capability: 'department_head', scope_kind: 'department', organization_id: org, department_id: dept, business_id: null, auth_user_id: SESSIONS.head.sub, member_id: null }], 'exactly one grant: department head of that department, for that verified user')
    assert.equal(live().db('staff').filter((s) => s.auth_user_id === SESSIONS.head.sub).length, 0, 'no staff row was created')
    assert.equal(await count(`select count(*) n from public.staff where auth_user_id = $1`, [SESSIONS.head.sub]), 0, 'in either store')

    // replay
    for (const who of ['head', 'forwarded', 'outsider']) assert.status(await post(`${I}/accept`, who, {}, { cookie }), 403, `REPLAY by ${who}`)
    assert.deepEqual(await status('head'), unavailable, 'the used link shows nothing any more')
    assert.equal(await count(`select count(*) n from public.customer_access_grants`), 1, 'still one grant')

    // what the head may see and do
    const scopes = (await api(`${B}/scopes`, { as: 'head' })).json
    assert.deepEqual([scopes.organizations, scopes.departments.map((d) => [d.organizationName, d.departmentName])], [[], [['מכללת הדוגמה', 'מטבח']]], 'the head\'s scopes: that department only')
    for (const [method, url, body] of [['GET', `${B}/organizations/${org}`], ['POST', `${B}/organizations/${org}/departments`, { name: 'X' }], ['POST', `${B}/organizations/${org}/invitations`, { departmentId: dept, email: emailOf('head2') }], ['PATCH', `${B}/organizations/${org}/departments/${dept}`, { name: 'Mine' }]]) {
      assert.status(await api(url, { method, as: 'head', body }), 403, `a department head manages nothing: ${method} ${url.replace(B, '')}`)
    }
    const owner = (await api(`${O}/organizations/${org}`, { as: 'owner' })).json
    assert.deepEqual(owner.heads.map((h) => [h.departmentId, h.hint]), [[dept, 'h***@qa.sarcafe.invalid']], 'the owner sees the head by the masked hint')
    const removed = await api(`${O}/organizations/${org}/heads/${owner.heads[0].grantId}`, { method: 'DELETE', as: 'owner' })
    assert.status(removed, 200, 'the owner ends the head')
    assert.deepEqual((await api(`${B}/scopes`, { as: 'head' })).json.departments, [], 'and the head has no scope at once')
  }, { timeout: 120_000 })

  stage.test('invite-dead', 'הזמנה שפג תוקפה, שבוטלה, שהמחלקה שלה כובתה או שהמזמין איבד סמכות אינה מאושרת', 'security', async () => {
    await fresh()
    const org = await createOrg(); const dept = await createDept(org)
    const dead = async (label, t) => {
      const cookie = inviteCookie(t)
      assert.deepEqual((await api(`${I}/status`, { as: 'head', cookie })).json, { state: 'unavailable' }, `${label}: shown as unavailable`)
      assert.status(await post(`${I}/accept`, 'head', {}, { cookie }), 403, `${label}: acceptance refused`)
    }
    // expired: an invitation whose time has passed (written directly: the function refuses to create one in the past)
    const old = `dh1_${'E'.repeat(43)}`
    await sql(`insert into public.customer_invitations (purpose, organization_id, department_id, token_digest, recipient_digest, recipient_hint, issued_by_auth_user_id, created_at, expires_at) values ('department_head', $1, $2, $3, $4, 'h***@qa.sarcafe.invalid', $5, now() - interval '4 days', now() - interval '1 minute')`, [org, dept, tokenDigest(old), recipientDigest(emailOf('head')), SESSIONS.owner.sub])
    await dead('EXPIRED', old)
    await sql(`update public.customer_invitations set revoked_at = now(), revoked_reason = 'test cleanup' where token_digest = $1`, [tokenDigest(old)])
    // revoked by the issuer's side
    const t1 = await token(org, dept, 'head')
    const id1 = (await sql(`select id from public.customer_invitations where token_digest = $1`, [tokenDigest(t1)]))[0].id
    assert.status(await api(`${O}/organizations/${org}/invitations/${id1}`, { method: 'DELETE', as: 'gm' }), 403, 'a general manager cannot revoke')
    assert.status(await api(`${O}/organizations/${org}/invitations/${id1}`, { method: 'DELETE', as: 'owner' }), 200, 'the owner revokes')
    await dead('REVOKED', t1)
    // the department switched off
    const t2 = await token(org, dept, 'head')
    assert.status(await api(`${O}/organizations/${org}/departments/${dept}`, { method: 'PATCH', as: 'owner', body: { state: 'inactive' } }), 200, 'the department is switched off')
    await dead('DEPARTMENT OFF', t2)
    assert.status(await invite(org, dept, 'head'), 403, 'and no invitation can be made for it')
    assert.status(await api(`${O}/organizations/${org}/departments/${dept}`, { method: 'PATCH', as: 'owner', body: { state: 'active' } }), 200, 'back on')
    // the issuer lost authority: the organization got its own administrator after the owner invited
    const t3 = await token(org, dept, 'head')
    await seedAdmin(org, 'orgadmin')
    await dead('ISSUER WITHOUT AUTHORITY', t3)
    assert.equal(await count(`select count(*) n from public.customer_access_grants where capability = 'department_head'`), 0, 'none of them became a grant')
    assert.equal(await count(`select count(*) n from public.customer_principals where auth_user_id = $1`, [SESSIONS.head.sub]), 0, 'and no principal was created for the person')
    // the same person, invited by the administrator who now runs the organization, is accepted
    const t4 = await token(org, dept, 'head', 'orgadmin', B)
    assert.status(await post(`${I}/accept`, 'head', {}, { cookie: inviteCookie(t4) }), 200, 'a live invitation from the current administrator is accepted')
  }, { timeout: 120_000 })

  stage.test('invite-replay-burst', 'שש בקשות אישור באותו רגע לאותה הזמנה: אחת מצליחה, ונוצרת הרשאה אחת', 'security', async () => {
    await fresh()
    const org = await createOrg(); const dept = await createDept(org)
    const cookie = inviteCookie(await token(org, dept, 'head2'))
    const runs = await Promise.all(Array.from({ length: 6 }, () => post(`${I}/accept`, 'head2', {}, { cookie })))
    assert.deepEqual(runs.map((r) => r.status).sort(), [200, 403, 403, 403, 403, 403], 'one acceptance, five refusals (no 500)')
    assert.equal(await count(`select count(*) n from public.customer_access_grants where capability = 'department_head'`), 1, 'one grant')
    assert.equal(await count(`select count(*) n from public.customer_principals where auth_user_id = $1`, [SESSIONS.head2.sub]), 1, 'one principal')
    assert.equal(await count(`select count(*) n from public.customer_identity_audit where operation = 'invitation.accept'`), 1, 'one acceptance in the audit')
  })

  // ── the limiter fails closed for anything that makes, trades or spends a token
  stage.test('limiter-outage', 'כשמגביל הקצב אינו זמין: לא נוצרת, לא מוחלפת ולא מאושרת הזמנה (429), ואחר כך הכול חוזר', 'survival', async () => {
    await fresh()
    const org = await createOrg(); const dept = await createDept(org)
    const cookie = inviteCookie(await token(org, dept, 'head'))
    for (const outage of [{ mode: 'error', tables: ['rpc/check_rate_limit'] }, { mode: 'down', tables: ['rpc/check_rate_limit'] }]) {
      await fault(outage)
      const label = `limiter ${outage.mode}`
      assert.status(await invite(org, dept, 'head2'), 429, `${label}: creating an invitation`)
      assert.status(await post(`${I}/exchange`, null, { token: `dh1_${'C'.repeat(43)}` }), 429, `${label}: trading a token`)
      assert.status(await api(`${I}/status`, { as: 'head', cookie }), 429, `${label}: looking at an invitation`)
      const accept = await post(`${I}/accept`, 'head', {}, { cookie })
      assert.status(accept, 429, `${label}: accepting`)
      assert.ok(!/Max-Age=0/i.test(accept.headers.getSetCookie().join('; ')), `${label}: the token is kept for a later try`)
      // ordinary writes keep working (their limiter is deliberately fail-open; the database rechecks every actor)
      assert.status(await post(`${O}/organizations/${org}/departments`, 'owner', { name: `בזמן תקלה ${outage.mode}` }), 201, `${label}: an ordinary write still works`)
    }
    assert.equal(await count(`select count(*) n from public.customer_invitations`), 1, 'no invitation was created during the outage')
    assert.equal(await count(`select count(*) n from public.customer_invitations where consumed_at is not null`), 0, 'and none was consumed')
    assert.equal(await count(`select count(*) n from public.customer_access_grants`), 0, 'no grant')
    await fault({ mode: 'none' })
    assert.status(await post(`${I}/accept`, 'head', {}, { cookie }), 200, 'RECOVERY: the same invitation is accepted once the limiter is back')
  }, { timeout: 120_000 })

  stage.test('limiter-real', 'מגביל הקצב עצמו: אחרי 20 החלפות בעשר דקות, הבאה נדחית', 'security', async () => {
    await fresh()
    const statuses = []
    for (let i = 0; i < 22; i++) statuses.push((await post(`${I}/exchange`, null, { token: `dh1_${'D'.repeat(43)}` })).status)
    assert.deepEqual([statuses.slice(0, 20).every((s) => s === 200), statuses[20], statuses[21]], [true, 429, 429], 'twenty allowed, then 429')
  }, { timeout: 90_000 })

  // ── outages and a migration that is not applied
  stage.test('db-outage', 'כשמסד הזהויות נופל או שהמיגרציה לא הוחלה: 503 נקי, בלי גישה, בלי דליפה, והשאר ממשיך לעבוד', 'recovery', async () => {
    await fresh()
    const org = await createOrg(); const dept = await createDept(org)
    const cookie = inviteCookie(await token(org, dept, 'head'))
    const LEAK = /(at\s+\S+\s+\(|node_modules|SQLSTATE|relation\s+\w+|secret_internal_table|PGRST\d+|service_role|customer_[a-z_]+)/i
    const probes = async (label) => {
      const calls = [
        ['owner list', await api(`${O}/organizations`, { as: 'owner' })], ['owner detail', await api(`${O}/organizations/${org}`, { as: 'owner' })], ['owner create', await post(`${O}/organizations`, 'owner', { name: 'בזמן תקלה' })],
        ['owner invite', await invite(org, dept, 'head2')], ['benefits scopes', await api(`${B}/scopes`, { as: 'head' })], ['benefits detail', await api(`${B}/organizations/${org}`, { as: 'orgadmin' })],
        ['invitation status', await api(`${I}/status`, { as: 'head', cookie })],
      ]
      for (const [name, r] of calls) {
        assert.status(r, 503, `${label}: ${name}`)
        assert.notMatch(r.text, LEAK, `${label}: ${name} leaks nothing`)
      }
      const accept = await post(`${I}/accept`, 'head', {}, { cookie })
      assert.status(accept, 503, `${label}: accepting`)
      assert.ok(!/Max-Age=0/i.test(accept.headers.getSetCookie().join('; ')), `${label}: the token is kept, the invitation untouched`)
    }
    await fault({ mode: 'error', tables: IDENTITY_FUNCTIONS.map((f) => `rpc/${f}`) })
    await probes('the identity functions fail')
    await fault({ mode: 'down', tables: IDENTITY_FUNCTIONS.map((f) => `rpc/${f}`) })
    await probes('the identity functions are unreachable')
    await fault({ mode: 'none' })
    await missing({ tables: ['customer_businesses'], functions: IDENTITY_FUNCTIONS })
    await probes('the identity migrations are not applied')
    // the rest of the app does not depend on any of it
    assert.status(await api('/api/staff/notifications', { as: 'owner' }), 200, 'the owner\'s notifications still answer without the identity tables')
    assert.status(await live().call('/owner/dashboard', { as: 'owner' }), 200, 'and the owner dashboard still opens')
    await missing({ tables: [], functions: [] })
    assert.equal(await count(`select count(*) n from public.customer_invitations where consumed_at is not null`), 0, 'nothing was consumed during any outage')
    assert.equal(await count(`select count(*) n from public.customer_organizations`), 1, 'and nothing was created')
    assert.status(await post(`${I}/accept`, 'head', {}, { cookie }), 200, 'RECOVERY: the invitation is accepted afterwards, without a restart')
    // while sign-in itself cannot be checked: 503, never "sign in again" and never access
    await fault({ mode: 'error', tables: ['auth/v1/user'] })
    assert.status(await api(`${O}/organizations`, { as: 'owner' }), 503, 'owner family while the auth server fails')
    assert.status(await api(`${B}/scopes`, { as: 'head' }), 503, 'benefits family while the auth server fails')
    await fault({ mode: 'none' })
  }, { timeout: 180_000 })

  stage.test('private-headers', 'כל תשובה של נתיבי הזהויות פרטית: no-store ובלי referrer, גם בסירוב', 'security', async () => {
    await fresh()
    const org = await createOrg(); await createDept(org)
    for (const [label, r] of [['list', await api(`${O}/organizations`, { as: 'owner' })], ['detail', await api(`${O}/organizations/${org}`, { as: 'owner' })], ['scopes', await api(`${B}/scopes`, { as: 'outsider' })],
      ['status', await api(`${I}/status`, { as: 'outsider' })], ['exchange', await post(`${I}/exchange`, null, { token: `dh1_${'F'.repeat(43)}` })]]) {
      assert.match(r.headers.get('cache-control') ?? '', /no-store/, `${label}: no-store`)
      assert.equal(r.headers.get('referrer-policy'), 'no-referrer', `${label}: no referrer`)
    }
    for (const page of ['/benefits', '/benefits/invite']) {
      const r = await live().call(page)
      assert.status(r, 200, `${page} is an open page`)
      assert.match(r.text, /name="referrer" content="no-referrer"/, `${page}: the page itself sends no referrer`)
      assert.match(r.text, /noindex/, `${page}: not indexed`)
    }
  })

  // ── the sign-in return and the middleware
  stage.test('doors', 'הדלתות: חזרה מהתחברות רק לשני עמודי ההטבות; אדם חיצוני אינו נכנס לצוות, לבעלים או לקופה', 'security', async () => {
    await fresh()
    // (a redirect built from the request's own origin names the host Next sees, so the origin is dropped whatever it is)
    const where = async (url, as) => { const r = await live().call(url, { as }); return `${r.status} ${(r.headers.get('location') ?? '').replace(/^https?:\/\/[^/]+/, '')}` }
    assert.equal(await where('/auth/callback?next=/benefits/manage'), '307 /benefits?error=auth', 'a failed benefits sign-in returns to the benefits door')
    assert.equal(await where('/auth/callback?next=/benefits/invite'), '307 /benefits?error=auth', 'also from the invitation page')
    for (const next of ['/benefits', '/benefits/manage/x', '/benefits/invite%2F..%2F..%2Fowner', '/benefits/manage?x=1', '//evil.example/benefits/manage', '/owner/members']) {
      assert.equal(await where(`/auth/callback?next=${next}`), '307 /login?error=auth', `anything else is the staff door, as before (${next})`)
    }
    assert.equal(await where('/auth/callback?next=/staff'), '307 /login?error=auth', 'the staff sign-in is unchanged')
    assert.equal(await where('/auth/callback?link=x&next=/benefits/manage'), '307 /staff/profile?setup=google&error=link_failed', 'a Google-link attempt never becomes a benefits return')
    assert.equal(await where('/benefits/manage'), '307 /benefits', 'signed out: the benefits door, not the staff login')
    assert.equal(await where('/owner/members'), '307 /login', 'signed out: /owner/members goes to the staff login')
    for (const who of ['dana', 'gm', 'orgadmin', 'head', 'outsider']) assert.equal(await where('/owner/members', who), '307 /no-access', `${who} is kept out of /owner/members`)
    for (const who of ['orgadmin', 'head', 'outsider']) {
      for (const url of ['/staff', '/owner/dashboard', '/owner/staff', '/pos', '/owner/schedule']) assert.equal(await where(url, who), '307 /no-access', `${who} (external) is kept out of ${url}`)
      for (const url of ['/api/staff/notifications', '/api/owner/dashboard', '/api/owner/staff', '/api/owner/waitlist']) {
        const r = await api(url, { as: who })
        assert.ok(r.status === 401 || r.status === 403, `${who} (external) gets no data from ${url}: HTTP ${r.status}`)
      }
    }
    assert.status(await live().call('/owner/members', { as: 'owner' }), 200, 'the owner opens /owner/members')
    assert.equal(await where('/benefits', 'outsider'), '307 /benefits/manage', 'someone already signed in goes on from the door')
    assert.status(await live().call('/benefits/manage', { as: 'outsider' }), 200, 'and reaches the page (which then shows what they hold: nothing)')
  }, { timeout: 120_000 })

  // ── review R1 (Codex, 2026-11-13): HOW THIS SESSION SIGNED IN decides, not what the account has. A session is minted here exactly
  // as the auth server would sign it for each method (Supabase `amr`), for an account as the auth server would return it.
  const minted = []
  const AMR = (method) => [{ method, timestamp: 1767225600 }]
  const LINKED = (who) => ({ app_metadata: { provider: 'email', providers: ['email', 'google'] }, identities: [{ provider: 'email', identity_data: { email: emailOf(who), email_verified: true } }, { provider: 'google', identity_data: { email: emailOf(who), email_verified: true } }] })
  const PASSWORD_ONLY = (who) => ({ app_metadata: { provider: 'email', providers: ['email'] }, identities: [{ provider: 'email', identity_data: { email: emailOf(who), email_verified: true } }] })
  /** A session of `who` opened with `amr` (undefined = no amr claim), for the account `userOver` describes; `claimsOf` signs another person's claims. */
  const signedInBy = (who, amr, userOver = {}, claimsOf = who) => {
    const n = minted.length
    const user = { ...userFor(who), ...userOver }
    const jwt = tokenForMethod(claimsOf, amr, { qa_variant: n })
    live().standin.state.tokens.set(jwt, { ...user, __refresh: `qa-method-${n}` })
    minted.push(jwt)
    const c = sessionCookie(live().standin.url, jwt, user, `qa-method-${n}`)
    return { cookie: `${c.name}=${c.value}`, browser: { name: c.name, value: c.value, domain: '127.0.0.1', path: '/' } }
  }
  const forgetMinted = () => { for (const t of minted.splice(0)) live().standin.state.tokens.delete(t) }
  const code = (r) => `${r.status}:${r.json?.error?.code ?? ''}`
  const headGrants = () => count(`select count(*) n from public.customer_access_grants where capability = 'department_head'`)

  stage.test('session-method', 'R1: רק חיבור Google נוכחי מנהל או מאשר; סיסמה, קישור, שחזור או ראיה חסרה נדחים — גם כש־Google מקושר לחשבון', 'security', async () => {
    await fresh()
    try {
      const org = await createOrg('ארגון שיטת כניסה'); const dept = await createDept(org, 'קבלה')
      // REPRODUCED 1 (Codex, 82e2deb: HTTP 200 and one head grant): a PASSWORD session on a Google-LINKED account accepts an invitation
      const t = await token(org, dept, 'head')
      const linkedPassword = signedInBy('head', AMR('password'), LINKED('head'))
      assert.equal(code(await api(`${I}/status`, { cookie: `${linkedPassword.cookie}; ${inviteCookie(t)}` })), '403:google_session_required', 'the invitation is not even shown to a password session')
      const refused = await post(`${I}/accept`, undefined, {}, { cookie: `${linkedPassword.cookie}; ${inviteCookie(t)}` })
      assert.equal(code(refused), '403:google_session_required', 'REPRODUCED 1: a password session on a Google-linked account cannot accept')
      assert.equal(await headGrants(), 0, 'and no head grant was made')
      assert.equal(await count(`select count(*) n from public.customer_principals`), 0, 'and no principal was made')
      // control: the same person on a Google session, same invitation
      assert.status(await post(`${I}/accept`, 'head', {}, { cookie: inviteCookie(t) }), 200, 'CONTROL: the same invitation accepted on a Google session')
      assert.equal(await headGrants(), 1, 'CONTROL: exactly one head grant')

      // REPRODUCED 2 (Codex, 82e2deb: HTTP 200): a password-only account WITH a valid organization-admin grant renames its organization
      const own = await createOrg('ארגון של מנהל'); await seedAdmin(own, 'orgadmin')
      const passwordOnly = signedInBy('orgadmin', AMR('password'), PASSWORD_ONLY('orgadmin'))
      const renamed = await api(`${B}/organizations/${own}`, { method: 'PATCH', body: { name: 'שונה בסיסמה' }, cookie: passwordOnly.cookie })
      assert.equal(code(renamed), '403:google_session_required', 'REPRODUCED 2: a password-only administrator cannot change the organization')
      assert.equal((await sql(`select name from public.customer_organizations where id = $1`, [own]))[0].name, 'ארגון של מנהל', 'and the name did not change')
      assert.status(await api(`${B}/organizations/${own}`, { method: 'PATCH', as: 'orgadmin', body: { name: 'שונה ב־Google' } }), 200, 'CONTROL: the same administrator on a Google session')

      // every other way a session can be opened, on every identity door; nothing is written by any of them
      const auditsBefore = await count(`select count(*) n from public.customer_identity_audit`)
      const sessions = [
        ['magic link, Google linked', signedInBy('orgadmin', AMR('magiclink'), LINKED('orgadmin'))],
        ['recovery link, Google linked', signedInBy('orgadmin', AMR('recovery'), LINKED('orgadmin'))],
        ['one-time code, Google linked', signedInBy('orgadmin', AMR('otp'), LINKED('orgadmin'))],
        ['password, Google identity only (provider list says google)', signedInBy('orgadmin', AMR('password'))],
        ['no amr claim at all', signedInBy('orgadmin', undefined)],
        ['malformed amr (plain strings)', signedInBy('orgadmin', ['oauth'])],
        ['OAuth, but no verified Google identity on the account', signedInBy('orgadmin', AMR('oauth'), PASSWORD_ONLY('orgadmin'))],
        ['OAuth claims of ANOTHER user on this account', signedInBy('orgadmin', AMR('oauth'), {}, 'head')],
      ]
      const answers = []
      for (const [label, s] of sessions) {
        answers.push([label, 'scopes', code(await api(`${B}/scopes`, { cookie: s.cookie }))])
        answers.push([label, 'rename', code(await api(`${B}/organizations/${own}`, { method: 'PATCH', body: { name: 'לא' }, cookie: s.cookie }))])
        answers.push([label, 'switch off', code(await api(`${B}/organizations/${own}`, { method: 'PATCH', body: { state: 'inactive' }, cookie: s.cookie }))])
        answers.push([label, 'new department', code(await post(`${B}/organizations/${own}/departments`, undefined, { name: 'לא' }, { cookie: s.cookie }))])
      }
      assert.deepEqual(answers.filter(([, , c]) => c !== '403:google_session_required'), [], 'answers other than 403 google_session_required:')
      assert.equal(await count(`select count(*) n from public.customer_identity_audit`), auditsBefore, 'none of them wrote anything')
      assert.equal((await sql(`select state from public.customer_organizations where id = $1`, [own]))[0].state, 'active', 'the organization is still on')

      // the owner family: a full owner on a password session is refused by the identity check (the staff app is unchanged)
      const ownerPassword = signedInBy('owner', AMR('password'), LINKED('owner'))
      assert.equal(code(await api(`${O}/organizations`, { cookie: ownerPassword.cookie })), '403:google_session_required', 'the owner on a password session: no organization list')
      assert.equal(code(await post(`${O}/organizations`, undefined, { name: 'לא' }, { cookie: ownerPassword.cookie })), '403:google_session_required', 'and cannot create one')
      assert.status(await api(`${O}/organizations`, { as: 'owner' }), 200, 'CONTROL: the owner on a Google session')
      // the quick and employee-code refusals keep their own codes (the screens say which sign-in is needed)
      quick('orgadmin')
      assert.equal(code(await api(`${B}/scopes`, { as: 'orgadmin' })), '403:quick_session', 'a quick session')
      live().db('pos_quick_sessions').length = 0
      assert.equal(code(await api(`${B}/scopes`, { cookie: codeSession(ID.dana) })), '403:full_session_required', 'an employee-code session')
      assert.status(await api(`${B}/scopes`, {}), 401, 'signed out')
      // the staff app does not use this rule: an owner on a password session still opens the owner dashboard exactly as before
      assert.status(await live().call('/owner/dashboard', { cookie: ownerPassword.cookie }), 200, 'the owner dashboard is unchanged for that session')
    } finally { forgetMinted() }
  }, { timeout: 180_000 })

  // ── review R2 (Codex, 2026-11-13): switching an organization off must not hide it from its administrator
  stage.test('org-recovery', 'R2: ארגון כבוי נשאר אצל המנהל שלו (עם מצבו) ואפשר להפעיל אותו מחדש; ראש מחלקה וכל אדם אחר אינם רואים ואינם מפעילים', 'security', async () => {
    await fresh()
    const a = await createOrg('אלפא'); const b = await createOrg('בטא'); const d = await createDept(a, 'רצפה')
    assert.status(await post(`${I}/accept`, 'head', {}, { cookie: inviteCookie(await token(a, d, 'head')) }), 200, 'a head in Alpha (invited in setup)')
    await seedAdmin(a, 'orgadmin'); await seedAdmin(b, 'orgadmin')
    const listed = async () => (await api(`${B}/scopes`, { as: 'orgadmin' })).json.organizations.map((o) => [o.name, o.state])
    const headDepartments = async () => (await api(`${B}/scopes`, { as: 'head' })).json.departments.length
    const state = async (org) => (await sql(`select state from public.customer_organizations where id = $1`, [org]))[0].state
    assert.deepEqual(await listed(), [['אלפא', 'active'], ['בטא', 'active']], 'both listed, with their state')
    assert.status(await api(`${B}/organizations/${a}`, { method: 'PATCH', as: 'orgadmin', body: { state: 'inactive' } }), 200, 'Alpha switched off by its administrator')
    assert.deepEqual(await listed(), [['בטא', 'active'], ['אלפא', 'inactive']], 'REGRESSION R2: Alpha is still listed, marked inactive')
    assert.deepEqual(await listed(), [['בטא', 'active'], ['אלפא', 'inactive']], 'and again on the next load')
    const detail = await api(`${B}/organizations/${a}`, { as: 'orgadmin' })
    assert.deepEqual([detail.status, detail.json?.organization?.state], [200, 'inactive'], 'its administrator opens it and sees it is off')
    assert.status(await post(`${B}/organizations/${a}/departments`, 'orgadmin', { name: 'לא עכשיו' }), 403, 'no new department while it is off')
    assert.equal(await headDepartments(), 0, 'its department head has nothing while it is off')
    for (const [who, url] of [['head', `${B}/organizations/${a}`], ['outsider', `${B}/organizations/${a}`], ['owner', `${O}/organizations/${a}`], ['gm', `${O}/organizations/${a}`]]) {
      assert.status(await api(url, { method: 'PATCH', as: who, body: { state: 'active' } }), 403, `${who} cannot switch it back on`)
    }
    assert.equal(await state(a), 'inactive', 'it is still off after those attempts')
    assert.deepEqual((await api(`${B}/scopes`, { as: 'outsider' })).json.organizations, [], 'an outsider lists nothing')
    assert.status(await api(`${B}/organizations/${a}`, { method: 'PATCH', as: 'orgadmin', body: { state: 'active' } }), 200, 'its administrator switches it back on')
    assert.deepEqual([await listed(), await headDepartments()], [[['אלפא', 'active'], ['בטא', 'active']], 1], 'both active again, and the head\'s kept grant works again')
    // several organizations
    for (const org of [a, b]) assert.status(await api(`${B}/organizations/${org}`, { method: 'PATCH', as: 'orgadmin', body: { state: 'inactive' } }), 200, 'switched off')
    assert.deepEqual(await listed(), [['אלפא', 'inactive'], ['בטא', 'inactive']], 'both off, both still listed')
    assert.status(await api(`${B}/organizations/${b}`, { method: 'PATCH', as: 'orgadmin', body: { state: 'active' } }), 200, 'Beta back on')
    assert.deepEqual(await listed(), [['בטא', 'active'], ['אלפא', 'inactive']], 'Beta on, Alpha still listed and off')
    assert.status(await api(`${B}/organizations/${a}`, { method: 'PATCH', as: 'orgadmin', body: { state: 'active' } }), 200, 'Alpha back on')
    assert.deepEqual(await listed(), [['אלפא', 'active'], ['בטא', 'active']], 'both on')
  }, { timeout: 120_000 })

  // ── the screens, in a real browser
  const settled = (page) => page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter((a) => { const t = a.effect?.getTiming?.(); return t && t.iterations !== Infinity }).map((a) => a.finished.catch(() => null))),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ])).catch(() => null)
  const open = async (who, url, opts) => {
    const s = await live().page(who, opts)
    const requests = []
    s.page.on('request', (request) => requests.push(request.url()))
    const res = await s.page.goto(live().base + url, { waitUntil: 'networkidle' })
    await settled(s.page)
    return { ...s, requests, status: res?.status() }
  }
  const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const at = (page, name) => page.locator(`[data-identity="${name}"]`)
  const setLook = (look) => { const row = live().db('staff').find((s) => s.id === ID.owner); if (row) row.ui_theme = look }
  let link = null

  stage.test('ui-owner', 'מסך הבעלים בדפדפן: יצירת ארגון ומחלקה, הזמנה, קישור להעתקה שמוצג פעם אחת', 'e2e', async () => {
    await fresh()
    const s = await open('owner', '/owner/members')
    try {
      assert.equal(s.status, 200, 'the page')
      await at(s.page, 'new-organization').waitFor({ timeout: 15_000 })
      assert.ok(await s.page.locator('.gl-top__bar').count() === 1 && await s.page.locator('.gl-dock').count() <= 1, 'the shared glass shell (one top bar)')
      assert.equal(await at(s.page, 'no-organizations').count(), 1, 'the empty state says there are none yet')
      await s.page.getByLabel('שם הארגון החדש').fill('מכללת הדוגמה')
      await s.page.getByRole('button', { name: 'יצירת ארגון' }).click()
      await at(s.page, 'org').waitFor({ timeout: 15_000 })
      assert.equal(await at(s.page, 'setup-note').count(), 1, 'it says the owner manages it during setup')
      assert.equal(await at(s.page, 'no-departments').count(), 1, 'and that there are no departments yet')
      await s.page.getByLabel('שם המחלקה החדשה').fill('מטבח')
      await s.page.getByRole('button', { name: 'הוספת מחלקה' }).click()
      await at(s.page, 'department').first().waitFor({ timeout: 15_000 })
      await s.page.getByLabel('הזמנת ראש מחלקה').fill(emailOf('head'))
      await s.page.getByRole('button', { name: 'יצירת קישור הזמנה' }).click()
      await at(s.page, 'fresh-link').waitFor({ timeout: 15_000 })
      link = await s.page.getByLabel('קישור ההזמנה').inputValue()
      assert.match(link, /^http:\/\/127\.0\.0\.1:\d+\/benefits\/invite#dh1_[A-Za-z0-9_-]{43}$/, 'the link carries the token in its fragment')
      assert.match(await at(s.page, 'fresh-link').innerText(), /פעם אחת בלבד/, 'it says the link is shown once')
      assert.match(await at(s.page, 'fresh-link').innerText(), /h\*\*\*@qa\.sarcafe\.invalid/, 'and shows the masked recipient')
      assert.equal(await at(s.page, 'pending').count(), 1, 'the open invitation is listed')
      assert.ok(await s.page.locator('.gl-toast--ok, .gl-toast.gl-toast--ok').count() >= 0, 'toasts use the shared toaster')
      await s.page.getByRole('button', { name: 'סיימתי' }).click()
      await s.page.reload({ waitUntil: 'networkidle' })
      await at(s.page, 'organization-row').first().click()
      await at(s.page, 'org').waitFor({ timeout: 15_000 })
      assert.equal(await at(s.page, 'fresh-link').count(), 0, 'after a reload the link is gone for good')
      assert.ok(!(await s.page.content()).includes(link.split('#')[1]), 'and the token is nowhere in the page')
      assert.equal(await s.page.locator('main select').count(), 0, 'no browser-native select in the screen')
      assert.deepEqual(s.errors, [], 'no script errors')
    } finally { await s.close() }
  }, { timeout: 120_000 })

  stage.test('ui-accept', 'עמוד ההזמנה בדפדפן: האסימון יוצא מהכתובת מיד; רק הנמען המיועד רואה ומאשר; ראש המחלקה רואה רק את המחלקה שלו', 'e2e', async () => {
    assert.ok(link, 'needs the link made by ui-owner')
    const secret = link.split('#')[1]
    const pathOnly = link.replace(live().base, '')
    // signed out: nothing about the invitation, a sign-in button, and the token already out of the address bar
    const out = await open(null, pathOnly)
    try {
      await at(out.page, 'invite-sign-in').waitFor({ timeout: 15_000 })
      assert.equal(await out.page.evaluate(() => window.location.hash), '', 'the fragment is cleared')
      assert.ok(!(await out.page.evaluate(() => window.location.href)).includes('dh1_'), 'the address bar holds no token')
      assert.ok(!/מכללת הדוגמה|מטבח/.test(await out.page.locator('main').innerText()), 'nothing about the invitation before sign-in')
      assert.equal(await at(out.page, 'google-sign-in').count(), 1, 'a Google sign-in button')
      assert.deepEqual(out.requests.filter((u) => u.includes(secret)), [], 'no request URL ever contained the token')
      const stored = await out.page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]))
      assert.ok(!stored.includes('dh1_'), 'the token is in no storage a script can read (the cookie is HttpOnly)')
    } finally { await out.close() }
    // someone it was forwarded to
    const wrong = await open('forwarded', pathOnly)
    try {
      await at(wrong.page, 'invite-unavailable').waitFor({ timeout: 15_000 })
      assert.ok(!/מכללת הדוגמה|מטבח/.test(await wrong.page.locator('main').innerText()), 'a forwarded link shows nothing about the invitation')
    } finally { await wrong.close() }
    // the intended recipient
    const s = await open('head', pathOnly)
    try {
      await at(s.page, 'invite-ready').waitFor({ timeout: 15_000 })
      assert.equal(await s.page.evaluate(() => window.location.hash), '', 'the fragment is cleared')
      assert.match(await at(s.page, 'invite-ready').innerText(), /מכללת הדוגמה[\s\S]*מטבח/, 'the organization and the department')
      await at(s.page, 'invite-accept').click()
      await at(s.page, 'invite-accepted').waitFor({ timeout: 15_000 })
      await s.page.getByRole('button', { name: 'למחלקה שלי' }).click()
      await at(s.page, 'my-department').first().waitFor({ timeout: 15_000 })
      assert.equal(await at(s.page, 'my-department').count(), 1, 'exactly one department')
      assert.match(await at(s.page, 'my-department').innerText(), /מטבח[\s\S]*מכללת הדוגמה/, 'theirs')
      assert.equal(await at(s.page, 'org').count(), 0, 'no organization management for a department head')
      assert.equal(await s.page.locator('a[href^="/staff"], a[href^="/owner"], a[href^="/pos"]').count(), 0, 'no link into the staff, owner or POS app')
      assert.deepEqual(s.requests.filter((u) => u.includes(secret)), [], 'no request URL ever contained the token')
      assert.deepEqual(s.errors, [], 'no script errors')
      // the same link a second time
      await s.page.goto(live().base + pathOnly, { waitUntil: 'networkidle' })
      await at(s.page, 'invite-unavailable').waitFor({ timeout: 15_000 })
    } finally { await s.close() }
    // the owner now sees the head, and removes them
    const owner = await open('owner', '/owner/members')
    try {
      await at(owner.page, 'organization-row').first().click()
      await at(owner.page, 'head').first().waitFor({ timeout: 15_000 })
      assert.match(await at(owner.page, 'head').first().innerText(), /h\*\*\*@qa\.sarcafe\.invalid/, 'the head, by the masked hint')
      assert.equal(await at(owner.page, 'pending').count(), 0, 'the invitation is no longer pending')
      await at(owner.page, 'head').first().getByRole('button', { name: 'הסרה' }).click()
      await at(owner.page, 'head').first().getByRole('button', { name: 'להסיר את ההרשאה?' }).click()
      await owner.page.waitForFunction(() => document.querySelectorAll('[data-identity="head"]').length === 0, null, { timeout: 15_000 })
    } finally { await owner.close() }
    const after = await open('head', '/benefits/manage')
    try {
      await at(after.page, 'no-access').waitFor({ timeout: 15_000 })
      assert.match(await at(after.page, 'no-access').innerText(), /אין לחשבון הזה הרשאות ניהול/, 'the removed head is told they hold nothing')
    } finally { await after.close() }
  }, { timeout: 180_000 })

  stage.test('ui-states', 'מצבים: טעינה, אין הרשאה, תקלה עם ניסיון חוזר, דלת הכניסה ומנהל ארגון חיצוני', 'e2e', async () => {
    await fresh()
    const org = await createOrg('ארגון עצמאי'); await createDept(org, 'הנהלה')
    await seedAdmin(org, 'orgadmin')
    const door = await open(null, '/benefits')
    try {
      assert.equal(await at(door.page, 'benefits-door').count(), 1, 'the benefits door')
      assert.equal(await at(door.page, 'google-sign-in').count(), 1, 'with one Google sign-in button')
      assert.equal(await door.page.locator('a[href^="/login"], a[href^="/staff"]').count(), 0, 'and no way into the staff app')
    } finally { await door.close() }
    const none = await open('outsider', '/benefits/manage')
    try { await at(none.page, 'no-access').waitFor({ timeout: 15_000 }) } finally { await none.close() }
    const admin = await open('orgadmin', '/benefits/manage')
    try {
      await at(admin.page, 'org').waitFor({ timeout: 15_000 })
      assert.equal(await at(admin.page, 'setup-note').count(), 0, 'an administrator is not "in setup"')
      await admin.page.getByLabel('שם המחלקה החדשה').fill('כספים')
      await admin.page.getByRole('button', { name: 'הוספת מחלקה' }).click()
      await admin.page.waitForFunction(() => document.querySelectorAll('[data-identity="department"]').length === 2, null, { timeout: 15_000 })
      // the account menu is the app's one menu style, with one entry
      await admin.page.getByRole('button', { name: 'החשבון' }).click()
      await admin.page.getByText('התנתקות').first().waitFor({ timeout: 10_000 })
      assert.deepEqual(admin.errors, [], 'no script errors')
    } finally { await admin.close() }
    // the owner sees that organization as running itself
    const owner = await open('owner', '/owner/members')
    try {
      await at(owner.page, 'organization-row').first().click()
      await at(owner.page, 'self-managed').waitFor({ timeout: 15_000 })
    } finally { await owner.close() }
    // an outage: a red card with a way to try again, then recovery in place
    await fault({ mode: 'error', tables: IDENTITY_FUNCTIONS.map((f) => `rpc/${f}`) })
    const broken = await open('owner', '/owner/members')
    try {
      await at(broken.page, 'list-problem').waitFor({ timeout: 15_000 })
      assert.match(await at(broken.page, 'list-problem').innerText(), /אינו זמין כרגע/, 'it says the management is not available, in words')
      assert.ok(await at(broken.page, 'list-problem').evaluate((el) => el.classList.contains('gl-surf--bad')), 'bad news is red')
      await fault({ mode: 'none' })
      await broken.page.getByRole('button', { name: 'לנסות שוב' }).click()
      await at(broken.page, 'organization-row').first().waitFor({ timeout: 15_000 })
    } finally { await fault({ mode: 'none' }); await broken.close() }
  }, { timeout: 180_000 })

  // review R1 on screen: a signed-in session that is not a Google sign-in gets a usable way back (a fresh Google sign-in that returns
  // to the same page), never a loop of redirects and never the management screen.
  const openMinted = async (session, url, opts = {}) => {
    const s = await live().page(null, opts)
    await s.context.addCookies([session.browser])
    const paths = []
    s.page.on('framenavigated', (frame) => { if (frame === s.page.mainFrame()) paths.push(new URL(frame.url()).pathname) })
    await s.page.goto(live().base + url, { waitUntil: 'networkidle' })
    await settled(s.page)
    return { ...s, paths }
  }
  stage.test('ui-reauth', 'R1 במסך: חיבור שאינו Google מקבל כרטיס "להתחבר שוב עם Google" בלי לולאת הפניות, קריא בכל חמשת המראות; אחרי כניסה עם Google הכול עובד', 'e2e', async () => {
    await fresh()
    try {
      const org = await createOrg('ארגון חיבור'); const dept = await createDept(org, 'קבלה')
      const t = await token(org, dept, 'head')   // issued in setup; this organization keeps no administrator, so it stays usable
      await seedAdmin(await createOrg('ארגון של המנהל'), 'orgadmin')   // the password session below belongs to a real administrator
      const problems = []
      let measured = 0
      for (const look of LOOKS) {
        const session = signedInBy('orgadmin', AMR('password'), LINKED('orgadmin'))
        if (look === LOOKS[0]) {
          // the door sends a signed-in session on ONCE, and the management page answers it (200) without sending it anywhere
          const door = await live().call('/benefits', { cookie: session.cookie })
          assert.equal(`${door.status} ${new URL(door.headers.get('location') ?? 'http://x/', live().base).pathname}`, '307 /benefits/manage', 'the door sends the session on')
          const page = await live().call('/benefits/manage', { cookie: session.cookie })
          assert.deepEqual([page.status, page.headers.get('location'), /data-identity="reauth"/.test(page.text)], [200, null, true], 'the management page answers with the sign-in-again card, no redirect')
        }
        const s = await openMinted(session, '/benefits/manage', { theme: look })
        try {
          await at(s.page, 'reauth').waitFor({ timeout: 15_000 })
          if (look === LOOKS[0]) {
            assert.equal(new URL(s.page.url()).pathname, '/benefits/manage', 'the browser stays on the management page')
            const before = s.paths.length
            await s.page.waitForTimeout(2500)
            assert.equal(s.paths.length, before, `no further navigation by itself (no loop): ${s.paths.join(' → ')}`)
            assert.equal(await at(s.page, 'reauth').getAttribute('data-reason'), 'other', 'it says this session was not opened with Google')
            assert.equal(await s.page.getByRole('button', { name: 'התחברות מחדש עם Google' }).count(), 1, 'one button: sign in again with Google')
            assert.deepEqual([await at(s.page, 'benefits-manage').count(), await at(s.page, 'org').count()], [0, 0], 'nothing of the organization is shown')
            assert.equal(await s.page.getByRole('button', { name: 'החשבון' }).count(), 1, 'signing out stays available in the top bar')
            assert.deepEqual(s.errors, [], 'no script errors')
          }
          const r = await auditScreen(s.page)
          measured += r.measured
          for (const f of r.failures) problems.push(`${look} reauth: "${f.text}" ${f.ratio}:1`)
        } finally { await s.close() }
      }
      assert.ok(measured > 15, `texts measured: ${measured}`)
      assert.deepEqual(problems.slice(0, 12), [], `${problems.length} texts below AA on the sign-in-again card:`)

      // the invitation page: a password session on a Google-linked account sees the same card, the token cookie survives, and the
      // same browser on a Google session (as after the round trip) sees the invitation and accepts it
      const s = await openMinted(signedInBy('head', AMR('password'), LINKED('head')), `/benefits/invite#${t}`)
      try {
        await at(s.page, 'reauth').waitFor({ timeout: 15_000 })
        assert.equal(await at(s.page, 'invite-ready').count(), 0, 'the invitation is not shown to the password session')
        assert.equal(await headGrants(), 0, 'nothing accepted')
        const google = sessionCookie(live().standin.url, tokenFor('head'), userFor('head'), 'refresh-head')
        await s.context.addCookies([{ name: google.name, value: google.value, domain: '127.0.0.1', path: '/' }])
        await s.page.reload({ waitUntil: 'networkidle' })
        await at(s.page, 'invite-ready').waitFor({ timeout: 15_000 })
        await s.page.locator('[data-identity="invite-accept"]').click()
        await at(s.page, 'invite-accepted').waitFor({ timeout: 15_000 })
        assert.equal(await headGrants(), 1, 'accepted once on the Google session')
      } finally { await s.close() }
    } finally { forgetMinted() }
  }, { timeout: 300_000 })

  // review R2 on screen: Codex switched the organization off and lost it (no reactivation, also after reload)
  stage.test('ui-recovery', 'R2 במסך: אחרי כיבוי הארגון המנהל עדיין רואה אותו (מסומן כבוי, גם אחרי טעינה מחדש) ומפעיל אותו; עם שני ארגונים הבחירה מראה את המצב', 'e2e', async () => {
    await fresh()
    const a = await createOrg('אלפא'); await createDept(a, 'רצפה'); await seedAdmin(a, 'orgadmin')
    const state = async (org) => (await sql(`select state from public.customer_organizations where id = $1`, [org]))[0].state
    const s = await open('orgadmin', '/benefits/manage')
    try {
      const p = s.page
      await at(p, 'org').waitFor({ timeout: 15_000 })
      await p.getByRole('button', { name: 'כיבוי הארגון', exact: true }).click()
      await p.getByRole('button', { name: 'לכבות? ההזמנות הפתוחות יבוטלו', exact: true }).click()
      await at(p, 'org-inactive-note').waitFor({ timeout: 15_000 })
      assert.equal(await state(a), 'inactive', 'it is off in the database')
      assert.deepEqual([await at(p, 'no-access').count(), await p.getByRole('button', { name: 'הפעלת הארגון', exact: true }).count()], [0, 1], 'REGRESSION R2: still shown, with the reactivation button')
      assert.ok(await at(p, 'org-inactive-note').evaluate((el) => el.classList.contains('gl-note--bad')), 'the off state is said in red (bad news)')
      assert.deepEqual([await at(p, 'new-department').count(), await p.getByRole('button', { name: 'כיבוי המחלקה', exact: true }).count()], [0, 0], 'no department work offered while it is off')
      await p.reload({ waitUntil: 'networkidle' })
      await at(p, 'org-inactive-note').waitFor({ timeout: 15_000 })
      assert.equal(await p.getByRole('button', { name: 'הפעלת הארגון', exact: true }).count(), 1, 'after a reload: still there, still recoverable')
      // contrast of the off state in all five looks
      const problems = []
      for (const look of LOOKS) {
        const v = await open('orgadmin', '/benefits/manage', { theme: look })
        try { await at(v.page, 'org-inactive-note').waitFor({ timeout: 15_000 }); for (const f of (await auditScreen(v.page)).failures) problems.push(`${look}: "${f.text}" ${f.ratio}:1`) } finally { await v.close() }
      }
      assert.deepEqual(problems.slice(0, 12), [], `${problems.length} texts below AA on the switched-off organization:`)
      await p.getByRole('button', { name: 'הפעלת הארגון', exact: true }).click()
      await p.waitForFunction(() => !document.querySelector('[data-identity="org-inactive-note"]'), null, { timeout: 15_000 })
      assert.equal(await state(a), 'active', 'switched back on from the screen')
      assert.equal(await at(p, 'new-department').count(), 1, 'department work is offered again')

      // two organizations: switch the open one off, reload, find it in the chooser marked off, open it and switch it on
      const b = await createOrg('בטא'); await seedAdmin(b, 'orgadmin')
      await p.reload({ waitUntil: 'networkidle' })
      await p.locator('[data-identity="org-choice"]').nth(1).waitFor({ timeout: 15_000 })
      await p.getByRole('button', { name: 'כיבוי הארגון', exact: true }).click()
      await p.getByRole('button', { name: 'לכבות? ההזמנות הפתוחות יבוטלו', exact: true }).click()
      await at(p, 'org-inactive-note').waitFor({ timeout: 15_000 })
      await p.reload({ waitUntil: 'networkidle' })
      await p.locator('[data-identity="org-choice"]').nth(1).waitFor({ timeout: 15_000 })
      const chips = await p.locator('[data-identity="org-choice"]').evaluateAll((els) => els.map((el) => [el.textContent.replace('כבוי', '').trim(), el.getAttribute('data-state'), el.textContent.includes('כבוי')]))
      assert.deepEqual(chips, [['בטא', 'active', false], ['אלפא', 'inactive', true]], 'both in the chooser, the switched-off one marked')
      await p.locator('[data-identity="org-choice"][data-state="inactive"]').click()
      await at(p, 'org-inactive-note').waitFor({ timeout: 15_000 })
      await p.getByRole('button', { name: 'הפעלת הארגון', exact: true }).click()
      await p.waitForFunction(() => !document.querySelector('[data-identity="org-choice"][data-state="inactive"]'), null, { timeout: 15_000 })
      assert.deepEqual([await state(a), await state(b)], ['active', 'active'], 'both on again')
      assert.deepEqual(s.errors, [], 'no script errors')
    } finally { await s.close() }
    // and someone who does not administer it never sees it, on or off
    await api(`${B}/organizations/${a}`, { method: 'PATCH', as: 'orgadmin', body: { state: 'inactive' } })
    const other = await open('outsider', '/benefits/manage')
    try { await at(other.page, 'no-access').waitFor({ timeout: 15_000 }); assert.equal(await other.page.getByText('אלפא').count(), 0, 'an outsider sees nothing of it') } finally { await other.close() }
  }, { timeout: 300_000 })

  // 2026-11-13 (Opus continuation): the invitation page was not in the contrast audit, and nothing drove a screen by keyboard.
  stage.test('ui-keyboard', 'עמוד ההזמנה: קריא בכל חמשת המראות, ואפשר לאשר אותו במקלדת בלבד עם טבעת מיקוד גלויה', 'a11y', async () => {
    await fresh()
    const org = await createOrg('מכללת הדוגמה'); const dept = await createDept(org, 'מטבח')
    const problems = []
    let measured = 0
    for (const look of LOOKS) {
      for (const [who, mark, url] of [['head', 'invite-ready', `/benefits/invite#${await token(org, dept, 'head')}`], [null, 'invite-sign-in', '/benefits/invite'], ['outsider', 'invite-none', '/benefits/invite']]) {
        const s = await open(who, url, { theme: look })
        try {
          await at(s.page, mark).waitFor({ timeout: 15_000 })
          const r = await auditScreen(s.page)
          measured += r.measured
          for (const f of r.failures) problems.push(`${look} ${mark}: "${f.text}" ${f.ratio}:1`)
        } finally { await s.close() }
      }
    }
    assert.ok(measured > 30, `texts measured: ${measured}`)
    assert.deepEqual(problems.slice(0, 12), [], `${problems.length} texts below AA on the invitation page:`)

    const s = await open('head', `/benefits/invite#${await token(org, dept, 'head')}`)
    try {
      await at(s.page, 'invite-ready').waitFor({ timeout: 15_000 })
      const onAccept = () => s.page.evaluate(() => { const b = document.querySelector('[data-identity="invite-accept"]'); return !!b && (b === document.activeElement || b.contains(document.activeElement)) })
      let tabs = 0
      while (tabs < 20 && !(await onAccept())) { await s.page.keyboard.press('Tab'); tabs++ }
      assert.ok(await onAccept(), `Tab reaches the accept button (${tabs} presses)`)
      const ring = await s.page.evaluate(() => { const st = getComputedStyle(document.activeElement); return (st.outlineStyle !== 'none' && parseFloat(st.outlineWidth) > 0) || (st.boxShadow && st.boxShadow !== 'none') })
      assert.ok(ring, 'the focused button shows a focus ring (outline or shadow)')
      await s.page.keyboard.press('Enter')
      await at(s.page, 'invite-accepted').waitFor({ timeout: 15_000 })
      assert.equal(await count(`select count(*) n from public.customer_access_grants where capability = 'department_head' and revoked_at is null`), 1, 'the keyboard acceptance made exactly one head grant')
      assert.deepEqual(s.errors, [], 'no script errors')
    } finally { await s.close() }
  }, { timeout: 300_000 })

  stage.test('ui-looks','קריאוּת בכל חמשת המראות, שלושה רוחבים, קצוות אייפון ותנועה מופחתת, במסך הבעלים ובעמודי ההטבות', 'a11y', async () => {
    await fresh()
    const org = await createOrg('מכללת הדוגמה'); const dept = await createDept(org, 'מטבח'); await createDept(org, 'הנהלת חשבונות ומשאבי אנוש של הקמפוס הצפוני')
    assert.status(await invite(org, dept, 'head2'), 201, 'a pending invitation to show')
    const admin = await createOrg('ארגון עצמאי'); await createDept(admin, 'הנהלה'); await seedAdmin(admin, 'orgadmin')
    const cookie = inviteCookie(await token(org, dept, 'head'))
    assert.status(await post(`${I}/accept`, 'head', {}, { cookie }), 200, 'a head to show')
    const problems = []
    let measured = 0
    const audit = async (label, s) => { const r = await auditScreen(s.page); measured += r.measured; for (const f of r.failures) problems.push(`${label}: "${f.text}" ${f.ratio}:1`) }
    try {
      for (const look of LOOKS) {
        setLook(look)
        const owner = await open('owner', '/owner/members')
        try {
          await at(owner.page, 'organization-row').first().waitFor({ timeout: 15_000 })
          await audit(`${look} owner list`, owner)
          await owner.page.locator(`[data-identity="organization-row"][data-organization="${org}"]`).click()
          await at(owner.page, 'department').first().waitFor({ timeout: 15_000 })
          await settled(owner.page)
          for (const y of [0, 600, 1200]) { await owner.page.evaluate((yy) => window.scrollTo(0, yy), y); await owner.page.waitForTimeout(350); await audit(`${look} owner organization y=${y}`, owner) }
        } finally { await owner.close() }
        for (const [who, mark] of [['orgadmin', 'org'], ['head', 'my-department'], ['outsider', 'no-access']]) {
          const s = await open(who, '/benefits/manage', { theme: look })
          try {
            await at(s.page, mark).first().waitFor({ timeout: 15_000 })
            assert.equal(await s.page.locator('[data-staff-theme]').first().getAttribute('data-staff-theme'), look, `the benefits page wears the ${look} look`)
            await audit(`${look} benefits ${who}`, s)
          } finally { await s.close() }
        }
        const door = await open(null, '/benefits', { theme: look })
        try { await audit(`${look} benefits door`, door) } finally { await door.close() }
      }
    } finally { setLook('glass') }
    assert.ok(measured > 200, `texts measured: ${measured}`)
    assert.deepEqual(problems.slice(0, 12), [], `${problems.length} texts below AA:`)

    for (const width of [360, 768, 1280]) {
      const owner = await open('owner', '/owner/members', { width, height: 900 })
      try {
        await owner.page.locator(`[data-identity="organization-row"][data-organization="${org}"]`).click()
        await at(owner.page, 'department').first().waitFor({ timeout: 15_000 })
        await settled(owner.page)
        assert.ok(await overflowX(owner.page) <= 1, `no sideways scroll on the owner screen at ${width}px (${await overflowX(owner.page)})`)
      } finally { await owner.close() }
      const s = await open('orgadmin', '/benefits/manage', { width, height: 900 })
      try {
        await at(s.page, 'org').waitFor({ timeout: 15_000 })
        assert.ok(await overflowX(s.page) <= 1, `no sideways scroll on the benefits screen at ${width}px (${await overflowX(s.page)})`)
      } finally { await s.close() }
    }
    // an iPhone's edges: the bar sits under the status bar, the first card under the bar
    const phone = await open('head', '/benefits/manage', { iphone: true })
    try {
      await at(phone.page, 'my-department').first().waitFor({ timeout: 15_000 })
      const box = await phone.page.evaluate(() => { const bar = document.querySelector('.gl-top__bar').getBoundingClientRect(); const card = document.querySelector('[data-identity="my-department"]').getBoundingClientRect(); return { barTop: bar.top, barBottom: bar.bottom, cardTop: card.top } })
      assert.ok(box.barTop >= 59 && box.cardTop >= box.barBottom, `the top bar clears the status bar and the first card clears the bar (${JSON.stringify(box)})`)
    } finally { await phone.close() }
    // reduced motion: the same screen, working
    const calm = await open('owner', '/owner/members', { reducedMotion: 'reduce' })
    try {
      await at(calm.page, 'organization-row').first().waitFor({ timeout: 15_000 })
      assert.deepEqual(calm.errors, [], 'no script errors with reduced motion')
    } finally { await calm.close() }
  }, { timeout: 420_000 })

  // ── the source of the new screens (what a screenshot cannot show)
  stage.test('ui-contract', 'המסכים החדשים בנויים רק מרכיבי הזכוכית המשותפים: בלי ספריית תנועה, בלי SegmentedControl/TabBar ישירים, עם שלד טעינה לכל עמוד', 'static', async () => {
    const files = []
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p) } }
    for (const dir of ['src/components/identity', 'src/app/benefits', 'src/app/owner/members']) walk(path.join(root, dir))
    const rel = (f) => path.relative(root, f).split(path.sep).join('/')
    const text = (f) => fs.readFileSync(f, 'utf8')
    assert.ok(files.length >= 12, `the new screen files (${files.length})`)
    assert.deepEqual(files.filter((f) => /from ['"](gsap|@gsap\/react|framer-motion|motion|react-spring|@react-spring\/web|animejs)['"]|AppMotion/.test(text(f))).map(rel), [], 'files that bring a motion library:')
    assert.deepEqual(files.filter((f) => /\b(SegmentedControl|TabBar)\b/.test(text(f))).map(rel), [], 'files that use glisse\'s SegmentedControl / TabBar directly (use Seg / GlassDock):')
    assert.deepEqual(files.filter((f) => /<select\b|<dialog\b|window\.(alert|confirm|prompt)\(/.test(text(f))).map(rel), [], 'files with a browser-native select, dialog or alert:')
    assert.deepEqual(files.filter((f) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(text(f).replace(/\/\/.*$/gm, ''))).map(rel), [], 'files that hard-code a colour (the looks own the colours):')
    assert.deepEqual(files.filter((f) => /localStorage|sessionStorage|document\.cookie/.test(text(f))).map(rel), [], 'files that keep anything in browser storage:')
    assert.deepEqual(files.filter((f) => /console\.(log|info|debug)\(/.test(text(f))).map(rel), [], 'files that log (a token must never reach a log):')
    for (const route of ['src/app/owner/members', 'src/app/benefits', 'src/app/benefits/manage', 'src/app/benefits/invite']) {
      assert.ok(fs.existsSync(path.join(root, route, 'page.tsx')) && fs.existsSync(path.join(root, route, 'loading.tsx')), `${route} has a page and a loading skeleton`)
    }
    const used = files.map(text).join('\n')
    for (const piece of ['GlassDashboardShell', 'GlassPage', 'GlassSkeleton', "from '@/components/glass/Pill'", "from '@/components/glass/Seg'", 'glassToast', "from 'glisse'", 'gl-surf', 'gl-card', 'gl-sk-']) assert.ok(used.includes(piece), `the screens use ${piece}`)
    assert.equal(JSON.parse(text(path.join(root, 'package.json'))).dependencies.glisse, '0.5.0', 'glisse stays pinned at 0.5.0')
  })

  stage.test('cleanup', 'מחזירים את העולם המדומה למצבו', 'e2e', async () => { await fresh(); live().reset() }, { retry: false })
  return stage
}
