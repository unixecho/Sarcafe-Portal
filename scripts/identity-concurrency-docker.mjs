// Two REAL concurrent sessions against the identity foundation (FABLE-001, Codex review R1): can two businesses that both have an
// agreement with one organization bootstrap its first administrator at the same moment? They must not: exactly one wins.
//
// scripts/verify-identity-sql.mjs runs on PGlite, which has a single connection, so it cannot run two sessions. This script starts
// a throwaway Postgres 16 container (the local `postgres:16` image; it is NEVER pulled), applies every migration, and races
// customer_access_grant from two psql sessions. Synthetic ids only; no port is published; the container is removed at the end.
// It is not part of `npm run qa` (it needs Docker), so its name is not check:* / verify:*.
//
// FABLE-002 (20261112162132_customer_org_management.sql) added sections 4-8: department-head invitations. Many sessions accept ONE
// invitation at the same moment (exactly one may win); one new user accepts two invitations of two organizations at once (one
// principal); an acceptance races a revocation; an acceptance waits for a bootstrap that ends its issuer's authority, and the
// other way round. `--without-lock` also removes the two locks of customer_invitation_accept.
//
//   node scripts/identity-concurrency-docker.mjs                 exit 0 = passed, 1 = failed, 2 = NOT RUN (no Docker / no image)
//   node scripts/identity-concurrency-docker.mjs --without-lock  removes the organization row lock inside the throwaway database
//                                                                and runs the same assertions: it MUST fail (proves the test bites)

import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const migrations = path.join(root, 'supabase', 'migrations')
const IMAGE = 'postgres:16'
const NAME = `sarcafe-identity-conc-${process.pid}`
const WITHOUT_LOCK = process.argv.includes('--without-lock')
const RACES = 12

let passed = 0
const failed = []
const check = (name, okay, detail = '') => {
  if (okay) { passed++; console.log(`  ✓ ${name}`) } else { failed.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const docker = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const notRun = (why) => { console.log(`NOT RUN: ${why}`); process.exit(2) }

if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) notRun('Docker is not running on this machine')
if (docker(['image', 'inspect', IMAGE, '--format', '{{.Id}}']).status !== 0) notRun(`the ${IMAGE} image is not on this machine (this script never pulls an image)`)

const PSQL = ['exec', '-i', NAME, 'psql', '-U', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']
/** Runs SQL in one session and returns its output lines; throws on any error. */
const sql = (text) => {
  const r = docker([...PSQL, '-f', '-'], text)
  if (r.status !== 0) throw new Error(`psql failed: ${(r.stderr || r.stdout).trim().split('\n').slice(0, 3).join(' | ')}`)
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
}
/** Starts a session without waiting for it; resolves with its output lines and how long it took. */
const session = (text) => new Promise((resolve) => {
  const started = Date.now()
  const child = spawn('docker', [...PSQL, '-f', '-'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let out = ''; let err = ''
  child.stdout.on('data', (d) => { out += d }); child.stderr.on('data', (d) => { err += d })
  child.on('close', (code) => resolve({ code, ms: Date.now() - started, err: err.trim(), lines: out.split('\n').map((l) => l.trim()).filter(Boolean) }))
  child.stdin.end(text)
})
const answer = (run) => { const line = run.lines.find((l) => l.startsWith('{')); return line ? JSON.parse(line) : { error: `no answer (exit ${run.code}) ${run.err}` } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const cleanup = () => { docker(['rm', '-f', NAME]) }
process.on('exit', cleanup)
process.on('SIGINT', () => process.exit(130))

console.log(`\nthrowaway database (${IMAGE}, container ${NAME}, no published port)${WITHOUT_LOCK ? ' — MUTATION RUN: the organization lock is removed, failures are expected' : ''}`)
const up = docker(['run', '-d', '--rm', '--pull=never', '--name', NAME, '-e', `POSTGRES_PASSWORD=${randomBytes(18).toString('hex')}`, '-v', `${migrations}:/migrations:ro`, IMAGE])
if (up.status !== 0) notRun(`the container did not start: ${up.stderr.trim().split('\n')[0]}`)
// the image's first start runs a private (socket-only) server, then restarts: TCP readiness means the real server is up
let ready = false
for (let i = 0; i < 120 && !ready; i++) { ready = docker(['exec', NAME, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0; if (!ready) await sleep(500) }
if (!ready) { console.log(docker(['logs', '--tail', '20', NAME]).stderr); notRun('Postgres in the container never became ready') }

try {
  // the same stand-ins for Supabase that scripts/verify-identity-sql.mjs uses
  sql(`
    create extension if not exists pgcrypto;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text);
    alter table storage.objects enable row level security;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{"session_id":"10000000-0000-4000-8000-000000000001"}'::jsonb) $$;
    create publication supabase_realtime;
    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to service_role;
  `)
  const files = readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()
  const applied = docker([...PSQL, '-o', '/dev/null', ...files.flatMap((file) => ['-f', `/migrations/${file}`])])
  check(`all ${files.length} migrations apply to real Postgres 16, the identity migrations last (foundation, then organization management)`, applied.status === 0 && /_customer_identity_foundation\.sql$/.test(files[files.length - 2]) && /_customer_org_management\.sql$/.test(files[files.length - 1]), (applied.stderr || '').trim().split('\n').slice(0, 3).join(' | '))
  if (applied.status !== 0) throw new Error('migrations did not apply')
  check('the server really is Postgres 16 with more than one connection allowed', /^16\./.test(sql('show server_version')[0]) && Number(sql('show max_connections')[0]) > 2)

  if (WITHOUT_LOCK) {
    const def = sql(`select pg_get_functiondef('public.customer_access_grant(uuid,uuid,text,uuid,uuid,uuid,timestamptz,text)'::regprocedure)`).join('\n')
    const needle = 'where o.id = p_organization_id for update;'
    if (!def.includes(needle)) throw new Error('the lock statement was not found in customer_access_grant')
    sql(def.replace(needle, 'where o.id = p_organization_id;'))
    console.log('  (mutation applied in the throwaway database only: customer_access_grant no longer locks the organization row)')
    const accept = sql(`select pg_get_functiondef('public.customer_invitation_accept(text,uuid,text)'::regprocedure)`).join('\n')
    const needles = ['where o.id = v_organization for update;', 'where i.token_digest = p_token_digest for update;']
    if (!needles.every((n) => accept.includes(n))) throw new Error('the lock statements were not found in customer_invitation_accept')
    sql(needles.reduce((def, n) => def.replace(n, n.replace(' for update;', ';')), accept))
    console.log('  (and customer_invitation_accept no longer locks the organization row or the invitation row)')
  }

  // ---------------------------------------------------------------- the synthetic world: two businesses, their administrators
  const id = { uA: randomUUID(), uB: randomUUID(), pA: randomUUID(), pB: randomUUID(), bA: randomUUID(), bB: randomUUID(), uOrg: randomUUID(), pOrg: randomUUID() }
  const targets = Array.from({ length: 2 * (RACES + 3) }, () => ({ u: randomUUID(), p: randomUUID() }))
  sql(`
    insert into auth.users (id) values ('${id.uA}'), ('${id.uB}'), ('${id.uOrg}'), ${targets.map((t) => `('${t.u}')`).join(', ')};
    insert into public.customer_businesses (id, slug, name) values ('${id.bA}', 'conc-business-a', 'Business A'), ('${id.bB}', 'conc-business-b', 'Business B');
    insert into public.customer_principals (id, auth_user_id) values ('${id.pA}', '${id.uA}'), ('${id.pB}', '${id.uB}'), ('${id.pOrg}', '${id.uOrg}'), ${targets.map((t) => `('${t.p}', '${t.u}')`).join(', ')};
    insert into public.customer_access_grants (principal_id, capability, scope_kind, business_id) values ('${id.pA}', 'business_admin', 'business', '${id.bA}'), ('${id.pB}', 'business_admin', 'business', '${id.bB}');
  `)
  let n = 0
  const organization = () => {
    const org = randomUUID(); n++
    sql(`insert into public.customer_organizations (id, slug, name) values ('${org}', 'conc-org-${n}', 'Organization ${n}');
         insert into public.customer_business_orgs (business_id, organization_id, state) values ('${id.bA}', '${org}', 'active'), ('${id.bB}', '${org}', 'draft');`)
    return org
  }
  const grantCall = (actor, target, org) => `select public.customer_access_grant('${actor}', '${target}', 'organization_admin', null, '${org}', null, null, 'concurrency test');`
  const live = (org) => Number(sql(`select count(*) from public.customer_access_grants g join public.customer_principals p on p.id = g.principal_id and p.state = 'active' where g.capability = 'organization_admin' and g.organization_id = '${org}' and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())`)[0])
  const bootAudits = (org) => sql(`select detail ->> 'bootstrap_business_id' from public.customer_identity_audit where organization_id = '${org}' and operation = 'access.grant'`)
  let t = 0
  const next = () => targets[t++].p

  // ---------------------------------------------------------------- 1. one session holds its transaction open, the other arrives
  console.log('\nheld transaction: business A bootstraps and keeps its transaction open for 3 s; business B arrives 1 s later')
  {
    const org = organization()
    const first = session(`begin; ${grantCall(id.uA, next(), org)} select pg_sleep(3); commit;`)
    await sleep(1000)
    const second = session(grantCall(id.uB, next(), org))
    await sleep(1000)
    const waiting = Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%customer_access_grant%' and pid <> pg_backend_pid()`)[0])
    const [a, b] = await Promise.all([first, second])
    check('business B\'s call WAITED on a lock while business A\'s transaction was open', waiting === 1, `sessions waiting on a lock: ${waiting}`)
    check('business A bootstrapped the first administrator', answer(a).ok === true && answer(a).status === 'created', JSON.stringify(answer(a)))
    check('business B, released after A committed, was refused (it then saw the live administrator)', answer(b).ok === false && answer(b).error === 'denied' && b.ms >= 1500, `${JSON.stringify(answer(b))} after ${b.ms} ms`)
    check('the organization has exactly one live administrator and one bootstrap audit row, naming business A', live(org) === 1 && bootAudits(org).join() === id.bA, `live ${live(org)}; audit ${bootAudits(org).join()}`)
  }

  // ---------------------------------------------------------------- 2. both at the same moment, many times
  console.log(`\nrace: both businesses call at the same moment, ${RACES} fresh organizations`)
  {
    let exactlyOne = 0; let both = 0; let none = 0; const winners = { a: 0, b: 0 }; let consistent = 0
    for (let i = 0; i < RACES; i++) {
      const org = organization()
      const [a, b] = await Promise.all([session(grantCall(id.uA, next(), org)), session(grantCall(id.uB, next(), org))])
      const okA = answer(a).ok === true && answer(a).status === 'created'; const okB = answer(b).ok === true && answer(b).status === 'created'
      if (okA && okB) both++; else if (okA || okB) exactlyOne++; else none++
      if (okA) winners.a++; if (okB) winners.b++
      const audits = bootAudits(org)
      if (live(org) === 1 && audits.length === 1 && audits[0] === (okA ? id.bA : id.bB)) consistent++
    }
    check(`in all ${RACES} races exactly one business gained bootstrap authority (never both, never neither)`, exactlyOne === RACES && both === 0 && none === 0, `one: ${exactlyOne}, both: ${both}, neither: ${none}`)
    check('after every race: one live administrator, one bootstrap audit row, naming the business that won', consistent === RACES, `${consistent} of ${RACES}`)
    console.log(`  (winners: business A ${winners.a}, business B ${winners.b})`)
  }

  // ---------------------------------------------------------------- 3. a bootstrap racing the organization's own administrator
  console.log('\nheld transaction: the organization\'s last administrator is being revoked while a business tries to bootstrap')
  {
    const org = organization()
    const admin = JSON.parse(sql(grantCall(id.uA, id.pOrg, org)).find((l) => l.startsWith('{')))
    const revoke = session(`begin; select public.customer_access_revoke('${id.uOrg}', '${admin.grant_id}', 'leaving'); select pg_sleep(3); commit;`)
    await sleep(1000)
    const boot = await session(grantCall(id.uB, next(), org))
    const done = await revoke
    check('the revoke (still uncommitted) made the bootstrap wait, and after it committed the bootstrap was allowed', answer(done).status === 'revoked' && answer(boot).ok === true && answer(boot).status === 'created' && boot.ms >= 1500, `${JSON.stringify(answer(boot))} after ${boot.ms} ms`)
    check('one live administrator remains', live(org) === 1)
  }

  // ================================================================ FABLE-002: department-head invitations
  const digest = (text) => createHash('sha256').update(text).digest('hex')
  const dept = (org, name = 'Department') => { const d = randomUUID(); sql(`insert into public.customer_departments (id, organization_id, name) values ('${d}', '${org}', '${name}')`); return d }
  let invitations = 0
  /** An open invitation issued by business A's administrator (setup authority) for a recipient named by `who`. */
  const invitation = (org, department, who, issuer = id.uA) => {
    const token = digest(`token:${++invitations}:${randomUUID()}`)
    const inv = randomUUID()
    sql(`insert into public.customer_invitations (id, purpose, organization_id, department_id, token_digest, recipient_digest, recipient_hint, issued_by_auth_user_id, expires_at)
         values ('${inv}', 'department_head', '${org}', '${department}', '${token}', '${digest('recipient:' + who)}', 'r***@example.test', '${issuer}', now() + interval '1 day')`)
    return { id: inv, token }
  }
  const newUser = () => { const u = randomUUID(); sql(`insert into auth.users (id) values ('${u}')`); return u }
  const acceptCall = (token, user) => `select public.customer_invitation_accept('${token}', '${user}', '${digest('recipient:' + user)}');`
  const headGrants = (org, department) => Number(sql(`select count(*) from public.customer_access_grants where capability = 'department_head' and organization_id = '${org}' and department_id = '${department}' and revoked_at is null`)[0])
  const principalsOf = (user) => Number(sql(`select count(*) from public.customer_principals where auth_user_id = '${user}'`)[0])
  const auditsOf = (target, operation) => Number(sql(`select count(*) from public.customer_identity_audit where target_id = '${target}' and operation = '${operation}'`)[0])
  const accepted = (run) => answer(run).ok === true && answer(run).status === 'accepted'
  const refusedCleanly = (run) => run.code === 0 && answer(run).ok === false && answer(run).error === 'denied'

  // ---------------------------------------------------------------- 4. many sessions accept ONE invitation at the same moment
  const ROUNDS = 6; const SESSIONS = 8
  console.log(`\nrace: ${SESSIONS} sessions accept the same invitation at the same moment, ${ROUNDS} fresh invitations`)
  {
    let exactlyOne = 0; let clean = 0; let consistent = 0
    for (let i = 0; i < ROUNDS; i++) {
      const org = organization(); const d = dept(org); const user = newUser(); const inv = invitation(org, d, user)
      const runs = await Promise.all(Array.from({ length: SESSIONS }, () => session(acceptCall(inv.token, user))))
      const wins = runs.filter(accepted).length
      if (wins === 1) exactlyOne++
      if (runs.filter(refusedCleanly).length === SESSIONS - 1 && runs.every((r) => r.code === 0)) clean++
      if (headGrants(org, d) === 1 && principalsOf(user) === 1 && auditsOf(inv.id, 'invitation.accept') === 1
        && sql(`select count(*) from public.customer_invitations where id = '${inv.id}' and consumed_at is not null and grant_id is not null`)[0] === '1') consistent++
    }
    check(`in all ${ROUNDS} rounds exactly one of the ${SESSIONS} acceptances won`, exactlyOne === ROUNDS, `exactly one: ${exactlyOne} of ${ROUNDS}`)
    check('every other session was refused with a plain "denied" (no SQL error, no unique violation)', clean === ROUNDS, `clean rounds: ${clean} of ${ROUNDS}`)
    check('after every round: one department_head grant, one principal, one invitation.accept audit row, the invitation used once', consistent === ROUNDS, `${consistent} of ${ROUNDS}`)
  }

  // ---------------------------------------------------------------- 5. one NEW user accepts two invitations of two organizations at once
  console.log(`\nrace: a user with no principal accepts invitations of two different organizations at the same moment, ${ROUNDS} times`)
  {
    let both = 0; let onePrincipal = 0
    for (let i = 0; i < ROUNDS; i++) {
      const orgX = organization(); const orgY = organization(); const dX = dept(orgX); const dY = dept(orgY); const user = newUser()
      const invX = invitation(orgX, dX, user); const invY = invitation(orgY, dY, user)
      const [x, y] = await Promise.all([session(acceptCall(invX.token, user)), session(acceptCall(invY.token, user))])
      if (accepted(x) && accepted(y) && headGrants(orgX, dX) === 1 && headGrants(orgY, dY) === 1) both++
      const p = sql(`select id from public.customer_principals where auth_user_id = '${user}'`)
      if (p.length === 1 && auditsOf(p[0], 'principal.create') === 1) onePrincipal++
    }
    check('both acceptances succeeded every time (different organizations do not block or break each other)', both === ROUNDS, `${both} of ${ROUNDS}`)
    check('and the user ended with exactly ONE principal and one principal.create audit row', onePrincipal === ROUNDS, `${onePrincipal} of ${ROUNDS}`)
  }

  // ---------------------------------------------------------------- 6. an acceptance racing a revocation
  console.log(`\nrace: the recipient accepts while the issuer revokes the invitation, ${ROUNDS} times`)
  {
    let oneOutcome = 0; const tally = { accepted: 0, revoked: 0 }
    for (let i = 0; i < ROUNDS; i++) {
      const org = organization(); const d = dept(org); const user = newUser(); const inv = invitation(org, d, user)
      const [a, r] = await Promise.all([session(acceptCall(inv.token, user)), session(`select public.customer_invitation_revoke('${id.uA}', '${inv.id}', 'race');`)])
      const row = sql(`select (consumed_at is not null)::int || ',' || (revoked_at is not null)::int from public.customer_invitations where id = '${inv.id}'`)[0]
      const won = accepted(a)
      // accepted: used, not revoked, one grant, and the revocation answered "conflict". revoked: not used, no grant, the acceptance answered "denied".
      const okAccepted = won && row === '1,0' && headGrants(org, d) === 1 && answer(r).ok === false && answer(r).error === 'conflict'
      const okRevoked = !won && refusedCleanly(a) && row === '0,1' && headGrants(org, d) === 0 && answer(r).status === 'revoked'
      if (okAccepted) tally.accepted++
      if (okRevoked) tally.revoked++
      if (okAccepted !== okRevoked) oneOutcome++
    }
    check('every race ended in exactly one consistent outcome: accepted (and the revocation told "conflict") or revoked (and no grant)', oneOutcome === ROUNDS, `${oneOutcome} of ${ROUNDS}`)
    console.log(`  (accepted ${tally.accepted}, revoked ${tally.revoked})`)
  }

  // ---------------------------------------------------------------- 7. a bootstrap that ends the issuer's authority, held open
  console.log('\nheld transaction: the organization gets its first administrator (3 s open) while the recipient accepts an invitation issued in setup')
  {
    const org = organization(); const d = dept(org); const user = newUser(); const inv = invitation(org, d, user)
    const boot = session(`begin; ${grantCall(id.uA, next(), org)} select pg_sleep(3); commit;`)
    await sleep(1000)
    const acceptance = session(acceptCall(inv.token, user))
    await sleep(1000)
    const waiting = Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%customer_invitation_accept%' and pid <> pg_backend_pid()`)[0])
    const [b, a] = await Promise.all([boot, acceptance])
    check('the acceptance WAITED on the organization lock while the bootstrap was open', waiting === 1, `sessions waiting on a lock: ${waiting}`)
    check('after the bootstrap committed the acceptance was refused: its issuer (a business in setup) no longer has authority', answer(b).ok === true && refusedCleanly(a) && a.ms >= 1500, `${JSON.stringify(answer(a))} after ${a.ms} ms`)
    check('no grant and no principal were created, and the invitation is still unused', headGrants(org, d) === 0 && principalsOf(user) === 0 && sql(`select count(*) from public.customer_invitations where id = '${inv.id}' and consumed_at is null`)[0] === '1')
  }

  // ---------------------------------------------------------------- 8. the other way round: the acceptance is first
  console.log('\nheld transaction: the recipient\'s acceptance is open for 3 s while a business bootstraps the first administrator')
  {
    const org = organization(); const d = dept(org); const user = newUser(); const inv = invitation(org, d, user)
    const acceptance = session(`begin; ${acceptCall(inv.token, user)} select pg_sleep(3); commit;`)
    await sleep(1000)
    const boot = await session(grantCall(id.uB, next(), org))
    const a = await acceptance
    check('the bootstrap waited for the acceptance, and both succeeded in that order', accepted(a) && answer(boot).ok === true && answer(boot).status === 'created' && boot.ms >= 1500, `${JSON.stringify(answer(boot))} after ${boot.ms} ms`)
    check('the head\'s grant exists (the acceptance was decided while its issuer still had authority), with one live administrator', headGrants(org, d) === 1 && live(org) === 1)
  }
} catch (error) {
  check('the run completed', false, String(error.message))
}

console.log(`\n${passed} passed, ${failed.length} failed${WITHOUT_LOCK ? ' (mutation run: a failure here is the expected, correct outcome)' : ''}`)
if (failed.length) { console.log('FAILED:\n - ' + failed.join('\n - ')); process.exit(1) }
