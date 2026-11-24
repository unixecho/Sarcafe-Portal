// Stage — verification (FABLE-004, docs/SARCAFE_IDENTITY.md): an approved employee's revocable QR card, scanner grants given by the
// owner, and verification by a staff member with a human photo comparison. Against the running production build, with the real SQL
// behind it (qa/standin/identity-db.mjs) and the stand-in's private storage. Covered: who may grant, scan, read the photo and decide
// (role, session and tenant matrix; the shared kiosk key; an employee-code session), a QR that is not a card, a superseded or
// hidden card, deactivation between scan and decision, another operator, an organization without an active agreement, private
// headers, and the screens in a real browser: the card's QR (only the token, renewed, gone when hidden), the scanner with a stub
// camera whose tracks must end, the result's photo leaving the page. Every person and image is made up.
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { createStage, assert } from '../lib/harness.mjs'
import { ID, SESSIONS } from '../standin/seed.mjs'
import { auditScreen } from './contrast.mjs'

const V = '/api/benefits/verify'
const O = '/api/owner/members/scanners'
const LOOKS = ['neon', 'glass', 'pass', 'crema', 'latte']
const sha = (text) => createHash('sha256').update(text).digest('hex')
const NOTICE = 'הודעה מדומה לבדיקות בלבד: השם, הכינוי והתמונה נשמרים בארגון שלכם ומוצגים רק למי שמאשר את ההטבה.'
const portrait = async () => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="100%" height="100%" fill="#3a6ea5"/><circle cx="300" cy="260" r="120" fill="#f2c9a0"/></svg>')).jpeg().toBuffer()

export function verificationStage(root, live) {
  const stage = createStage('verification', 'זהויות: כרטיס QR שמתבטל, הרשאת סריקה מפורשת ואימות אנושי מול התמונה (SQL אמיתי מאחורי האפליקציה)')
  const api = (url, opts = {}) => live().call(url, { origin: true, ...opts })
  const post = (url, as, body, extra = {}) => api(url, { method: 'POST', as, body, ...extra })
  const sql = (text, params) => live().identity.query(text, params)
  const one = async (text, params) => (await sql(text, params))[0]
  const count = async (text, params) => Number((await one(text, params)).n)
  const fault = (body) => live().control('/__qa/fault', body)
  const missing = (body) => live().control('/__qa/missing', body)
  const fresh = async () => {
    await fault({ mode: 'none' }); await missing({ tables: [], functions: [] })
    await live().control('/__qa/storage', { clear: true })
    live().standin.state.limits.clear()
    live().db('pos_quick_sessions').length = 0
    live().db('staff_employee_sessions').length = 0
    await live().identity.reset()
  }
  /** An organization with an ACTIVE agreement with Sarcafe, a department, an approved employee (outsider) with a stored photo. */
  const world = async () => {
    const business = (await one(`select id from public.customer_businesses where slug = 'sarcafe'`)).id
    const branches = (await sql(`select branch_id from public.customer_business_branches where business_id = $1 order by branch_id`, [business])).map((r) => r.branch_id)
    const org = (await one(`insert into public.customer_organizations (slug, name) values ('qa-college', 'מכללת הדוגמה') returning id`)).id
    const agreement = (await one(`insert into public.customer_business_orgs (business_id, organization_id, state) values ($1, $2, 'active') returning id`, [business, org])).id
    const dept = (await one(`insert into public.customer_departments (organization_id, name) values ($1, 'מטבח') returning id`, [org])).id
    const member = (await one(`insert into public.customer_members default values returning id`)).id
    const principal = (await one(`insert into public.customer_principals (auth_user_id, member_id) values ($1, $2) returning id`, [SESSIONS.outsider.sub, member])).id
    const membership = (await one(`insert into public.customer_org_memberships (member_id, organization_id, department_id, state, reviewed_at) values ($1, $2, $3, 'approved', now()) returning id`, [member, org, dept])).id
    await sql(`insert into public.customer_member_profiles (membership_id, organization_id, applicant_principal_id, first_name, last_name, nickname) values ($1, $2, $3, 'נועה', 'בדיקה', 'נוני')`, [membership, org, principal])
    const photo = crypto.randomUUID()
    const jpeg = await portrait()
    const objectPath = `org/${org}/${photo}.jpg`
    await sql(`insert into public.customer_member_photos (id, organization_id, membership_id, uploaded_by_auth_user_id, object_path, state, width, height, byte_size, sha256) values ($1, $2, $3, $4, $5, 'approved', 600, 800, $6, $7)`,
      [photo, org, membership, SESSIONS.outsider.sub, objectPath, jpeg.length, sha(jpeg)])
    await live().control('/__qa/storage', { put: { key: `customer-identity-photos/${objectPath}`, base64: jpeg.toString('base64') } })
    return { business, branches, org, agreement, dept, membership }
  }
  const card = async (w, as = 'outsider') => { const r = await post(`/api/benefits/me/${w.membership}/card`, as, {}); assert.status(r, 201, 'a card'); return r.json.token }
  const grantDana = async (branchId = null) => { const r = await post(O, 'owner', { staffId: ID.dana, branchId }); assert.status(r, [200, 201], 'the owner gives Dana scanner access'); return r.json.grantId }
  const scan = (as, w, code, branchId = w.branches[0], extra = {}) => post(`${V}/scan`, as, { branchId, code }, extra)

  stage.test('owner-grants', 'רק הבעלים נותן הרשאת סריקה, במפורש; עובד, מנהל כללי, אדם חיצוני ולא מחובר אינם נותנים ואינם רואים', 'security', async () => {
    await fresh()
    await world()
    for (const [label, opts, status] of [['signed out', {}, 401], ['an employee', { as: 'dana' }, 403], ['a general manager', { as: 'gm' }, 403], ['an external administrator', { as: 'orgadmin' }, 401]]) {
      assert.status(await api(O, opts), status, `list: ${label}`)
      assert.status(await api(O, { method: 'POST', body: { staffId: ID.dana, branchId: null }, ...opts }), status, `grant: ${label}`)
    }
    const list = await api(O, { as: 'owner' })
    assert.status(list, 200, 'the owner lists the staff')
    assert.ok(list.json.staff.some((s) => s.staffId === ID.dana && s.grants.length === 0), 'Dana, with no grant')
    assert.ok(!list.json.staff.some((s) => s.staffId === ID.roi), 'an inactive staff member is not offered')
    assert.status(await post(O, 'owner', { staffId: ID.owner, branchId: null }), 403, 'the owner cannot grant themselves')
    assert.status(await post(O, 'owner', { staffId: ID.dana, branchId: '00000000-0000-4000-8000-00000000dead' }), 403, 'a branch that is not Sarcafe\'s')
    const g = await grantDana()
    assert.equal((await api(O, { as: 'owner' })).json.staff.find((s) => s.staffId === ID.dana).grants.length, 1, 'listed')
    assert.status(await api(`${O}/${g}`, { method: 'DELETE', as: 'gm' }), 403, 'a general manager cannot take it away')
    assert.status(await api(`${O}/${g}`, { method: 'DELETE', as: 'owner', origin: 'https://evil.example' }), 403, 'not from another site')
    assert.status(await api(`${O}/${g}`, { method: 'DELETE', as: 'owner' }), 200, 'the owner takes it away')
  })

  stage.test('card', 'הכרטיס: רק לחברות מאושרת של העובד עצמו; האסימון ניתן פעם אחת, נשמר כתקציר, וכרטיס חדש מבטל את הקודם', 'security', async () => {
    await fresh()
    const w = await world()
    const r = await post(`/api/benefits/me/${w.membership}/card`, 'outsider', {})
    assert.status(r, 201, 'the card')
    assert.match(r.json.token, /^sc1_[A-Za-z0-9_-]{43}$/, 'an opaque 256-bit token, nothing else')
    assert.match(r.headers.get('cache-control') ?? '', /no-store/, 'not stored')
    assert.equal((await one(`select token_digest from public.customer_credentials order by created_at desc limit 1`)).token_digest, sha(`sarcafe:identity:credential:organization_member:v1:${r.json.token}`), 'only its digest is kept')
    assert.ok(!JSON.stringify(await sql(`select * from public.customer_credentials`)).includes(r.json.token), 'the token is nowhere in the database')
    for (const [label, as, status] of [['someone else', 'head2', 403], ['signed out', null, 401], ['a staff member', 'dana', 403]]) assert.status(await post(`/api/benefits/me/${w.membership}/card`, as, {}), status, `card of another: ${label}`)
    assert.status(await post(`/api/benefits/me/${w.membership}/card`, 'outsider', {}, { origin: 'https://evil.example' }), 403, 'not from another site')
    await sql(`update public.customer_org_memberships set state = 'pending', reviewed_at = null, version = version + 1 where id = $1`, [w.membership])
    assert.status(await post(`/api/benefits/me/${w.membership}/card`, 'outsider', {}), 403, 'a membership waiting for review gets no card')
  })

  stage.test('scan-matrix', 'מי סורק: רק בעל הרשאה, בחיבור Google; עובד בלי הרשאה, בעלים, קוד עובד, קוד מהיר, מפתח הקיוסק ולא מחובר נדחים', 'security', async () => {
    await fresh()
    const w = await world()
    const token = await card(w)
    const tries = [['signed out', {}, 401], ['an employee without a grant', { as: 'dana' }, 403], ['the owner (no grant)', { as: 'owner' }, 403], ['a general manager', { as: 'gm' }, 403],
      ['the employee who owns the card', { as: 'outsider' }, 403], ['the kiosk key', { headers: { 'x-kiosk-key': 'qa-kiosk-key-0123456789' } }, 401]]
    for (const [label, opts, status] of tries) {
      const r = await api(`${V}/scan`, { method: 'POST', body: { branchId: w.branches[0], code: token }, ...opts })
      assert.status(r, status, `scan: ${label}`)
      assert.ok(!/נועה|בדיקה|מכללת/.test(r.text), `scan: ${label} learns nothing about the person`)
    }
    await grantDana()
    const codeCookie = (() => { const t = `qa-employee-${Math.random().toString(16).slice(2)}`; live().db('staff_employee_sessions').push({ id: crypto.randomUUID(), token_hash: sha(t), staff_id: ID.dana, revoked_at: null, expires_at: new Date(Date.now() + 3600_000).toISOString() }); return `sarcafe_staff_session=${t}` })()
    assert.status(await api(`${V}/scan`, { method: 'POST', body: { branchId: w.branches[0], code: token }, cookie: codeCookie }), [401, 403], 'Dana on an employee-code session')
    live().db('pos_quick_sessions').push({ session_id: SESSIONS.dana.sessionId })
    assert.status(await scan('dana', w, token), 403, 'Dana on a quick (six-digit) session')
    live().db('pos_quick_sessions').length = 0
    const ok = await scan('dana', w, token)
    assert.status(ok, 201, 'Dana with a grant, on a Google session')
    assert.deepEqual([ok.json.firstName, ok.json.lastName, ok.json.nickname, ok.json.organizationName, ok.json.departmentName], ['נועה', 'בדיקה', 'נוני', 'מכללת הדוגמה', 'מטבח'], 'the minimum to show')
    assert.ok(!/membership|object_path|org\/|digest|token/i.test(ok.text), 'no id of the membership, no path, no token in the answer')
    const scope = await api(`${V}/scope`, { as: 'dana' })
    assert.ok(scope.json.branches.length === w.branches.length && scope.json.branches.every((b) => b.name), 'the scope: every branch, with names')
    assert.status(await api(`${V}/scope`, { as: 'itai' }), 403, 'a staff member without a grant has no scope')
  })

  stage.test('not-a-card', 'קוד שאינו כרטיס (כתובת, קבלה, טקסט, אסימון בתוך טקסט) נדחה לפני המסד ואינו מוחזר', 'security', async () => {
    await fresh()
    const w = await world()
    await grantDana()
    const token = await card(w)
    const before = await count(`select count(*) n from public.customer_identity_audit where operation like 'verification.%'`)
    for (const code of ['https://evil.example/steal', `https://portal.example/benefits/register#${token}`, `x${token}`, `${token} extra`, 'javascript:alert(1)', '/order/' + 'a'.repeat(40), 'sc1_short']) {
      const r = await scan('dana', w, code)
      assert.status(r, 400, `not a card: ${code.slice(0, 30)}`)
      assert.ok(!r.text.includes(code.slice(0, 20)) || code.length < 10, 'the decoded text is not echoed')
    }
    assert.equal(await count(`select count(*) n from public.customer_identity_audit where operation like 'verification.%'`), before, 'none of them reached the database')
  })

  stage.test('verify-flow', 'סריקה, תמונה רק למפעיל ורק בזמן האימות, החלטה של המפעיל עצמו; כרטיס ישן, השבתה בין סריקה להחלטה, ארגון בלי הסכם פעיל', 'e2e', async () => {
    await fresh()
    const w = await world()
    await grantDana()
    const first = await card(w)
    const v = await scan('dana', w, first)
    const photo = await api(`${V}/${v.json.verificationId}/photo`, { as: 'dana' })
    assert.status(photo, 200, 'the operator reads the photo')
    for (const [h, re] of [['content-type', /^image\/jpeg$/], ['cache-control', /no-store/], ['referrer-policy', /no-referrer/], ['x-content-type-options', /nosniff/]]) assert.match(photo.headers.get(h) ?? '', re, `photo: ${h}`)
    for (const [label, as] of [['another staff member', 'itai'], ['the owner', 'owner'], ['the employee', 'outsider']]) assert.status(await api(`${V}/${v.json.verificationId}/photo`, { as }), 403, `photo: ${label}`)
    assert.status(await post(`${V}/${v.json.verificationId}/decide`, 'itai', { decision: 'match' }), 403, 'another staff member cannot decide it')
    const m = await post(`${V}/${v.json.verificationId}/decide`, 'dana', { decision: 'match' })
    assert.deepEqual([m.status, m.json.state], [200, 'matched'], 'matched')
    assert.status(await api(`${V}/${v.json.verificationId}/photo`, { as: 'dana' }), 403, 'after the decision the photo is not shown')
    assert.status(await post(`${V}/${v.json.verificationId}/decide`, 'dana', { decision: 'mismatch' }), 409, 'not decided twice')
    const second = await card(w)
    assert.status(await scan('dana', w, first), 403, 'the OLDER card (a screenshot) is dead once a new one is made')
    const v2 = await scan('dana', w, second)
    await sql(`update public.customer_org_memberships set state = 'inactive', version = version + 1 where id = $1`, [w.membership])
    const stale = await post(`${V}/${v2.json.verificationId}/decide`, 'dana', { decision: 'match' })
    assert.equal(stale.json?.error?.code, 'stale', 'deactivated between scan and decision: refused as stale')
    assert.status(await scan('dana', w, second), 403, 'and the card is dead')
    await sql(`update public.customer_org_memberships set state = 'approved', version = version + 1 where id = $1`, [w.membership])
    const third = await card(w)
    await sql(`update public.customer_business_orgs set state = 'suspended' where id = $1`, [w.agreement])
    assert.status(await scan('dana', w, third), 403, 'a suspended agreement: refused')
    await sql(`update public.customer_business_orgs set state = 'active' where id = $1`, [w.agreement])
    assert.status(await api(`/api/benefits/me/${w.membership}/card`, { method: 'DELETE', as: 'outsider' }), 200, 'the employee hides the card')
    assert.status(await scan('dana', w, third), 403, 'a hidden card is dead')
  }, { timeout: 120_000 })

  stage.test('outage', 'כשהמסד אינו זמין: 503 נקי ולא גישה; כשהפונקציה חסרה (מיגרציה לא הוחלה): 503', 'recovery', async () => {
    await fresh()
    const w = await world()
    await grantDana()
    const token = await card(w)
    await missing({ functions: ['customer_verification_scan'] })
    assert.status(await scan('dana', w, token), 503, 'a missing function: 503')
    await missing({ functions: [] })
    await fault({ mode: 'error', tables: ['rpc/customer_verification_scan'] })
    assert.status(await scan('dana', w, token), 503, 'a failing database: 503')
    await fault({ mode: 'none' })
    assert.status(await scan('dana', w, token), 201, 'and back')
  })

  // ── the screens
  const settled = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 400))).catch(() => null)
  const open = async (who, url, opts) => {
    const s = await live().page(who, opts)
    const requests = []
    s.page.on('request', (request) => requests.push(request.url()))
    const res = await s.page.goto(live().base + url, { waitUntil: 'networkidle' })
    await settled(s.page)
    return { ...s, requests, status: res?.status() }
  }
  const at = (page, name) => page.locator(`[data-identity="${name}"]`)

  stage.test('ui-card', 'הכרטיס בדפדפן: QR על קנבס בלבד (בלי האסימון בטקסט, באחסון או בכתובת), נעלם כשמסתירים או כשהעמוד ברקע', 'e2e', async () => {
    await fresh()
    const w = await world()
    const s = await open('outsider', '/benefits/manage')
    try {
      await at(s.page, 'my-membership').first().waitFor({ timeout: 15_000 })
      await at(s.page, 'my-card').click()
      await at(s.page, 'member-card-qr').waitFor({ state: 'visible', timeout: 15_000 })
      const token = (await one(`select count(*) n from public.customer_credentials where membership_id = $1 and revoked_at is null`, [w.membership])).n
      assert.equal(Number(token), 1, 'one live card')
      const html = await s.page.content()
      assert.ok(!/sc1_[A-Za-z0-9_-]{43}/.test(html), 'the token is not in the page text')
      assert.ok(!/sc1_/.test(await s.page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]))), 'nor in any storage')
      assert.deepEqual(s.requests.filter((u) => /sc1_/.test(u)), [], 'nor in any request URL')
      await s.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
      await s.page.waitForFunction(() => document.querySelector('[data-identity="member-card-qr"]')?.hasAttribute('hidden'), null, { timeout: 5_000 })
      await at(s.page, 'member-card-hide').click()
      await s.page.waitForFunction(() => !document.querySelector('[data-identity="member-card"]'), null, { timeout: 10_000 })
      assert.equal(Number((await one(`select count(*) n from public.customer_credentials where membership_id = $1 and revoked_at is null`, [w.membership])).n), 0, 'hiding the card revoked it')
      assert.deepEqual(s.errors, [], 'no script errors')
    } finally { await s.close() }
  }, { timeout: 120_000 })

  stage.test('ui-scan', 'מסך הסריקה: מצלמה מדומה שנעצרת באמת; הקלדת קוד; תוצאה עם תמונה, החלטה, והכול נעלם מהמסך', 'e2e', async () => {
    await fresh()
    const w = await world()
    const none = await open('itai', '/staff/benefits/scan')
    try { await at(none.page, 'scan-no-access').waitFor({ timeout: 15_000 }) } finally { await none.close() }
    await grantDana()
    const token = await card(w)
    const s = await live().page('dana')
    // a stub camera: a canvas stream; the test records whether every track it handed out was stopped
    await s.context.addInitScript(() => {
      window.__qaTracks = []
      const fake = async () => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const ctx = c.getContext('2d'); setInterval(() => { ctx.fillStyle = '#888'; ctx.fillRect(0, 0, 640, 480) }, 100); const stream = c.captureStream(10); window.__qaTracks.push(...stream.getTracks()); return stream }
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: fake }, configurable: true })
    })
    try {
      await s.page.goto(live().base + '/staff/benefits/scan', { waitUntil: 'networkidle' })
      await at(s.page, 'scan').waitFor({ timeout: 15_000 })
      await at(s.page, 'scan-camera').click()
      await s.page.waitForFunction(() => window.__qaTracks.length > 0 && window.__qaTracks.every((t) => t.readyState === 'live'), null, { timeout: 10_000 })
      await at(s.page, 'scan-camera-stop').click()
      await s.page.waitForFunction(() => window.__qaTracks.every((t) => t.readyState === 'ended'), null, { timeout: 5_000 })
      await at(s.page, 'scan-camera').click()
      await s.page.waitForFunction(() => window.__qaTracks.some((t) => t.readyState === 'live'), null, { timeout: 10_000 })
      await s.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
      await s.page.waitForFunction(() => window.__qaTracks.every((t) => t.readyState === 'ended'), null, { timeout: 5_000 })
      await s.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }) })
      await s.page.getByLabel('או הקלדת הקוד').fill('https://evil.example/x')
      await at(s.page, 'scan-manual-send').click()
      await at(s.page, 'scan-notice').waitFor({ timeout: 5_000 })
      assert.equal(await s.page.evaluate(() => location.pathname), '/staff/benefits/scan', 'a URL in the code is never navigated to')
      await s.page.getByLabel('או הקלדת הקוד').fill(token)
      await at(s.page, 'scan-manual-send').click()
      await at(s.page, 'scan-result').waitFor({ timeout: 15_000 })
      await at(s.page, 'photo').waitFor({ timeout: 15_000 })
      assert.match(await at(s.page, 'scan-result').innerText(), /נועה בדיקה[\s\S]*מכללת הדוגמה/, 'the minimum to show')
      await at(s.page, 'scan-match').click()
      await s.page.waitForFunction(() => !document.querySelector('[data-identity="scan-result"]') && !document.querySelector('img[src^="blob:"]'), null, { timeout: 10_000 })
      assert.equal(await at(s.page, 'scan-notice').getAttribute('data-tone'), 'ok', 'a green "verified" note')
      assert.deepEqual(s.errors, [], 'no script errors')
    } finally { await s.close() }
  }, { timeout: 180_000 })

  stage.test('ui-looks', 'קריאוּת בכל חמשת המראות: הכרטיס, מסך הסריקה עם תוצאה, והרשאות הסריקה אצל הבעלים', 'a11y', async () => {
    await fresh()
    const w = await world()
    await grantDana()
    const problems = []
    let measured = 0
    const audit = async (label, s) => { const r = await auditScreen(s.page); measured += r.measured; for (const f of r.failures) problems.push(`${label}: "${f.text}" ${f.ratio}:1`) }
    for (const look of LOOKS) {
      const mine = await open('outsider', '/benefits/manage', { theme: look })
      try { await at(mine.page, 'my-card').click(); await at(mine.page, 'member-card-qr').waitFor({ state: 'visible', timeout: 15_000 }); await audit(`${look} card`, mine) } finally { await mine.close() }
      const row = live().db('staff').find((s) => s.id === ID.dana); if (row) row.ui_theme = look
      const s = await open('dana', '/staff/benefits/scan')
      try {
        await s.page.getByLabel('או הקלדת הקוד').fill(await card(w))
        await at(s.page, 'scan-manual-send').click()
        await at(s.page, 'photo').waitFor({ timeout: 15_000 })
        await audit(`${look} scan result`, s)
      } finally { await s.close() }
      const ownerRow = live().db('staff').find((x) => x.id === ID.owner); if (ownerRow) ownerRow.ui_theme = look
      const o = await open('owner', '/owner/members')
      try { await at(o.page, 'scanners').waitFor({ timeout: 15_000 }); await audit(`${look} owner scanners`, o) } finally { await o.close() }
    }
    for (const id of [ID.dana, ID.owner]) { const r = live().db('staff').find((x) => x.id === id); if (r) r.ui_theme = 'glass' }
    assert.ok(measured > 80, `texts measured: ${measured}`)
    assert.deepEqual(problems.slice(0, 12), [], `${problems.length} texts below AA:`)
  }, { timeout: 420_000 })

  stage.test('cleanup', 'מחזירים את העולם המדומה למצבו', 'e2e', async () => { await fresh(); live().reset() }, { retry: false })
  return stage
}
