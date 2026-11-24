// Stage — registration (FABLE-003, docs/SARCAFE_IDENTITY.md): an organization's employees register with a single-use link (names, a
// nickname, a private photo), and a reviewer of their department approves, rejects, deactivates or reactivates them. Against the
// running production build; the identity functions are answered by a REAL Postgres with the real migrations
// (qa/standin/identity-db.mjs) and the photos by the stand-in's private storage (only the service key reaches it). Covered: closed
// collection, who may call each route (role, session and tenant matrix), the link and the session, the photo checks over HTTP,
// the private photo proxy (headers, cross-tenant, signed out, a swapped object), self-review, stale versions, changes sent back to
// review, deactivation, outages and the cleanup job, an employee never becoming staff, and the screens in a real browser (five
// looks, phone width, the accessibility widget on the employee's page only). Every person, organization and image is made up.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { createStage, assert } from '../lib/harness.mjs'
import { ID, SESSIONS, emailOf } from '../standin/seed.mjs'
import { SECRETS } from './app.mjs'
import { auditScreen } from './contrast.mjs'

const B = '/api/benefits/manage'
const R = '/api/benefits/register'
const LOOKS = ['neon', 'glass', 'pass', 'crema', 'latte']
const sha = (text) => createHash('sha256').update(text).digest('hex')
const NOBODY = '00000000-0000-4000-8000-00000000dead'
const NOTICE = 'הודעה מדומה לבדיקות בלבד: השם, הכינוי והתמונה נשמרים בארגון שלכם ומוצגים רק למי שמאשר את ההטבה.'

/** A synthetic "portrait" (a disc on a plain background) as a JPEG that carries EXIF with GPS and a camera, like a phone photo. */
const portrait = async (w = 900, h = 1200, colour = '#3a6ea5') => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${colour}"/><circle cx="${w / 2}" cy="${h / 3}" r="${Math.min(w, h) / 5}" fill="#f2c9a0"/></svg>`))
  .jpeg().withMetadata({ exif: { IFD0: { Make: 'SyntheticCam', Model: 'QA-PHONE' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '32/1 26/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '35/1 0/1 0/1' } } }).toBuffer()

export function registrationStage(root, live) {
  const stage = createStage('registration', 'זהויות: רישום עובדים, תמונה פרטית ואישור ראש המחלקה (SQL אמיתי ואחסון פרטי מאחורי האפליקציה)')
  const api = (url, opts = {}) => live().call(url, { origin: true, ...opts })
  const post = (url, as, body, extra = {}) => api(url, { method: 'POST', as, body, ...extra })
  const sql = (text, params) => live().identity.query(text, params)
  const one = async (text, params) => (await sql(text, params))[0]
  const count = async (text, params) => Number((await one(text, params)).n)
  const fault = (body) => live().control('/__qa/fault', body)
  const missing = (body) => live().control('/__qa/missing', body)
  const storage = () => live().control('/__qa/storage')
  const cookies = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => !/=$/.test(c))
  const cookieValue = (r, name) => cookies(r).find((c) => c.startsWith(`${name}=`))
  const LINK = 'sarcafe_benefits_register_link'
  const SESSION = 'sarcafe_benefits_register'

  const fresh = async () => {
    await fault({ mode: 'none' }); await missing({ tables: [], functions: [] })
    await live().control('/__qa/storage', { clear: true })
    live().standin.state.limits.clear()
    live().db('pos_quick_sessions').length = 0
    live().db('staff_employee_sessions').length = 0
    await live().identity.reset()
  }
  const publish = (retention = {}) => sql(`insert into public.customer_notices (purpose, language, version, body, state, published_at, retention) values ('employee_registration', 'he', 'qa-1', $1, 'published', now(), $2::jsonb) returning id`, [NOTICE, JSON.stringify(retention)]).then((r) => r[0].id)
  const principal = async (who) => (await one(`insert into public.customer_principals (auth_user_id) values ($1) on conflict (auth_user_id) do update set auth_user_id = excluded.auth_user_id returning id`, [SESSIONS[who].sub])).id
  /** An organization that runs itself (its own administrator), two departments, a head of the first; written directly (FABLE-002 has the screens). */
  const world = async () => {
    const business = (await one(`select id from public.customer_businesses where slug = 'sarcafe'`)).id
    const org = (await one(`insert into public.customer_organizations (slug, name) values ('qa-college', 'מכללת הדוגמה') returning id`)).id
    await sql(`insert into public.customer_business_orgs (business_id, organization_id, state) values ($1, $2, 'active')`, [business, org])
    const kitchen = (await one(`insert into public.customer_departments (organization_id, name) values ($1, 'מטבח') returning id`, [org])).id
    const library = (await one(`insert into public.customer_departments (organization_id, name) values ($1, 'ספרייה') returning id`, [org])).id
    await sql(`insert into public.customer_access_grants (principal_id, capability, scope_kind, organization_id) values ($1, 'organization_admin', 'organization', $2)`, [await principal('orgadmin'), org])
    await sql(`insert into public.customer_access_grants (principal_id, capability, scope_kind, organization_id, department_id) values ($1, 'department_head', 'department', $2, $3)`, [await principal('head'), org, kitchen])
    await sql(`insert into public.customer_access_grants (principal_id, capability, scope_kind, organization_id, department_id) values ($1, 'department_head', 'department', $2, $3)`, [await principal('head2'), org, library])
    // another organization, of another business, with its own head
    const other = (await one(`insert into public.customer_businesses (slug, name) values ('other-cafe', 'Other Cafe') returning id`)).id
    const foreign = (await one(`insert into public.customer_organizations (slug, name) values ('qa-foreign', 'Foreign Works') returning id`)).id
    await sql(`insert into public.customer_business_orgs (business_id, organization_id, state) values ($1, $2, 'active')`, [other, foreign])
    const machines = (await one(`insert into public.customer_departments (organization_id, name) values ($1, 'Machines') returning id`, [foreign])).id
    await sql(`insert into public.customer_access_grants (principal_id, capability, scope_kind, organization_id, department_id) values ($1, 'department_head', 'department', $2, $3)`, [await principal('forwarded'), foreign, machines])
    return { org, kitchen, library, foreign, machines }
  }
  const dept = (w, which = 'kitchen') => `${B}/organizations/${which === 'machines' ? w.foreign : w.org}/departments/${w[which]}`
  const makeLink = async (w, as = 'head', which = 'kitchen') => { const r = await post(`${dept(w, which)}/registrations`, as, { expiresInHours: 168 }); assert.status(r, 201, `link by ${as}`); return r.json.token }
  /** The employee's side up to a live session: exchange (public), then open (signed in). Returns the cookie header to keep using. */
  const session = async (token, who) => {
    const ex = await post(`${R}/exchange`, null, { token })
    assert.status(ex, 200, 'exchange')
    const linkCookie = cookieValue(ex, LINK)
    const opened = await post(`${R}/open`, who, {}, { cookie: linkCookie })
    assert.status(opened, 200, `open as ${who}`)
    return { cookie: cookieValue(opened, SESSION), opened }
  }
  const uploadAs = (who, cookie, bytes, type = 'image/jpeg', url = `${R}/photo`) => api(url, { method: 'POST', as: who, cookie, body: bytes, headers: { 'content-type': type } })
  const submitAs = (who, cookie, photoId, noticeId, names = {}) => post(`${R}/submit`, who, { firstName: 'נועה', lastName: 'בדיקה', nickname: 'נוני', photoId, noticeId, accept: true, ...names }, { cookie })
  /** A whole application for `who` (link by the kitchen's head), returns its membership id. */
  const apply = async (w, who, names = {}) => {
    const token = await makeLink(w)
    const s = await session(token, who)
    const up = await uploadAs(who, s.cookie, await portrait())
    assert.status(up, 201, `${who} photo`)
    const sent = await submitAs(who, s.cookie, up.json.photoId, s.opened.json.notice.id, names)
    assert.status(sent, 201, `${who} applies`)
    return { membershipId: sent.json.membershipId, photoId: up.json.photoId, noticeId: s.opened.json.notice.id }
  }
  const versionOf = async (membership) => Number((await one(`select version from public.customer_org_memberships where id = $1`, [membership])).version)
  const decide = async (w, as, membership, decision, extra = {}, which = 'kitchen') => post(`${dept(w, which)}/members/${membership}/review`, as, { decision, version: await versionOf(membership), ...extra })

  stage.test('reset', 'מתחילים מעולם ריק; הפונקציות החדשות קיימות במסד הבדיקה, ואין הודעה מפורסמת', 'sql', async () => {
    await fresh()
    assert.equal(await count(`select count(*) n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('customer_registration_open', 'customer_registration_submit', 'customer_membership_review', 'customer_photo_open', 'customer_photo_cleanup_done')`), 5, 'the registration functions exist')
    assert.equal(await count(`select count(*) n from public.customer_notices`), 0, 'no notice: registration is closed')
    assert.deepEqual(await storage(), [], 'no stored object')
  }, { retry: false })

  stage.test('closed', 'ההרשמה סגורה עד שהעסק מפרסם הודעה: פתיחת קישור עונה "סגור" ולא נכתב דבר', 'security', async () => {
    await fresh()
    const w = await world()
    const token = await makeLink(w)
    const ex = await post(`${R}/exchange`, null, { token })
    const opened = await post(`${R}/open`, 'outsider', {}, { cookie: cookieValue(ex, LINK) })
    assert.status(opened, 409, 'closed')
    assert.equal(opened.json.error.code, 'closed', 'said plainly')
    assert.equal(await count(`select count(*) n from public.customer_registration_sessions`), 0, 'no session was made')
    await sql(`insert into public.customer_notices (purpose, language, version, body, state) values ('employee_registration', 'he', 'draft', $1, 'draft')`, [NOTICE])
    assert.status(await post(`${R}/open`, 'outsider', {}, { cookie: cookieValue(ex, LINK) }), 409, 'a draft notice does not open it either')
  })

  stage.test('reviewer-sessions', 'מי מנהל את עובדי המחלקה: רק ראש המחלקה או מנהל הארגון; בעלים, עובד צוות, ראש מחלקה אחרת, ארגון אחר, קוד מהיר ולא מחובר נדחים', 'security', async () => {
    await fresh()
    const w = await world()
    await publish()
    const routes = [['GET', `${dept(w)}/registrations`], ['POST', `${dept(w)}/registrations`, { expiresInHours: 168 }], ['DELETE', `${dept(w)}/registrations/${NOBODY}`],
      ['POST', `${dept(w)}/members/${NOBODY}/review`, { decision: 'approve', version: 1 }], ['GET', `${dept(w)}/members/${NOBODY}/photo`]]
    const before = await count(`select count(*) n from public.customer_identity_audit`)
    const tryAll = async (label, opts, expected) => {
      for (const [method, url, body] of routes) {
        const r = await api(url, { method, body, ...opts })
        assert.status(r, expected, `${label}: ${method} ${url.replace(dept(w), '…')}`)
        assert.ok(!/membershipId|firstName|"token"|object_path/.test(r.text), `${label}: ${method} answered without data`)
        assert.match(r.headers.get('cache-control') ?? '', /no-store/, `${label}: no-store on the refusal`)
      }
    }
    await tryAll('signed out', {}, 401)
    await tryAll('the owner (owners do not review an organization\'s employees)', { as: 'owner' }, 403)
    await tryAll('an employee of Sarcafe', { as: 'dana' }, 403)
    await tryAll('the head of ANOTHER department of the same organization', { as: 'head2' }, 403)
    await tryAll('a head in another organization', { as: 'forwarded' }, 403)
    await tryAll('a signed-in outsider', { as: 'outsider' }, 403)
    live().db('pos_quick_sessions').push({ session_id: SESSIONS.head.sessionId })
    await tryAll('the kitchen\'s head on a quick (six-digit) session', { as: 'head' }, 403)
    live().db('pos_quick_sessions').length = 0
    assert.equal(await count(`select count(*) n from public.customer_identity_audit`), before, 'nothing was written by a refused call')
    assert.status(await api(`${dept(w)}/registrations`, { as: 'head' }), 200, 'the head')
    assert.status(await api(`${dept(w)}/registrations`, { as: 'orgadmin' }), 200, 'the organization\'s administrator')
    assert.status(await api(`${dept(w, 'library')}/registrations`, { as: 'orgadmin' }), 200, 'the administrator, for every department')
    assert.status(await api(`${B}/organizations/${w.org}/departments/${w.machines}/registrations`, { as: 'orgadmin' }), 403, 'an ID swap: own organization, a department of another one')
    assert.status(await api(`${B}/organizations/not-a-uuid/departments/${w.kitchen}/registrations`, { as: 'head' }), 400, 'an id that is not a UUID')
  }, { timeout: 120_000 })

  stage.test('link-and-session', 'הקישור והחלון: האסימון ניתן פעם אחת ונשמר רק כתקציר; עוגיות נסתרות רק לנתיב ההרשמה; קישור משומש או של אחר אינו נפתח', 'security', async () => {
    await fresh()
    const w = await world()
    await publish()
    const made = await post(`${dept(w)}/registrations`, 'head', { expiresInHours: 168 })
    assert.status(made, 201, 'a link')
    assert.match(made.json.token, /^er1_[A-Za-z0-9_-]{43}$/, 'a purpose-prefixed 256-bit token')
    assert.match(made.headers.get('cache-control') ?? '', /no-store/, 'the response that carries it is not stored')
    assert.status(await post(`${dept(w)}/registrations`, 'head', { expiresInHours: 9999 }), 400, 'an expiry that is not offered')
    assert.status(await post(`${dept(w)}/registrations`, 'head', { expiresInHours: 168, departmentId: w.library }), 400, 'an unknown field')
    const everything = JSON.stringify([await sql(`select * from public.customer_registration_invites`), await sql(`select * from public.customer_identity_audit`)])
    assert.ok(!everything.includes(made.json.token) && !everything.includes(made.json.token.slice(4)), 'the token is nowhere in the database')
    assert.equal((await one(`select token_digest from public.customer_registration_invites where id = $1`, [made.json.inviteId])).token_digest, sha(`sarcafe:identity:registration:link:v1:${made.json.token}`), 'only its digest')

    assert.status(await post(`${R}/exchange`, null, { token: 'er1_short' }), 400, 'a malformed token')
    assert.status(await post(`${R}/exchange`, null, { token: made.json.token }, { origin: 'https://evil.example' }), 403, 'from another site')
    const ex = await post(`${R}/exchange`, null, { token: made.json.token })
    assert.status(ex, 200, 'the exchange (public, says nothing)')
    const set = (ex.headers.getSetCookie?.() ?? []).find((c) => c.startsWith(`${LINK}=`)) ?? ''
    assert.match(set, /HttpOnly/i, 'HttpOnly'); assert.match(set, /Path=\/api\/benefits\/register/i, 'sent only to the registration API'); assert.match(set, /SameSite=Lax/i, 'SameSite=Lax')
    assert.deepEqual(Object.keys(ex.json), ['ok'], 'the exchange tells nothing about the link')
    assert.status(await post(`${R}/open`, null, {}, { cookie: cookieValue(ex, LINK) }), 401, 'opening needs a sign-in')
    assert.status(await post(`${R}/open`, 'head', {}, { cookie: cookieValue(ex, LINK) }), 403, 'the head who made it cannot register through it')
    const s = await session(made.json.token, 'outsider')
    const sessionSet = (s.opened.headers.getSetCookie?.() ?? []).find((c) => c.startsWith(`${SESSION}=`)) ?? ''
    assert.match(sessionSet, /HttpOnly/i, 'the session cookie is HttpOnly'); assert.match(sessionSet, /Path=\/api\/benefits\/register/i, 'and sent only to the registration API'); assert.match(sessionSet, /Max-Age=3600/i, 'for one hour')
    assert.deepEqual([s.opened.json.organizationName, s.opened.json.departmentName, s.opened.json.notice.body], ['מכללת הדוגמה', 'מטבח', NOTICE], 'the names and the notice to show')
    const status = await api(`${R}/status`, { as: 'outsider', cookie: s.cookie })
    assert.equal(status.json.state, 'ready', 'the page reads its session again')
    assert.equal((await api(`${R}/status`, { as: 'head2', cookie: s.cookie })).json.state, 'unavailable', 'another signed-in person cannot use a copied session cookie')
    assert.status(await uploadAs('head2', s.cookie, await portrait()), 403, '…nor upload on it')
    const row = await one(`select token_digest from public.customer_registration_sessions where auth_user_id = $1`, [SESSIONS.outsider.sub])
    assert.equal(row.token_digest, sha(`sarcafe:identity:registration:session:v1:${s.cookie.split('=')[1]}`), 'the session is stored as a digest')
    const up = await uploadAs('outsider', s.cookie, await portrait())
    const sent = await submitAs('outsider', s.cookie, up.json.photoId, s.opened.json.notice.id)
    assert.status(sent, 201, 'the application')
    assert.ok((sent.headers.getSetCookie?.() ?? []).some((c) => c.startsWith(`${SESSION}=;`) || /sarcafe_benefits_register=;|Max-Age=0/.test(c)), 'the session cookie is cleared')
    assert.status(await submitAs('outsider', s.cookie, up.json.photoId, s.opened.json.notice.id), 403, 'the same session cannot submit twice')
    const reuse = await post(`${R}/exchange`, null, { token: made.json.token })
    const again = await post(`${R}/open`, 'head2', {}, { cookie: cookieValue(reuse, LINK) })
    assert.status(again, 403, 'a used link opens for nobody')
    assert.equal(again.json.error.code, 'registration_unavailable', 'one answer for every reason')
  }, { timeout: 120_000 })

  stage.test('photo-checks', 'התמונה מעל HTTP: נשמרת רק אחרי פענוח וקידוד מחדש, בלי EXIF ו־GPS; SVG, HTML, קובץ קטוע, גדול מדי או סוג לא מוצהר נדחים', 'security', async () => {
    await fresh()
    const w = await world()
    await publish()
    const s = await session(await makeLink(w), 'outsider')
    const original = await portrait()
    assert.ok(/SyntheticCam/.test(original.toString('latin1')), 'the uploaded file really carries a camera and GPS')
    const ok = await uploadAs('outsider', s.cookie, original)
    assert.status(ok, 201, 'a JPEG')
    assert.ok(ok.json.width <= 1024 && ok.json.height <= 1024, 'at most 1024 px')
    const stored = await storage()
    assert.equal(stored.length, 1, 'one object')
    assert.match(stored[0].key, new RegExp(`^customer-identity-photos/org/${w.org}/${ok.json.photoId}\\.jpg$`), 'in the private bucket, under an opaque name (organization and photo id only)')
    const row = await one(`select sha256, state, object_path, width, height from public.customer_member_photos where id = $1`, [ok.json.photoId])
    assert.equal(row.sha256, stored[0].sha256, 'the database holds the hash of exactly the stored bytes')
    assert.equal(row.state, 'uploading', 'not part of an application until it is submitted')
    const bytes = Buffer.from(await (await fetch(`${live().standin.url}/storage/v1/object/customer-identity-photos/${row.object_path}`, { headers: { authorization: 'Bearer qa-service-role-key' } })).arrayBuffer())
    const meta = await sharp(bytes).metadata()
    assert.ok(meta.format === 'jpeg' && !meta.exif && !meta.icc && !meta.xmp, 'the stored file is a fresh JPEG without metadata')
    assert.ok(!/SyntheticCam|QA-PHONE/.test(bytes.toString('latin1')), 'nothing of the camera or the location is left in it')
    assert.status((await fetch(`${live().standin.url}/storage/v1/object/customer-identity-photos/${row.object_path}`, { headers: { authorization: 'Bearer qa-anon-key', apikey: 'qa-anon-key' } })), 400, 'the bucket refuses the browser key (private)')
    const cases = [
      ['an SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'image/jpeg', 422],
      ['an HTML page', Buffer.from('<!doctype html><script>alert(1)</script>'), 'image/png', 422],
      ['a truncated JPEG', original.subarray(0, 900), 'image/jpeg', 422],
      ['a tiny picture', await sharp({ create: { width: 120, height: 120, channels: 3, background: '#777' } }).jpeg().toBuffer(), 'image/jpeg', 422],
      ['a declared text/html body', original, 'text/html', 415],
      ['more than 8 MB', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(8 * 1024 * 1024 + 10)]), 'image/jpeg', 413],
    ]
    for (const [label, body, type, status] of cases) {
      const r = await uploadAs('outsider', s.cookie, body, type)
      assert.status(r, status, label)
      assert.match(r.json?.error?.message ?? '', /[֐-׿]/, `${label}: a Hebrew sentence that says what to do`)
    }
    assert.equal((await storage()).length, 1, 'nothing refused was stored')
    assert.equal(await count(`select count(*) n from public.customer_member_photos`), 1, 'and nothing refused was recorded')
    assert.status(await uploadAs('outsider', undefined, original), 403, 'without a registration session')
    assert.status(await api(`${R}/photo`, { method: 'POST', as: 'outsider', cookie: s.cookie, body: original, headers: { 'content-type': 'image/jpeg' }, origin: 'https://evil.example' }), 403, 'from another site')
  }, { timeout: 120_000 })

  stage.test('review-flow', 'בקשה, צפייה בתמונה דרך השרת בלבד, אישור עם גרסה, גרסה ישנה נדחית, אף אחד אינו מאשר את עצמו', 'e2e', async () => {
    await fresh()
    const w = await world()
    await publish({ rejected_days: 30, replaced_photo_days: 7 })
    const a = await apply(w, 'outsider')
    const list = await api(`${dept(w)}/registrations`, { as: 'head' })
    assert.status(list, 200, 'the list')
    assert.deepEqual(list.json.members.map((m) => [m.firstName, m.lastName, m.nickname, m.state, m.hasPendingPhoto]), [['נועה', 'בדיקה', 'נוני', 'pending', true]], 'the application waits, with its names and a photo')
    assert.equal(list.json.counts.pending, 1, 'the count')
    assert.ok(!/object_path|org\/|token|digest/.test(list.text), 'the list holds no path, token or digest')
    assert.equal((await api(`${dept(w, 'library')}/registrations`, { as: 'orgadmin' })).json.members.length, 0, 'another department\'s list does not hold it')

    const photoUrl = `${dept(w)}/members/${a.membershipId}/photo?which=pending`
    const pic = await api(photoUrl, { as: 'head' })
    assert.status(pic, 200, 'the head sees the waiting photo')
    for (const [header, pattern] of [['content-type', /^image\/jpeg$/], ['cache-control', /private, no-store/], ['referrer-policy', /^no-referrer$/], ['x-content-type-options', /^nosniff$/], ['cross-origin-resource-policy', /^same-origin$/], ['content-security-policy', /object-src 'none'|sandbox/]]) {
      assert.match(pic.headers.get(header) ?? '', pattern, `photo response: ${header}`)
    }
    assert.equal(await count(`select count(*) n from public.customer_identity_audit where operation = 'photo.read' and actor_auth_user_id = $1`, [SESSIONS.head.sub]), 1, 'the read is in the audit')
    for (const [label, opts, status] of [['signed out', {}, 401], ['the head of another department', { as: 'head2' }, 403], ['the owner', { as: 'owner' }, 403], ['a head in another organization', { as: 'forwarded' }, 403]]) {
      const r = await api(photoUrl, opts)
      assert.status(r, status, `photo: ${label}`)
      assert.ok(!/^image\//.test(r.headers.get('content-type') ?? ''), `photo: ${label} gets no image`)
      assert.match(r.headers.get('cache-control') ?? '', /no-store/, `photo: ${label}: no-store on the refusal too`)
    }
    assert.status(await api(`${B}/organizations/${w.foreign}/departments/${w.machines}/members/${a.membershipId}/photo?which=pending`, { as: 'forwarded' }), 403, 'an ID swap through another tenant\'s own department')
    assert.status(await api(`${dept(w, 'library')}/members/${a.membershipId}/photo?which=pending`, { as: 'orgadmin' }), 403, 'named with the wrong department, even for the administrator of both')
    assert.status(await api(`${dept(w)}/members/${a.membershipId}/photo?which=../../etc`, { as: 'head' }), 400, 'a "which" that is not pending / approved')

    const stale = await post(`${dept(w)}/members/${a.membershipId}/review`, 'head', { decision: 'approve', version: 9 })
    assert.status(stale, 409, 'a version the screen did not show'); assert.equal(stale.json.error.code, 'stale', 'said plainly')
    assert.status(await post(`${dept(w)}/members/${a.membershipId}/review`, 'head', { decision: 'reject', version: 1 }), 400, 'a rejection needs a reason')
    assert.status(await post(`${dept(w, 'library')}/members/${a.membershipId}/review`, 'orgadmin', { decision: 'approve', version: 1 }), 403, 'named with another department')
    const approved = await decide(w, 'head', a.membershipId, 'approve')
    assert.status(approved, 200, 'approved')
    assert.deepEqual([approved.json.state, approved.json.version], ['approved', 2], 'approved, version 2')
    assert.status(await api(photoUrl, { as: 'head' }), 403, 'the waiting photo is now THE photo (nothing waits)')
    assert.status(await api(photoUrl.replace('pending', 'approved'), { as: 'head' }), 200, 'and is read as the approved one')

    // the administrator applies as an employee: nobody reviews their own application
    const own = await apply(w, 'orgadmin', { firstName: 'מנהלת', lastName: 'ארגון' })
    assert.status(await decide(w, 'orgadmin', own.membershipId, 'approve'), 403, 'the administrator cannot approve their own application')
    assert.status(await decide(w, 'head', own.membershipId, 'approve'), 200, 'another reviewer (the head) can')
  }, { timeout: 180_000 })

  stage.test('tampered-photo', 'קובץ שהוחלף או נעלם באחסון אינו מוצג: השרת משווה את התקציר שבמסד', 'security', async () => {
    await fresh()
    const w = await world()
    await publish()
    const a = await apply(w, 'outsider')
    const key = (await storage())[0].key
    await live().control('/__qa/storage', { put: { key, base64: (await portrait(600, 800, '#aa0000')).toString('base64') } })
    assert.status(await api(`${dept(w)}/members/${a.membershipId}/photo?which=pending`, { as: 'head' }), 403, 'a swapped object is refused')
    await live().control('/__qa/storage', { delete: key })
    assert.status(await api(`${dept(w)}/members/${a.membershipId}/photo?which=pending`, { as: 'head' }), 403, 'a missing object is refused')
  })

  stage.test('member-change', 'העובד רואה רק את הבקשות שלו; שינוי שם או תמונה מחזיר לאישור; מושבת אינו משתנה; תמונה של אחר אינה נקראת', 'e2e', async () => {
    await fresh()
    const w = await world()
    await publish({ replaced_photo_days: 7 })
    const a = await apply(w, 'outsider')
    await decide(w, 'head', a.membershipId, 'approve')
    const mine = await api('/api/benefits/me', { as: 'outsider' })
    assert.status(mine, 200, 'own applications')
    assert.deepEqual(mine.json.memberships.map((m) => [m.organizationName, m.departmentName, m.state]), [['מכללת הדוגמה', 'מטבח', 'approved']], 'the approved membership')
    assert.ok(!/object_path|digest|reviewed_by/.test(mine.text), 'no path, digest or reviewer in it')
    assert.equal((await api('/api/benefits/me', { as: 'head2' })).json.memberships.length, 0, 'someone else sees none of it')
    assert.status(await api('/api/benefits/me', {}), 401, 'signed out')
    assert.status(await api(`/api/benefits/me/${a.membershipId}/photo?which=approved`, { as: 'outsider' }), 200, 'the employee reads their own photo')
    assert.status(await api(`/api/benefits/me/${a.membershipId}/photo?which=approved`, { as: 'head2' }), 403, 'nobody else reads it as "their own"')
    const notice = mine.json.notice.id
    const same = await api(`/api/benefits/me/${a.membershipId}`, { method: 'PATCH', as: 'outsider', body: { firstName: 'נועה', lastName: 'בדיקה', nickname: 'נוני', noticeId: notice } })
    assert.equal(same.json.status, 'unchanged', 'nothing changed: unchanged')
    const changed = await api(`/api/benefits/me/${a.membershipId}`, { method: 'PATCH', as: 'outsider', body: { firstName: 'נועה', lastName: 'כהן', nickname: 'נוני', noticeId: notice } })
    assert.deepEqual([changed.json.status, changed.json.version], ['pending', 3], 'a changed name sends it back to review (version 3)')
    assert.status(await api(`/api/benefits/me/${a.membershipId}`, { method: 'PATCH', as: 'head2', body: { firstName: 'x', lastName: 'y', noticeId: notice } }), 403, 'someone else cannot change it')
    const up = await uploadAs('outsider', undefined, await portrait(800, 1000, '#225522'), 'image/jpeg', `/api/benefits/me/${a.membershipId}/photo`)
    assert.status(up, 201, 'a new photo for the own membership')
    const withPhoto = await api(`/api/benefits/me/${a.membershipId}`, { method: 'PATCH', as: 'outsider', body: { firstName: 'נועה', lastName: 'כהן', nickname: 'נוני', photoId: up.json.photoId, noticeId: notice } })
    assert.deepEqual([withPhoto.json.status, withPhoto.json.version], ['pending', 4], 'with the photo: pending again')
    assert.status(await api(`${dept(w)}/members/${a.membershipId}/photo?which=pending`, { as: 'head' }), 200, 'the reviewer sees the new photo waiting')
    assert.status(await api(`${dept(w)}/members/${a.membershipId}/photo?which=approved`, { as: 'head' }), 200, 'and the approved one is kept meanwhile')
    assert.status(await decide(w, 'head', a.membershipId, 'approve'), 200, 'approved again')
    const stale = await api(`/api/benefits/me/${a.membershipId}`, { method: 'PATCH', as: 'outsider', body: { firstName: 'נועה', lastName: 'לוי', noticeId: NOBODY } })
    assert.equal(stale.json?.error?.code, 'stale', 'a notice that is not the published one')
    assert.status(await decide(w, 'head', a.membershipId, 'deactivate'), 400, 'deactivation needs a reason')
    assert.status(await decide(w, 'head', a.membershipId, 'deactivate', { reason: 'עזבה' }), 200, 'deactivated')
    assert.status(await api(`/api/benefits/me/${a.membershipId}`, { method: 'PATCH', as: 'outsider', body: { firstName: 'נועה', lastName: 'לוי', noticeId: notice } }), 403, 'an inactive membership is not changed by the employee')
    assert.equal((await api('/api/benefits/me', { as: 'outsider' })).json.memberships[0].state, 'inactive', 'they see it is inactive')
    assert.status(await decide(w, 'orgadmin', a.membershipId, 'reactivate'), 200, 'the administrator reactivates it')
  }, { timeout: 180_000 })

  stage.test('not-staff', 'עובד מאושר של ארגון אינו הופך לצוות: אין לו גישה לצוות, לבעלים, לקופה או לניהול', 'security', async () => {
    await fresh()
    const w = await world()
    await publish()
    const a = await apply(w, 'outsider')
    await decide(w, 'head', a.membershipId, 'approve')
    const where = async (url) => { const r = await live().call(url, { as: 'outsider' }); return `${r.status} ${(r.headers.get('location') ?? '').replace(/^https?:\/\/[^/]+/, '')}` }
    for (const url of ['/staff', '/owner/dashboard', '/pos', '/owner/members']) assert.ok(!/^200 /.test(await where(url)), `${url} is not opened for an approved employee (${await where(url)})`)
    for (const url of ['/api/owner/members/organizations', `${dept(w)}/registrations`]) assert.ok([401, 403].includes((await api(url, { as: 'outsider' })).status), `${url} refused`)
    assert.equal(live().db('staff').filter((s) => s.auth_user_id === SESSIONS.outsider.sub).length, 0, 'no staff row')
    assert.equal(await count(`select count(*) n from public.customer_access_grants g join public.customer_principals p on p.id = g.principal_id where p.auth_user_id = $1`, [SESSIONS.outsider.sub]), 0, 'no grant')
  })

  stage.test('outage-cleanup', 'תקלות: אחסון שנופל = 503 ושום דבר לא נשאר תקוע (משימת הניקוי מוחקת); מיגרציה חסרה = 503; משימת הניקוי נעולה', 'recovery', async () => {
    await fresh()
    const w = await world()
    await publish()
    const s = await session(await makeLink(w), 'outsider')
    await fault({ mode: 'error', tables: ['storage'] })
    const down = await uploadAs('outsider', s.cookie, await portrait())
    assert.status(down, 503, 'storage down: a clean 503')
    await fault({ mode: 'none' })
    assert.equal(await count(`select count(*) n from public.customer_member_photos where state = 'uploading'`), 1, 'the row stays "uploading" (the cleanup finds it)')
    const up = await uploadAs('outsider', s.cookie, await portrait())
    assert.status(up, 201, 'after recovery the person simply tries again')
    assert.status(await api('/api/cron/identity-photo-cleanup', {}), 401, 'the cleanup job without its secret')
    const cron = { authorization: `Bearer ${SECRETS.CRON_SECRET}` }
    const early = await api('/api/cron/identity-photo-cleanup', { headers: cron })
    assert.status(early, 200, 'the cleanup job'); assert.equal(early.json.removed, 0, 'nothing is due within the hour')
    await sql(`alter table public.customer_member_photos disable trigger customer_member_photos_keep`)
    await sql(`update public.customer_member_photos set created_at = now() - interval '2 hours'`)
    await sql(`alter table public.customer_member_photos enable trigger customer_member_photos_keep`)
    const run = await api('/api/cron/identity-photo-cleanup', { headers: cron })
    assert.status(run, 200, 'the cleanup job')
    assert.equal(run.json.discarded, 2, 'both unfinished uploads discarded (the failed one and the one never submitted)')
    assert.deepEqual(await storage(), [], 'and their stored object removed')
    assert.status(await submitAs('outsider', s.cookie, up.json.photoId, s.opened.json.notice.id), 400, 'a discarded photo cannot be submitted')
    await missing({ functions: ['customer_registration_open'] })
    const ex = await post(`${R}/exchange`, null, { token: await makeLink(w) })
    const open = await post(`${R}/open`, 'head2', {}, { cookie: cookieValue(ex, LINK) })
    assert.status(open, 503, 'a migration that is not applied: 503, never access')
    await missing({ functions: [] })
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
  const at = (page, name) => page.locator(`[data-identity="${name}"]`)
  const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const photoFile = async () => ({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: await portrait() })

  stage.test('ui-register', 'עמוד ההרשמה בדפדפן: האסימון יוצא מהכתובת; טופס עם תמונה והודעה; ראש המחלקה רואה את התמונה, מאשר, והתמונה נעלמת בסגירה', 'e2e', async () => {
    await fresh()
    const w = await world()
    await publish()
    const token = await makeLink(w)
    const out = await open(null, `/benefits/register#${token}`)
    try {
      await at(out.page, 'register-sign-in').waitFor({ timeout: 15_000 })
      assert.equal(await out.page.evaluate(() => window.location.hash), '', 'the fragment is cleared at once')
      assert.ok(!/מכללת הדוגמה|מטבח/.test(await out.page.locator('main').innerText()), 'nothing about the link before sign-in')
      assert.deepEqual(out.requests.filter((u) => u.includes(token.slice(4))), [], 'no request URL ever contained the token')
      assert.ok(!(await out.page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]))).includes('er1_'), 'the token is in no script-readable storage')
      assert.equal(await out.page.locator('.skip-link').count(), 0, 'private like the rest of /benefits (decision D5): no customer widget or skip link')
    } finally { await out.close() }
    const s = await open('outsider', `/benefits/register#${token}`)
    try {
      await at(s.page, 'register-form').waitFor({ timeout: 15_000 })
      assert.match(await at(s.page, 'register-form').innerText(), /מכללת הדוגמה[\s\S]*מטבח/, 'the organization and the department')
      assert.match(await at(s.page, 'notice').innerText(), /הודעה מדומה לבדיקות/, 'the published notice')
      await at(s.page, 'details-submit').click()
      assert.equal(await at(s.page, 'register-sent').count(), 0, 'an empty form is not sent')
      await s.page.getByLabel('שם פרטי').fill('נועה')
      await s.page.getByLabel('שם משפחה').fill('בדיקה')
      await s.page.getByLabel('כינוי (לא חובה)').fill('נוני')
      await s.page.locator('input[type="file"]').setInputFiles(await photoFile())
      await at(s.page, 'photo-preview').waitFor({ timeout: 10_000 })
      assert.match(await at(s.page, 'photo-preview').getAttribute('src') ?? '', /^blob:/, 'the preview is the person\'s own file, from a local object URL')
      await at(s.page, 'notice-accept').click()
      assert.equal(await at(s.page, 'notice-accept').getAttribute('aria-checked'), 'true', 'the notice is accepted (a real checkbox for assistive technology)')
      await at(s.page, 'details-submit').click()
      await at(s.page, 'register-sent').waitFor({ timeout: 20_000 })
      assert.deepEqual(s.errors, [], 'no script errors')
      await s.page.getByRole('button', { name: 'הבקשות שלי' }).click()
      await at(s.page, 'my-membership').first().waitFor({ timeout: 15_000 })
      assert.equal(await at(s.page, 'my-membership').first().getAttribute('data-state'), 'pending', 'their own application, pending')
      assert.equal(await at(s.page, 'no-access').count(), 0, 'an employee is not told "no access": they see their application')
    } finally { await s.close() }
    const head = await open('head', '/benefits/manage')
    try {
      await at(head.page, 'members').first().waitFor({ timeout: 15_000 })
      await at(head.page, 'member').first().waitFor({ timeout: 15_000 })
      assert.match(await at(head.page, 'member').first().innerText(), /נועה בדיקה/, 'the application is listed')
      await at(head.page, 'member-open').first().click()
      await at(head.page, 'photo').waitFor({ timeout: 15_000 })
      assert.ok(await at(head.page, 'photo').evaluate((img) => img.complete && img.naturalWidth > 0 && img.src.startsWith('blob:')), 'the photo is shown from a private object URL')
      assert.equal(await head.page.locator('img[src*="/photo"], img[src*="storage"]').count(), 0, 'no image points at a server URL a browser could keep')
      await at(head.page, 'decide-approve').click()
      await head.page.waitForFunction(() => !document.querySelector('[data-identity="photo"]'), null, { timeout: 15_000 })
      assert.equal(await head.page.locator('img[src^="blob:"]').count(), 0, 'after the decision the photo is gone from the page')
      assert.deepEqual(head.errors, [], 'no script errors')
    } finally { await head.close() }
    assert.equal((await one(`select state from public.customer_org_memberships`)).state, 'approved', 'approved in the database')
  }, { timeout: 240_000 })

  stage.test('ui-looks', 'קריאוּת בכל חמשת המראות ורוחב טלפון: טופס ההרשמה (עם ההודעה המלאה), רשימת העובדים עם תמונה, הבקשות שלי', 'a11y', async () => {
    await fresh()
    const w = await world()
    await publish()
    await apply(w, 'outsider', { firstName: 'אלכסנדרה־מריה', lastName: 'בן־עמי רוזנבלום' })
    const problems = []
    let measured = 0
    const audit = async (label, s) => { const r = await auditScreen(s.page); measured += r.measured; for (const f of r.failures) problems.push(`${label}: "${f.text}" ${f.ratio}:1`) }
    for (const look of LOOKS) {
      const token = await makeLink(w)
      const reg = await open('head2', `/benefits/register#${token}`, { theme: look })
      try {
        await at(reg.page, 'register-form').waitFor({ timeout: 15_000 })
        await audit(`${look} register form`, reg)
        await reg.page.evaluate(() => window.scrollTo(0, 900)); await reg.page.waitForTimeout(300); await audit(`${look} register form (scrolled)`, reg)
      } finally { await reg.close() }
      const head = await open('head', '/benefits/manage', { theme: look })
      try {
        await at(head.page, 'member').first().waitFor({ timeout: 15_000 })
        await at(head.page, 'member-open').first().click()
        await at(head.page, 'photo').waitFor({ timeout: 15_000 })
        await audit(`${look} members with a photo`, head)
      } finally { await head.close() }
      const mine = await open('outsider', '/benefits/manage', { theme: look })
      try { await at(mine.page, 'my-membership').first().waitFor({ timeout: 15_000 }); await audit(`${look} my applications`, mine) } finally { await mine.close() }
    }
    assert.ok(measured > 120, `texts measured: ${measured}`)
    assert.deepEqual(problems.slice(0, 12), [], `${problems.length} texts below AA:`)
    const phone = await open('head', '/benefits/manage', { width: 360, height: 800 })
    try { await at(phone.page, 'member').first().waitFor({ timeout: 15_000 }); assert.ok(await overflowX(phone.page) <= 1, 'no sideways scroll at 360 px') } finally { await phone.close() }
  }, { timeout: 420_000 })

  stage.test('ui-contract', 'הקבצים החדשים: רכיבי הזכוכית המשותפים, עמוד ושלד טעינה, בלי צבע קשיח, בלי אחסון בדפדפן, בלי next/image לתמונה פרטית', 'static', async () => {
    const files = ['src/components/identity/RegistrationFlow.tsx', 'src/components/identity/DepartmentMembers.tsx', 'src/components/identity/MyMemberships.tsx', 'src/components/identity/PrivatePhoto.tsx', 'src/app/benefits/register/page.tsx', 'src/app/benefits/register/loading.tsx']
    const text = (f) => fs.readFileSync(path.join(root, f), 'utf8')
    for (const f of files) assert.ok(fs.existsSync(path.join(root, f)), `${f} exists`)
    assert.deepEqual(files.filter((f) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(text(f).replace(/\/\/.*$/gm, ''))), [], 'hard-coded colours:')
    assert.deepEqual(files.filter((f) => /localStorage|sessionStorage|document\.cookie|caches\.|indexedDB/.test(text(f))), [], 'browser storage:')
    assert.deepEqual(files.filter((f) => /from ['"]next\/image['"]/.test(text(f))), [], 'next/image for a private photo:')
    assert.ok(/URL\.revokeObjectURL/.test(text('src/components/identity/PrivatePhoto.tsx')) && /cache: 'no-store'/.test(text('src/components/identity/PrivatePhoto.tsx')), 'the photo viewer revokes its object URL and never caches')
    assert.ok(/URL\.revokeObjectURL/.test(text('src/components/identity/RegistrationFlow.tsx')), 'the preview revokes its object URL')
    const used = files.map(text).join('\n')
    for (const piece of ["from 'glisse'", "from '@/components/glass/Seg'", "from '@/components/glass/Pill'", 'glassToast', 'gl-surf', 'gl-card', 'BenefitsSkeleton']) assert.ok(used.includes(piece), `uses ${piece}`)
  })

  stage.test('cleanup', 'מחזירים את העולם המדומה למצבו', 'e2e', async () => { await fresh(); live().reset() }, { retry: false })
  return stage
}
