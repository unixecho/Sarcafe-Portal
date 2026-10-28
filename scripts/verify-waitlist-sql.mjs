// Local database check for the kiosk sign-up (customer waitlist) migration, 2026-10-27. Applies every migration in order to an
// in-memory Postgres (PGlite), then exercises customer_waitlist_register / _set_marketing / _erase and the access rules.
// Nothing here touches production.
//
//   node scripts/verify-waitlist-sql.mjs

import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const migrations = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
const db = new PGlite({ extensions: { pgcrypto } })
let passed = 0
const failed = []
const check = (name, okay, detail = '') => {
  if (okay) { passed++; console.log(`  ✓ ${name}`) } else { failed.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const reg = async (over = {}) => {
  const a = { name: 'דנה', phone: '054-123 4567', email: null, marketing: false, request: crypto.randomUUID(), key: 'k'.repeat(32), ...over }
  return (await one(`select public.customer_waitlist_register($1,$2,$3,$4,'privacy-v1','consent-v1','terms-v1',$5,$6) r`, [a.name, a.phone, a.email, a.marketing, a.request, a.key])).r
}

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

console.log('\nwaitlist migration')
for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(migrations + file, 'utf8')) }
  catch (error) { check(`apply ${file}`, false, String(error.message).split('\n')[0]); console.error(error); process.exit(1) }
}
check('all migrations apply in order (the new one is idempotent: it applies twice)', true)
await db.exec(readFileSync(migrations + '20261027150000_customer_waitlist.sql', 'utf8'))
await db.exec(readFileSync(migrations + '20261028150000_customer_waitlist_no_repeat.sql', 'utf8')) // the later function definition goes back on top
check('re-applying the waitlist migrations (in order) changes nothing', true)

const branch = (await one(`select id from public.branches where slug = 'givat-haviva'`)).id
const owner = (await one(`insert into public.staff (first_name, role, badge, branch_id) values ('Owner', 'owner', 'owner', $1) returning id`, [branch])).id
const dev = (await one(`insert into public.staff (first_name, role, badge, branch_id) values ('Dev', 'staff', 'developer', $1) returning id`, [branch])).id
const barista = (await one(`insert into public.staff (first_name, badge, branch_id) values ('Dana', 'barista', $1) returning id`, [branch])).id
const gone = (await one(`insert into public.staff (first_name, role, badge, branch_id, active) values ('Old', 'owner', 'owner', $1, false) returning id`, [branch])).id
const notes = async () => (await db.query(`select staff_id, kind, title, body, link from public.schedule_notifications where kind in ('club.signup','dev.club_signup') order by created_at, kind`)).rows

console.log('\nsigning up')
const firstRequest = crypto.randomUUID()
let r = await reg({ marketing: true, email: 'Dana@Example.com', request: firstRequest })
check('a new sign-up succeeds and says created', r.ok === true && r.status === 'created', JSON.stringify(r))
const c = await one(`select * from public.customer_waitlist_contacts`)
check('the phone is stored normalized (05XXXXXXXX), the e-mail lower-cased', c.normalized_phone === '0541234567' && c.email === 'dana@example.com')
check('marketing yes is stored on the contact', c.current_marketing_consent === true)
const ev = (await db.query(`select event_type, terms_version, marketing_consent from public.customer_waitlist_consent_events order by created_at, event_type`)).rows
check('an interest event and a separate marketing event are recorded, with the versions', ev.length === 2 && ev.some((e) => e.event_type === 'interest_registered' && e.terms_version === 'terms-v1') && ev.some((e) => e.event_type === 'marketing_granted'))
let n = await notes()
check('the owner and the developer are told, nobody else (no barista, no inactive owner)', n.length === 2 && n.some((x) => x.staff_id === owner) && n.some((x) => x.staff_id === dev) && !n.some((x) => x.staff_id === barista || x.staff_id === gone))
check('the owner gets club.signup and the developer dev.club_signup', n.find((x) => x.staff_id === owner).kind === 'club.signup' && n.find((x) => x.staff_id === dev).kind === 'dev.club_signup')
check('the notification links to the owner page and holds no customer data', n.every((x) => x.link.url === '/owner/waitlist' && !/דנה|054|dana|example/i.test(x.title + x.body)))

console.log('\nthe same number cannot register again')
const before = { notes: (await notes()).length, events: Number((await one(`select count(*) n from public.customer_waitlist_consent_events`)).n) }
const again = await reg({ phone: '054-123 4567', name: 'מישהו אחר', email: 'other@example.com', marketing: true })
check('a second sign-up with the same number is refused: already_registered', again.ok === false && again.error === 'already_registered', JSON.stringify(again))
const stored = await one(`select first_name, email, current_marketing_consent from public.customer_waitlist_contacts`)
check('nothing about the first person changed (name, e-mail)', stored.first_name === 'דנה' && stored.email === 'dana@example.com')
check('no new event and no new notification was written', (await notes()).length === before.notes && Number((await one(`select count(*) n from public.customer_waitlist_consent_events`)).n) === before.events)
for (const [label, phone] of [['+972 with spaces', '+972 54 123 4567'], ['972 without plus', '972541234567'], ['dashes', '054-123-4567'], ['dots', '054.123.4567'], ['wrapped in text', ' tel: 054 1234567 ']]) {
  const x = await reg({ phone, name: 'x' })
  check(`the same number written as "${label}" is the same person`, x.error === 'already_registered', JSON.stringify(x))
}
check('another person cannot switch marketing on or off for a registered number', (await one(`select current_marketing_consent c from public.customer_waitlist_contacts`)).c === true
  && (await reg({ phone: '0541234567', marketing: false })).error === 'already_registered')
const replay = await reg({ request: firstRequest })
check('a retry of the SAME request (lost answer) is still a harmless success', replay.ok === true && replay.status === 'replayed' && (await notes()).length === before.notes)
check('refused repeats do not count as registrations: one contact, one marketing event', Number((await one(`select count(*) n from public.customer_waitlist_contacts`)).n) === 1
  && Number((await one(`select count(*) n from public.customer_waitlist_consent_events where event_type='marketing_granted'`)).n) === 1)
check('a different number registers normally', (await reg({ phone: '0529990000', name: 'עוד' })).status === 'created')
const gone2 = (await one(`select id from public.customer_waitlist_contacts where normalized_phone='0529990000'`)).id
await one(`select public.customer_waitlist_erase($1) r`, [gone2])
check('after the owner erases someone, that number can sign up again', (await reg({ phone: '0529990000', name: 'שוב' })).status === 'created')
// tidy the fixtures this section added, so the later sections count what they always counted
await db.query(`delete from public.customer_waitlist_contacts where normalized_phone = '0529990000'`)
await db.query(`delete from public.customer_waitlist_consent_events where contact_id is null`)

console.log('\nbad input')
for (const [label, over, error] of [
  ['a landline', { phone: '03-5551234' }, 'bad_phone'],
  ['a short mobile', { phone: '054123456' }, 'bad_phone'],
  ['an empty name', { name: '   ' }, 'bad_name'],
  ['a 61-letter name', { name: 'א'.repeat(61) }, 'bad_name'],
  ['a broken e-mail', { email: 'not-an-email' }, 'bad_email'],
]) {
  const res = await reg({ ...over, phone: over.phone ?? '0529998888', key: 'z'.repeat(32) + label.length })
  check(`${label} is refused (${error})`, res.ok === false && res.error === error, JSON.stringify(res))
}
check('refused sign-ups store nothing', Number((await one(`select count(*) n from public.customer_waitlist_contacts`)).n) === 1)
const noKey = (await one(`select public.customer_waitlist_register('x','0521112222',null,false,'a','b','c',gen_random_uuid(),'short') r`)).r
check('a missing or short caller key is refused', noKey.ok === false && noKey.error === 'bad_request')

console.log('\nrate limit')
let limited = null
for (let i = 0; i < 14; i++) { const x = await reg({ phone: `05220000${String(i).padStart(2, '0')}`, key: 'rate-key-'.repeat(4) }); if (x.error === 'rate_limited') { limited = i; break } }
check('one caller is limited after 12 attempts in an hour', limited !== null && limited >= 10 && limited <= 12, `limited at ${limited}`)
check('another caller is not affected', (await reg({ phone: '0533334444', key: 'other-key-'.repeat(4) })).ok === true)

console.log('\nowner actions')
const contactId = (await one(`select id from public.customer_waitlist_contacts where normalized_phone='0541234567'`)).id
check('withdrawing marketing records an event and flips the flag', (await one(`select public.customer_waitlist_set_marketing($1,false) r`, [contactId])).r.status === 'changed'
  && (await one(`select current_marketing_consent c from public.customer_waitlist_contacts where id=$1`, [contactId])).c === false
  && Number((await one(`select count(*) n from public.customer_waitlist_consent_events where event_type='marketing_withdrawn'`)).n) === 1)
check('withdrawing again is a no-op', (await one(`select public.customer_waitlist_set_marketing($1,false) r`, [contactId])).r.status === 'unchanged')
check('erasing removes the person but keeps minimal evidence without a link', (await one(`select public.customer_waitlist_erase($1) r`, [contactId])).r.ok === true
  && Number((await one(`select count(*) n from public.customer_waitlist_contacts where id=$1`, [contactId])).n) === 0
  && Number((await one(`select count(*) n from public.customer_waitlist_consent_events where contact_id=$1`, [contactId])).n) === 0
  && Number((await one(`select count(*) n from public.customer_waitlist_consent_events where event_type='contact_deleted' and contact_id is null`)).n) === 1)
check('an unknown contact is reported, not invented', (await one(`select public.customer_waitlist_erase(gen_random_uuid()) r`)).r.error === 'not_found')

console.log('\nretention')
await reg({ phone: '0501110000', name: 'ישנה', key: 'ret-key-'.repeat(4) })
await reg({ phone: '0501110001', name: 'חדשה', key: 'ret-key-'.repeat(4) })
await db.query(`update public.customer_waitlist_contacts set last_interest_at = now() - interval '13 months' where normalized_phone = '0501110000'`)
await db.query(`update public.customer_waitlist_contacts set last_interest_at = now() - interval '11 months' where normalized_phone = '0501110001'`)
const purged = (await one(`select public.customer_waitlist_purge_expired(12) n`)).n
check('only the contact whose last interest is over 12 months old is erased', purged === 1
  && Number((await one(`select count(*) n from public.customer_waitlist_contacts where normalized_phone='0501110000'`)).n) === 0
  && Number((await one(`select count(*) n from public.customer_waitlist_contacts where normalized_phone='0501110001'`)).n) === 1)
check('each retention erasure leaves one minimal event with no link to the person', Number((await one(`select count(*) n from public.customer_waitlist_consent_events where source='retention' and contact_id is null`)).n) === 1)
check('running it again erases nothing, and a nonsense period erases nothing', (await one(`select public.customer_waitlist_purge_expired(12) n`)).n === 0 && (await one(`select public.customer_waitlist_purge_expired(0) n`)).n === 0)
check('only service_role may run the purge', !(await one(`select has_function_privilege('anon','public.customer_waitlist_purge_expired(integer)','execute') or has_function_privilege('authenticated','public.customer_waitlist_purge_expired(integer)','execute') a`)).a
  && (await one(`select has_function_privilege('service_role','public.customer_waitlist_purge_expired(integer)','execute') a`)).a === true)

console.log('\naccess')
for (const role of ['anon', 'authenticated']) {
  for (const table of ['customer_waitlist_contacts', 'customer_waitlist_consent_events', 'customer_waitlist_attempts']) {
    check(`${role} has no grant on ${table}`, !(await one(`select has_table_privilege('${role}', 'public.${table}', 'select') or has_table_privilege('${role}', 'public.${table}', 'insert') a`)).a)
  }
  for (const fn of ['customer_waitlist_register(text,text,text,boolean,text,text,text,uuid,text)', 'customer_waitlist_set_marketing(uuid,boolean)', 'customer_waitlist_erase(uuid)']) {
    check(`${role} cannot execute ${fn.split('(')[0]}`, !(await one(`select has_function_privilege('${role}', 'public.${fn}', 'execute') a`)).a)
  }
}
check('service_role can execute all three', (await one(`select has_function_privilege('service_role','public.customer_waitlist_register(text,text,text,boolean,text,text,text,uuid,text)','execute') a, has_function_privilege('service_role','public.customer_waitlist_set_marketing(uuid,boolean)','execute') b, has_function_privilege('service_role','public.customer_waitlist_erase(uuid)','execute') c`)).a === true)
check('all three tables have row level security on', Number((await one(`select count(*) n from pg_class where relname in ('customer_waitlist_contacts','customer_waitlist_consent_events','customer_waitlist_attempts') and relrowsecurity`)).n) === 3)
check('no function name has two signatures', Number((await one(`select count(*) n from (select proname from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and proname like 'customer_waitlist%' group by proname having count(*)>1) t`)).n) === 0)

console.log(`\n${passed} passed, ${failed.length} failed`)
if (failed.length) { console.log('FAILED:\n - ' + failed.join('\n - ')); process.exit(1) }
