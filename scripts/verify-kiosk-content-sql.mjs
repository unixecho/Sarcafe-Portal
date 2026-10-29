// Local database check for the kiosk content + customer poll migration, 2026-10-28. Applies every migration in order to
// an in-memory Postgres (PGlite), then exercises kiosk_content_save / kiosk_feedback_submit / _set_hidden / _summary and
// the access rules. Nothing here touches production.
//
//   node scripts/verify-kiosk-content-sql.mjs

import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIGRATION = '20261028171500_kiosk_content_and_customer_feedback.sql'
const migrations = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
const db = new PGlite({ extensions: { pgcrypto } })
let passed = 0
const failed = []
const check = (name, okay, detail = '') => {
  if (okay) { passed++; console.log(`  ✓ ${name}`) } else { failed.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const count = async (sql, params = []) => Number((await one(sql, params)).n)

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

console.log('\nmigration')
for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(migrations + file, 'utf8')) }
  catch (error) { check(`apply ${file}`, false, String(error.message).split('\n')[0]); console.error(error); process.exit(1) }
}
check('all migrations apply in order', true)
await db.exec(readFileSync(migrations + MIGRATION, 'utf8'))
check('re-applying the migration works and seeds nothing twice', await count(`select count(*) n from public.kiosk_ads`) === 5
  && await count(`select count(*) n from public.kiosk_feedback_options`) === 5 && await count(`select count(*) n from public.kiosk_settings`) === 1)

const branch = (await one(`select id from public.branches where slug = 'givat-haviva'`)).id
const owner = (await one(`insert into public.staff (first_name, role, badge, branch_id) values ('Owner', 'owner', 'owner', $1) returning id`, [branch])).id
const barista = (await one(`insert into public.staff (first_name, badge, branch_id) values ('Dana', 'barista', $1) returning id`, [branch])).id

console.log('\nseed')
const ads = (await db.query(`select kind, title, body, action, enabled, seed_key from public.kiosk_ads where branch_id=$1 order by sort_order`, [branch])).rows
check('the cards are seeded for the kiosk branch, in order', JSON.stringify(ads.map((a) => a.kind)) === JSON.stringify(['location', 'feedback', 'loyalty', 'hours', 'menu_highlight']))
const by = Object.fromEntries(ads.map((a) => [a.kind, a]))
check('location text is exact', by.location.body === 'בואו לבקר את סניף האם שלנו במאור באווירת מושב חמה בימי ראשון עד שישי')
check('feedback text is exact', by.feedback.body === 'סרקו את קוד ה-QR כדי להצביע ולהשפיע על מה שיש לעגלה להציע — אנחנו רוצים לשמוע אתכם')
check('loyalty text is exact, its button joins, and the title says it is coming (not active)', by.loyalty.body === 'מעוניינים במועדון לקוחות עם צבירת נקודות ואירועים? הירשמו בלחיצה על המסך' && by.loyalty.action === 'join' && /בקרוב/.test(by.loyalty.title))
check('the hours card has no stored body (it is written from the hours)', by.hours.body === '' && by.hours.enabled === true)
check('the menu highlight card starts switched off', by.menu_highlight.enabled === false && by.menu_highlight.action === 'menu')
const settings = await one(`select idle_seconds, grace_seconds, slide_seconds, hours_exceptions from public.kiosk_settings where branch_id=$1`, [branch])
check('settings default to 60 / 10 / 7 with no exceptions', settings.idle_seconds === 60 && settings.grace_seconds === 10 && settings.slide_seconds === 7 && Array.isArray(settings.hours_exceptions) && settings.hours_exceptions.length === 0)

console.log('\nkiosk_content_save')
const current = async () => ({
  ads: (await db.query(`select id, kind, title, body, action, image_url "imageUrl", menu_item_ids "menuItemIds", enabled from public.kiosk_ads where branch_id=$1 order by sort_order`, [branch])).rows,
  options: (await db.query(`select id, label, enabled from public.kiosk_feedback_options where branch_id=$1 order by sort_order`, [branch])).rows,
})
const save = async (over = {}, actor = owner) => {
  const c = await current()
  const body = {
    settings: { idleSeconds: 90, graceSeconds: 12, slideSeconds: 8, exceptions: [] },
    ads: c.ads.map((a) => ({ ...a, imageUrl: a.imageUrl })),
    options: c.options,
    ...over,
  }
  return (await one(`select public.kiosk_content_save($1, $2::jsonb, $3::jsonb, $4::jsonb) r`, [actor, JSON.stringify(body.settings), JSON.stringify(body.ads), JSON.stringify(body.options)])).r
}
let r = await save()
check('a plain save succeeds and stores the timings', r.ok === true && (await one(`select idle_seconds i, grace_seconds g, slide_seconds s from public.kiosk_settings`)).i === 90)
check('a non-owner actor is refused', (await save({}, barista)).error === 'forbidden')
for (const [label, s] of [['idle 29', { idleSeconds: 29, graceSeconds: 10, slideSeconds: 7, exceptions: [] }], ['idle 301', { idleSeconds: 301, graceSeconds: 10, slideSeconds: 7, exceptions: [] }], ['grace 4', { idleSeconds: 60, graceSeconds: 4, slideSeconds: 7, exceptions: [] }], ['grace 31', { idleSeconds: 60, graceSeconds: 31, slideSeconds: 7, exceptions: [] }], ['slide 2', { idleSeconds: 60, graceSeconds: 10, slideSeconds: 2, exceptions: [] }]]) {
  check(`out-of-range timing refused (${label})`, (await save({ settings: s })).error === 'bad_settings')
}
check('a refused save changed nothing', (await one(`select idle_seconds i from public.kiosk_settings`)).i === 90)

const c0 = await current()
const reordered = [...c0.ads].reverse()
r = await save({ ads: [...reordered, { id: null, kind: 'custom', title: 'ערב מוזיקה', body: 'בחמישי הקרוב', action: 'none', imageUrl: null, menuItemIds: [], enabled: true }] })
const after = await current()
check('cards are stored in the order sent, and a new custom card is added', r.ok && after.ads.length === 6 && after.ads[0].kind === 'menu_highlight' && after.ads[5].title === 'ערב מוזיקה')
const custom = after.ads[5]
r = await save({ ads: after.ads.filter((a) => a.id !== custom.id) })
check('a custom card can be deleted', r.ok && (await current()).ads.length === 5)
r = await save({ ads: (await current()).ads.filter((a) => a.kind !== 'location') })
check('a seeded card cannot be deleted (and nothing is written)', r.error === 'seeded_ad_missing' && (await current()).ads.length === 5)
const loc = (await current()).ads.find((a) => a.kind === 'location')
r = await save({ ads: (await current()).ads.map((a) => (a.id === loc.id ? { ...a, kind: 'custom', enabled: false, title: 'במאור' } : a)) })
const loc2 = (await current()).ads.find((a) => a.id === loc.id)
check('a seeded card can be switched off and retitled, but keeps its kind', r.ok && loc2.kind === 'location' && loc2.enabled === false && loc2.title === 'במאור')
for (const [label, patch] of [
  ['empty title', { title: '   ' }], ['401-letter body', { body: 'א'.repeat(401) }], ['unknown kind', { kind: 'popup' }], ['unknown action', { action: 'call' }],
  ['http image', { imageUrl: 'http://x.example/a.png' }], ['bad menu id', { menuItemIds: ['a b'] }], ['13 menu ids', { menuItemIds: Array.from({ length: 13 }, (_, i) => `id${i}`) }],
  ['enabled not boolean', { enabled: 'yes' }],
]) {
  const res = await save({ ads: (await current()).ads.map((a, i) => (i === 0 ? { ...a, ...patch } : a)) })
  check(`a card with ${label} is refused`, res.error === 'bad_ad' && res.index === 0, JSON.stringify(res))
}
check('more than 20 cards is refused', (await save({ ads: [...(await current()).ads, ...Array.from({ length: 16 }, () => ({ id: null, kind: 'custom', title: 'x', body: '', action: 'none', imageUrl: null, menuItemIds: [], enabled: true }))] })).error === 'too_many_ads')
const hl = (await current()).ads.find((a) => a.kind === 'menu_highlight')
r = await save({ ads: (await current()).ads.map((a) => (a.id === hl.id ? { ...a, enabled: true, menuItemIds: ['uid-1', 'uid_2'] } : a)) })
check('menu highlight items are stored', r.ok && JSON.stringify((await current()).ads.find((a) => a.id === hl.id).menuItemIds) === '["uid-1","uid_2"]')

console.log('\nhours exceptions')
const ex = (over = {}) => ({ date: '2026-12-25', closed: true, open: null, close: null, note: 'חג', ...over })
r = await save({ settings: { idleSeconds: 60, graceSeconds: 10, slideSeconds: 7, exceptions: [ex(), ex({ date: '2026-12-31', closed: false, open: '08:00', close: '13:00', note: null })] } })
const stored = (await one(`select hours_exceptions h from public.kiosk_settings`)).h
check('exceptions are stored, a closed day without times', r.ok && stored.length === 2 && stored[0].closed === true && stored[0].open === null && stored[1].open === '08:00')
for (const [label, e] of [['bad date', ex({ date: '25/12/2026' })], ['impossible date', ex({ date: '2026-02-30' })], ['open day without times', ex({ closed: false })], ['bad time', ex({ closed: false, open: '8:00', close: '13:00' })], ['81-letter note', ex({ note: 'א'.repeat(81) })]]) {
  check(`an exception with ${label} is refused`, (await save({ settings: { idleSeconds: 60, graceSeconds: 10, slideSeconds: 7, exceptions: [e] } })).error === 'bad_exception')
}
check('the same date twice is refused', (await save({ settings: { idleSeconds: 60, graceSeconds: 10, slideSeconds: 7, exceptions: [ex(), ex()] } })).error === 'duplicate_exception')

console.log('\npoll options')
let opts = (await current()).options
r = await save({ options: [...opts, { id: null, label: 'שייק פירות', enabled: true }] })
check('a new option is added', r.ok && (await current()).options.length === 6)
check('an option with an empty label is refused', (await save({ options: [{ id: null, label: ' ', enabled: true }] })).error === 'bad_option')
check('more than 12 options is refused', (await save({ options: Array.from({ length: 13 }, (_, i) => ({ id: null, label: `o${i}`, enabled: true })) })).error === 'too_many_options')
opts = (await current()).options

console.log('\nkiosk_feedback_submit')
const key = (s = 'a') => s.repeat(32)
const submit = async (over = {}) => {
  const a = { options: [], suggestion: null, rating: null, request: crypto.randomUUID(), key: key(), ...over }
  return (await one(`select public.kiosk_feedback_submit($1::uuid[], $2, $3, $4, $5) r`, [a.options, a.suggestion, a.rating, a.request, a.key])).r
}
const req1 = crypto.randomUUID()
r = await submit({ options: [opts[0].id, opts[1].id], suggestion: '  קפה  קר\nבבקשה ', rating: 5, request: req1 })
check('an answer with votes, a suggestion and a rating is stored', r.ok && r.status === 'created', JSON.stringify(r))
const row = await one(`select * from public.kiosk_feedback_responses where request_id=$1`, [req1])
check('the suggestion is trimmed and control characters flattened', row.suggestion === 'קפה  קר בבקשה')
check('no personal data columns exist on an answer', JSON.stringify(Object.keys(row).sort()) === JSON.stringify(['branch_id', 'created_at', 'hidden', 'id', 'option_ids', 'rating', 'request_id', 'suggestion']))
check('the same request id again is a replay, not a second answer', (await submit({ options: [opts[0].id], request: req1 })).status === 'replayed' && await count(`select count(*) n from public.kiosk_feedback_responses`) === 1)
check('a duplicated vote counts once', (await submit({ options: [opts[2].id, opts[2].id], key: key('b') })).ok && (await one(`select array_length(option_ids,1) n from public.kiosk_feedback_responses order by created_at desc limit 1`)).n === 1)
for (const [label, over, error] of [
  ['four votes', { options: opts.slice(0, 4).map((o) => o.id) }, 'too_many_options'],
  ['an unknown option', { options: [crypto.randomUUID()] }, 'bad_option'],
  ['a 501-letter suggestion', { suggestion: 'א'.repeat(501) }, 'bad_suggestion'],
  ['rating 0', { rating: 0 }, 'bad_rating'],
  ['rating 6', { rating: 6 }, 'bad_rating'],
  ['nothing at all', { suggestion: '   ' }, 'empty'],
]) {
  const res = await submit({ ...over, key: key('c') + label.length })
  check(`${label} is refused (${error})`, res.ok === false && res.error === error, JSON.stringify(res))
}
check('a missing or short caller key is refused', (await submit({ key: 'short', rating: 3 })).error === 'bad_request')
const off = opts[3]
await save({ options: opts.map((o) => (o.id === off.id ? { ...o, enabled: false } : o)) })
check('a switched-off option cannot be voted for', (await submit({ options: [off.id], key: key('d') })).error === 'bad_option')

console.log('\nrate limit and retention')
let limited = null
for (let i = 0; i < 10; i++) { const x = await submit({ rating: 4, key: key('r') }); if (x.error === 'rate_limited') { limited = i; break } }
check('one caller is limited after 8 answers in an hour', limited === 8, `limited at ${limited}`)
check('another caller is not affected', (await submit({ rating: 4, key: key('s') })).ok === true)
await db.query(`insert into public.kiosk_feedback_attempts (key_hash, at) values ('old-hit-old-hit-old-hit', now() - interval '25 hours')`)
await submit({ rating: 3, key: key('t') })
check('raw rate-limit hits older than a day are swept on the next answer', await count(`select count(*) n from public.kiosk_feedback_attempts where key_hash = 'old-hit-old-hit-old-hit'`) === 0)
check('the attempts table stores only a hash and a time', JSON.stringify((await db.query(`select column_name from information_schema.columns where table_name='kiosk_feedback_attempts' order by column_name`)).rows.map((x) => x.column_name)) === '["at","id","key_hash"]')

console.log('\nsummary and hiding')
await db.query(`update public.kiosk_feedback_responses set created_at = now() - interval '40 days' where request_id=$1`, [req1])
let s = (await one(`select public.kiosk_feedback_summary(30) r`)).r
const all = (await one(`select public.kiosk_feedback_summary(0) r`)).r
check('a 40-day-old answer is outside 30 days but inside all time', all.total === s.total + 1)
check('all-time counts the old answer\'s votes', all.options.find((o) => o.id === opts[0].id).votes === 1 && s.options.find((o) => o.id === opts[0].id).votes === 0)
check('the per-day series covers the period (7 days → 7 points; all time → 60)', (await one(`select jsonb_array_length(public.kiosk_feedback_summary(7)->'perDay') n`)).n === 7 && all.perDay.length === 60)
check('today\'s answers are counted on today', s.perDay[s.perDay.length - 1].count === s.total)
check('the rating average is computed', Number(all.ratingAverage) > 0 && all.ratingCount >= 1)
const victim = (await one(`select id from public.kiosk_feedback_responses where request_id=$1`, [req1])).id
check('hiding an answer works and takes it out of the counts', (await one(`select public.kiosk_feedback_set_hidden($1, true) r`, [victim])).r.ok
  && (await one(`select public.kiosk_feedback_summary(0) r`)).r.total === all.total - 1)
check('it can be shown again', (await one(`select public.kiosk_feedback_set_hidden($1, false) r`, [victim])).r.ok && (await one(`select public.kiosk_feedback_summary(0) r`)).r.total === all.total)
check('an unknown answer is reported', (await one(`select public.kiosk_feedback_set_hidden(gen_random_uuid(), true) r`)).r.error === 'not_found')
check('a negative period is refused', (await one(`select public.kiosk_feedback_summary(-1) r`)).r.error === 'bad_request')

console.log('\nremoving a voted option')
opts = (await current()).options
const voted = opts[0]
const unvoted = opts.find((o) => o.label === 'שייק פירות')
r = await save({ options: opts.filter((o) => o.id !== voted.id && o.id !== unvoted.id) })
check('an option with votes is switched off, not deleted (its label survives in the results)', r.ok && (await one(`select enabled from public.kiosk_feedback_options where id=$1`, [voted.id])).enabled === false)
check('an option without votes is deleted', await count(`select count(*) n from public.kiosk_feedback_options where id=$1`, [unvoted.id]) === 0)
check('the switched-off option still shows in the summary because it has votes', (await one(`select public.kiosk_feedback_summary(0) r`)).r.options.some((o) => o.id === voted.id && o.enabled === false))

console.log('\naccess')
const tables = ['kiosk_settings', 'kiosk_ads', 'kiosk_feedback_options', 'kiosk_feedback_responses', 'kiosk_feedback_attempts']
const fns = ['kiosk_content_save(uuid,jsonb,jsonb,jsonb)', 'kiosk_feedback_submit(uuid[],text,integer,uuid,text)', 'kiosk_feedback_set_hidden(uuid,boolean)', 'kiosk_feedback_summary(integer)']
for (const role of ['anon', 'authenticated']) {
  for (const table of tables) {
    check(`${role} has no grant on ${table}`, !(await one(`select has_table_privilege('${role}', 'public.${table}', 'select') or has_table_privilege('${role}', 'public.${table}', 'insert') or has_table_privilege('${role}', 'public.${table}', 'update') or has_table_privilege('${role}', 'public.${table}', 'delete') a`)).a)
  }
  for (const fn of fns) {
    check(`${role} cannot execute ${fn.split('(')[0]}`, !(await one(`select has_function_privilege('${role}', 'public.${fn}', 'execute') a`)).a)
  }
}
for (const fn of fns) check(`service_role can execute ${fn.split('(')[0]}`, (await one(`select has_function_privilege('service_role', 'public.${fn}', 'execute') a`)).a === true)
check('every table has row level security on', await count(`select count(*) n from pg_class where relname = any($1) and relrowsecurity`, [tables]) === tables.length)
check('no browser policy exists on these tables', await count(`select count(*) n from pg_policies where tablename = any($1)`, [tables]) === 0)
check('no function name in public has two signatures (extension functions aside)', await count(`select count(*) n from (select proname from pg_proc p where pronamespace='public'::regnamespace and prokind='f' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') group by proname having count(*)>1) t`) === 0)
check('every new function is security definer with a fixed search_path', await count(`select count(*) n from pg_proc where proname in ('kiosk_content_save','kiosk_feedback_submit','kiosk_feedback_set_hidden','kiosk_feedback_summary') and prosecdef and proconfig::text like '%search_path=public%'`) === 4)

console.log(`\n${passed} passed, ${failed.length} failed`)
if (failed.length) { console.log('FAILED:\n - ' + failed.join('\n - ')); process.exit(1) }
