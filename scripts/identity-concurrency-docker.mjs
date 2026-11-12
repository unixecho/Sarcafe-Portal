// Two REAL concurrent sessions against the identity foundation (FABLE-001, Codex review R1): can two businesses that both have an
// agreement with one organization bootstrap its first administrator at the same moment? They must not: exactly one wins.
//
// scripts/verify-identity-sql.mjs runs on PGlite, which has a single connection, so it cannot run two sessions. This script starts
// a throwaway Postgres 16 container (the local `postgres:16` image; it is NEVER pulled), applies every migration, and races
// customer_access_grant from two psql sessions. Synthetic ids only; no port is published; the container is removed at the end.
// It is not part of `npm run qa` (it needs Docker), so its name is not check:* / verify:*.
//
//   node scripts/identity-concurrency-docker.mjs                 exit 0 = passed, 1 = failed, 2 = NOT RUN (no Docker / no image)
//   node scripts/identity-concurrency-docker.mjs --without-lock  removes the organization row lock inside the throwaway database
//                                                                and runs the same assertions: it MUST fail (proves the test bites)

import { spawn, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
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
  check(`all ${files.length} migrations apply to real Postgres 16, the identity migration last`, applied.status === 0 && /_customer_identity_foundation\.sql$/.test(files[files.length - 1]), (applied.stderr || '').trim().split('\n').slice(0, 3).join(' | '))
  if (applied.status !== 0) throw new Error('migrations did not apply')
  check('the server really is Postgres 16 with more than one connection allowed', /^16\./.test(sql('show server_version')[0]) && Number(sql('show max_connections')[0]) > 2)

  if (WITHOUT_LOCK) {
    const def = sql(`select pg_get_functiondef('public.customer_access_grant(uuid,uuid,text,uuid,uuid,uuid,timestamptz,text)'::regprocedure)`).join('\n')
    const needle = 'where o.id = p_organization_id for update;'
    if (!def.includes(needle)) throw new Error('the lock statement was not found in customer_access_grant')
    sql(def.replace(needle, 'where o.id = p_organization_id;'))
    console.log('  (mutation applied in the throwaway database only: customer_access_grant no longer locks the organization row)')
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
} catch (error) {
  check('the run completed', false, String(error.message))
}

console.log(`\n${passed} passed, ${failed.length} failed${WITHOUT_LOCK ? ' (mutation run: a failure here is the expected, correct outcome)' : ''}`)
if (failed.length) { console.log('FAILED:\n - ' + failed.join('\n - ')); process.exit(1) }
