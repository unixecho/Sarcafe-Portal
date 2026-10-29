// Security baseline check, 2026-10-28 audit (docs/SECURITY_AUDIT_2026-10-28.md). Two halves:
//   1. Database: every migration applied in order to an in-memory Postgres (PGlite), the security migration applied
//      twice, then the grants it sets and the rules from CLAUDE.md (no overloads, no internal_* reachable,
//      no SECURITY DEFINER without a fixed search_path, RLS on every public table) are checked.
//   2. Code: the HTTP hardening (headers, cross-site write guard, cron bearer check, push endpoint allowlist) is
//      still wired in, and the two helpers behave.
// Nothing here touches production.
//
//   node scripts/check-security.mjs

import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const root = fileURLToPath(new URL('../', import.meta.url))
const migrations = path.join(root, 'supabase', 'migrations')
const SECURITY_MIGRATION = '20261028190000_security_hardening.sql'

let passed = 0
const failed = []
const check = (name, okay, detail = '') => {
  if (okay) { passed++; console.log(`  ✓ ${name}`) } else { failed.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const read = (relative) => readFileSync(path.join(root, relative), 'utf8')

// ---- 1. database -------------------------------------------------------------------------------------------------
console.log('\ndatabase')
const db = new PGlite({ extensions: { pgcrypto } })
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
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
`)

const files = readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()
check('the security migration file is present', files.includes(SECURITY_MIGRATION))
for (const file of files) {
  try { await db.exec(readFileSync(path.join(migrations, file), 'utf8')) }
  catch (error) { check(`apply ${file}`, false, String(error.message).split('\n')[0]); process.exit(1) }
}
try {
  await db.exec(readFileSync(path.join(migrations, SECURITY_MIGRATION), 'utf8'))
  check('all migrations apply in order, and the security migration applies a second time', true)
} catch (error) {
  check('the security migration is idempotent', false, String(error.message).split('\n')[0])
}

const can = async (role, signature) =>
  (await db.query(`select has_function_privilege($1, to_regprocedure($2), 'execute') ok`, [role, signature])).rows[0]?.ok

check('log_shift_audit: anon cannot execute', (await can('anon', 'public.log_shift_audit(uuid, text, text, jsonb)')) === false)
check('log_shift_audit: authenticated cannot execute', (await can('authenticated', 'public.log_shift_audit(uuid, text, text, jsonb)')) === false)
check('log_shift_audit: service_role can execute', (await can('service_role', 'public.log_shift_audit(uuid, text, text, jsonb)')) === true)
check('publish_menu: anon cannot execute', (await can('anon', 'public.publish_menu(uuid)')) === false)
check('publish_menu: authenticated still can (the owner session publishes)', (await can('authenticated', 'public.publish_menu(uuid)')) === true)
for (const fn of ['public.set_default_variant(uuid)', 'public.reap_expired_variants()']) {
  check(`${fn}: browser roles cannot execute`, (await can('anon', fn)) === false && (await can('authenticated', fn)) === false)
  check(`${fn}: service_role can execute`, (await can('service_role', fn)) === true)
}

const mutable = (await db.query(`
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'sched\\_%'
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)).rows
check('every sched_* function has a fixed search_path', mutable.length === 0, mutable.map((r) => r.proname).join(', '))

const definerNoPath = (await db.query(`
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)).rows
check('no SECURITY DEFINER function without a fixed search_path', definerNoPath.length === 0, definerNoPath.map((r) => r.proname).join(', '))

const overloads = (await db.query(`
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') -- extension functions (pgcrypto here) are not ours
  group by p.proname having count(*) > 1`)).rows
check('no overloaded function names (PGRST203)', overloads.length === 0, overloads.map((r) => r.proname).join(', '))

const internal = (await db.query(`
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'internal\\_%'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
      or has_function_privilege('service_role', p.oid, 'execute'))`)).rows
check('no internal_* function is callable by anon, authenticated or service_role', internal.length === 0, internal.map((r) => r.proname).join(', '))

const noRls = (await db.query(`
  select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`)).rows
check('row level security is on for every public table', noRls.length === 0, noRls.map((r) => r.relname).join(', '))

const definerAnon = (await db.query(`
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')`)).rows
check('anon can execute no SECURITY DEFINER function', definerAnon.length === 0, definerAnon.map((r) => r.proname).join(', '))

// ---- 2. code -----------------------------------------------------------------------------------------------------
console.log('\ncode')
const load = (relative) => {
  const code = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  const localRequire = (id) => (id === 'server-only' ? {} : require(id))
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports)
  return module.exports
}

const { isAllowedPushEndpoint } = load('src/lib/push/endpoint.ts')
for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/QO_abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-db5p.notify.windows.com/w/?token=x']) {
  check(`push endpoint accepted: ${new URL(ok).host}`, isAllowedPushEndpoint(ok) === true)
}
for (const bad of ['http://fcm.googleapis.com/x', 'https://169.254.169.254/latest', 'https://localhost:9001/x', 'https://fcm.googleapis.com:8443/x', 'https://evilgoogleapis.com/x', 'https://fcm.googleapis.com.evil.io/x', 'https://u:p@fcm.googleapis.com/x', 'not a url', 42]) {
  check(`push endpoint refused: ${String(bad)}`, isAllowedPushEndpoint(bad) === false)
}

const { bearerMatches } = load('src/lib/http/cron.ts')
check('cron bearer: right secret passes', bearerMatches('Bearer s3cret-value', 's3cret-value') === true)
check('cron bearer: wrong secret fails', bearerMatches('Bearer s3cret-valuX', 's3cret-value') === false)
check('cron bearer: unset secret never passes', bearerMatches('Bearer ', undefined) === false && bearerMatches('Bearer undefined', undefined) === false)
check('cron bearer: missing header fails', bearerMatches(null, 's3cret-value') === false)

for (const route of ['cleanup-feedback', 'cleanup-pos', 'keep-alive', 'staff-push']) {
  const text = read(`src/app/api/cron/${route}/route.ts`)
  check(`/api/cron/${route} uses the constant-time bearer check`, text.includes('bearerMatches(') && !/auth !== `Bearer/.test(text))
}
for (const file of ['src/lib/push/send.ts', 'src/lib/push/staff.ts', 'src/app/api/order/subscribe/route.ts', 'src/app/api/staff/push/route.ts']) {
  check(`${file} checks the push endpoint allowlist`, read(file).includes('isAllowedPushEndpoint'))
}

const config = read('next.config.mjs')
check('next.config: X-Powered-By is off', /poweredByHeader:\s*false/.test(config))
check('next.config: Permissions-Policy is sent', config.includes("key: 'Permissions-Policy'"))
check("next.config: CSP keeps frame-ancestors 'none' and adds base-uri/object-src", config.includes("frame-ancestors 'none'; base-uri 'self'; object-src 'none'"))
check('next.config: HSTS is sent', config.includes('Strict-Transport-Security'))
check("next.config: the payslip viewer keeps its own frame-ancestors 'self' (and no object-src, which breaks PDF viewers)", /payslips\/:id\/view[\s\S]*frame-ancestors 'self'"/.test(config))

const middleware = read('src/middleware.ts')
check('middleware refuses cross-site API writes before anything else', /export async function middleware[\s\S]{0,120}isCrossSiteApiWrite\(request\)/.test(middleware))
check('middleware exempts only the kiosk and public feedback routes', middleware.includes("const CROSS_ORIGIN_API_PREFIXES = ['/api/kiosk/', '/api/feedback']"))

const signout = read('src/app/api/auth/signout/route.ts')
check('sign-out does not echo the auth server error text', !signout.includes('message: error.message'))

const gitignore = read('.gitignore')
check('.gitignore keeps env files and keys out of git', ['.env', '.env.local', '*.pem', '.vercel'].every((line) => gitignore.includes(line)))

console.log(`\n${passed} passed, ${failed.length} failed`)
if (failed.length) process.exit(1)
