// Behavioural verification of the POS migrations, run against an in-process
// Postgres (PGlite — real Postgres compiled to WASM), so the SQL is exercised
// BEFORE it ever touches a Supabase project.
//
//   node scripts/verify-pos-sql.mjs
//
// It stubs what Supabase provides (roles, the `auth` schema + auth.uid(), the
// supabase_realtime publication), applies EVERY migration in supabase/migrations
// in order, then exercises the POS functions: idempotent create, the
// compare-and-swap under concurrency, derived order status, voids, the
// immutability / append-only triggers, route uniqueness, sessions, training
// wipe, retention, and the privilege model (as the roles a browser would be).
//
// Requires the dev dependency @electric-sql/pglite.

import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIG = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
const db = new PGlite({ extensions: { pgcrypto } })

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(name)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const section = (t) => console.log(`\n${t}`)
const q = async (sql, params) => (await db.query(sql, params)).rows
const one = async (sql, params) => (await q(sql, params))[0]
const rpc = async (fn, args) => {
  const keys = Object.keys(args)
  const placeholders = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
  const row = await one(`select public.${fn}(${placeholders}) as r`, keys.map((k) => args[k]))
  return row.r
}
async function asRole(role, sub, fn) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${sub ?? ''}', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}
async function refused(sql, params) {
  try {
    await db.query(sql, params)
    return false
  } catch (e) {
    return /permission denied|42501|row-level security|append-only|immutable/i.test(String(e.message)) ? true : String(e.message)
  }
}

// ---- Stand-ins for what Supabase provides ---------------------------------
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create publication supabase_realtime;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
`)

section('migrations apply in order')
const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()
for (const f of files) {
  try {
    await db.exec(readFileSync(MIG + f, 'utf8'))
    check(`apply ${f}`, true)
  } catch (e) {
    check(`apply ${f}`, false, String(e.message).split('\n')[0])
    console.log('\nCannot continue past a failed migration.')
    process.exit(1)
  }
}
try {
  for (const f of files.filter((x) => /_pos_/.test(x))) await db.exec(readFileSync(MIG + f, 'utf8'))
  check('POS migrations are re-runnable (idempotent)', true)
} catch (e) {
  check('POS migrations are re-runnable (idempotent)', false, String(e.message).split('\n')[0])
}

// ---- Fixtures -------------------------------------------------------------
const maor = (await one(`select id from public.branches where slug = 'maor'`)).id
const ghav = (await one(`select id from public.branches where slug = 'givat-haviva'`)).id
async function addStaff(email, first, role = 'staff', badge = null) {
  const u = await one(`insert into auth.users (email) values ($1) returning id`, [email])
  const s = await one(
    `insert into public.staff (auth_user_id, email, first_name, role, badge) values ($1, $2, $3, $4, $5) returning id, handle`,
    [u.id, email, first, role, badge],
  )
  return { ...s, authId: u.id }
}
const owner = await addStaff('owner@x.test', 'Maya', 'owner', 'owner')
const dana = await addStaff('dana@x.test', 'Dana')
const yossi = await addStaff('yossi@x.test', 'Yossi')
const customer = await one(`insert into auth.users (email) values ('customer@x.test') returning id`) // signed-in Google user, NOT staff

const name = (he, en) => ({ he, en, ar: '' })
const line = (pointId, over = {}) => ({
  point_id: pointId, item_uid: 'i1', category_id: 'c1', category_title: name('קפה', 'Coffee'),
  name: name('הפוך', 'Latte'), unit_agorot: 1500, qty: 1, ...over,
})

// ============================================================================
section('staff nickname')
check('every staff row got a handle', (await one(`select count(*)::int n from public.staff where handle is null`)).n === 0)
check('placeholder handle is unconfirmed (handle_set_at null)', (await one(`select handle_set_at from public.staff where id = $1`, [dana.id])).handle_set_at === null)
check('handles are derived from the first name', dana.handle === 'Dana' && yossi.handle === 'Yossi', `${dana.handle}/${yossi.handle}`)
const dup = await addStaff('maya2@x.test', 'Maya')
check('a colliding suggestion is de-duplicated', dup.handle !== owner.handle && /^Maya\d/.test(dup.handle), dup.handle)
const noFirst = await addStaff('no.first@x.test', null)
check('falls back to the email local part', noFirst.handle === 'no.first', noFirst.handle)
check('rejects a bad handle (too short)', (await rpc('pos_set_handle', { p_actor: owner.id, p_target: dana.id, p_handle: 'x' })).reason === 'invalid')
check('rejects a bad handle (space)', (await rpc('pos_set_handle', { p_actor: owner.id, p_target: dana.id, p_handle: 'da na' })).reason === 'invalid')
check('accepts a Hebrew handle', (await rpc('pos_set_handle', { p_actor: owner.id, p_target: dana.id, p_handle: 'דנה' })).ok === true)
check('a confirmed handle stamps handle_set_at', (await one(`select handle_set_at from public.staff where id = $1`, [dana.id])).handle_set_at !== null)
check('handles are case-insensitively unique', (await rpc('pos_set_handle', { p_actor: owner.id, p_target: yossi.id, p_handle: 'MAYA' })).reason === 'taken')
await rpc('pos_set_handle', { p_actor: owner.id, p_target: dana.id, p_handle: 'Dana' })

// ============================================================================
section('POS enablement, sessions, points')
const pizza = await rpc('pos_save_point', {
  p_staff: owner.id, p_branch: maor, p_point: null, p_move: false,
  p_cfg: { name: 'פיצה', icon: 'pizza', colour: '#FF7A45', hands_over: true, prep_minutes: 10, category_ids: ['pizza', 'pastries'], item_uids: [], excluded_uids: [], staff_ids: [dana.id] },
})
check('creating a point works', pizza.ok === true && !!pizza.point_id, JSON.stringify(pizza))
const coffee = await rpc('pos_save_point', {
  p_staff: owner.id, p_branch: maor, p_point: null, p_move: false,
  p_cfg: { name: 'קפה', icon: 'coffee', colour: '#57D9C0', hands_over: true, prep_minutes: 3, category_ids: ['hotCoffee'], item_uids: ['vanillaSlush'], excluded_uids: [], staff_ids: [] },
})
check('a second point works', coffee.ok === true, JSON.stringify(coffee))
const dupName = await rpc('pos_save_point', {
  p_staff: owner.id, p_branch: maor, p_point: null, p_move: false,
  p_cfg: { name: 'קפה', colour: '#111111', category_ids: [] },
})
check('duplicate active point name is refused', dupName.reason === 'name_taken')
const conflict = await rpc('pos_save_point', {
  p_staff: owner.id, p_branch: maor, p_point: null, p_move: false,
  p_cfg: { name: 'שייקים', colour: '#99AA00', category_ids: ['pizza'] },
})
check('claiming a category another point makes is a conflict, naming it',
  conflict.reason === 'conflicts' && conflict.conflicts[0].point_name === 'פיצה', JSON.stringify(conflict))
const moved = await rpc('pos_save_point', {
  p_staff: owner.id, p_branch: maor, p_point: null, p_move: true,
  p_cfg: { name: 'שייקים', colour: '#99AA00', category_ids: ['pizza'] },
})
check('moving the category takes it over', moved.ok === true)
const pizzaRoutes = await q(`select ref from public.pos_point_routes where point_id = $1 and kind = 'category' order by ref`, [pizza.point_id])
check('…and the old point no longer owns it', pizzaRoutes.map((r) => r.ref).join() === 'pastries', pizzaRoutes.map((r) => r.ref).join())
check('route uniqueness is enforced by the database',
  (await refused(`insert into public.pos_point_routes (branch_id, point_id, kind, ref) values ($1, $2, 'category', 'pizza')`, [maor, pizza.point_id])) !== false)
const shakes = moved.point_id

const noSessionYet = await rpc('pos_create_order', {
  p_staff: dana.id, p_branch: maor, p_client_key: crypto.randomUUID(), p_customer_name: 'יוסי', p_customer_phone: null,
  p_receipt_ref: null, p_slip_total_agorot: null, p_note: null, p_lines: [line(coffee.point_id)],
})
check('cannot create an order before POS is enabled / a session is open', noSessionYet.reason === 'no_session')
check('cannot open a session while POS is not enabled', (await rpc('pos_open_session', { p_staff: owner.id, p_branch: maor })).reason === 'not_enabled')
check('enable POS for the branch', (await rpc('pos_configure_branch', { p_staff: owner.id, p_branch: maor, p_enabled: true, p_board_token: 'a'.repeat(64) })).ok === true)
const sess = await rpc('pos_open_session', { p_staff: owner.id, p_branch: maor })
check('open a live session', sess.ok === true)
check('only one active session per branch', (await rpc('pos_open_session', { p_staff: owner.id, p_branch: maor })).reason === 'already_open')
check('a session can be open on another branch independently', (await rpc('pos_configure_branch', { p_staff: owner.id, p_branch: ghav, p_enabled: true })).ok === true && (await rpc('pos_open_session', { p_staff: owner.id, p_branch: ghav, p_kind: 'training' })).ok === true)
check('POS cannot be disabled while a session is active', (await rpc('pos_configure_branch', { p_staff: owner.id, p_branch: ghav, p_enabled: false })).reason === 'session_active')

// ============================================================================
section('creating orders')
const key1 = crypto.randomUUID()
const create = (key, over = {}) => rpc('pos_create_order', {
  p_staff: dana.id, p_branch: maor, p_client_key: key, p_customer_name: '  יוסי   כהן ', p_customer_phone: '054-123 4567',
  p_receipt_ref: 'H-9912', p_slip_total_agorot: 4500, p_note: 'לקחת ביחד',
  p_lines: [
    line(coffee.point_id, { qty: 2, unit_agorot: 1500 }),
    line(pizza.point_id, { item_uid: 'i2', name: name('פיצה', 'Pizza'), unit_agorot: 3000, for_name: 'שרה', note: 'בלי בצל' }),
  ],
  ...over,
})
const o1 = await create(key1)
check('create order ok', o1.ok === true && o1.ticket_no === 1 && o1.total_agorot === 6000, JSON.stringify(o1))
const ord1 = await one(`select * from public.pos_orders where id = $1`, [o1.order_id])
check('name normalised (trim + collapse spaces)', ord1.customer_name === 'יוסי כהן', ord1.customer_name)
check('phone normalised to digits', ord1.customer_phone === '0541234567', ord1.customer_phone)
check('creator + handle snapshot stamped', ord1.created_by === dana.id && ord1.created_by_handle === 'Dana')
check('slip mismatch flagged (slip 45 vs total 60)', ord1.slip_mismatch === true)
check('order starts open', ord1.status === 'open')
const lines1 = await q(`select * from public.pos_order_items where order_id = $1 order by seq`, [o1.order_id])
check('lines born "sent", snapshotting point name + routing',
  lines1.length === 2 && lines1.every((l) => l.status === 'sent') && lines1[0].point_name === 'קפה' && lines1[1].point_name === 'פיצה')
const dedupe = await create(key1)
check('same client_key returns the SAME order (idempotent)', dedupe.ok && dedupe.deduped === true && dedupe.order_id === o1.order_id && dedupe.ticket_no === 1)
check('…and created no second order', (await one(`select count(*)::int n from public.pos_orders`)).n === 1)
const [r1, r2] = await Promise.all([create(crypto.randomUUID()), create(crypto.randomUUID())])
check('two simultaneous orders get different ticket numbers', r1.ok && r2.ok && r1.ticket_no !== r2.ticket_no && [r1.ticket_no, r2.ticket_no].sort().join() === '2,3', `${r1.ticket_no},${r2.ticket_no}`)
const kRace = crypto.randomUUID()
const [d1, d2] = await Promise.all([create(kRace), create(kRace)])
check('two simultaneous RETRIES of one key make exactly one order',
  d1.ok && d2.ok && d1.order_id === d2.order_id && (await one(`select count(*)::int n from public.pos_orders where client_key = $1`, [kRace])).n === 1)
check('missing customer name refused', (await create(crypto.randomUUID(), { p_customer_name: '   ' })).reason === 'bad_customer')
check('over-long name refused', (await create(crypto.randomUUID(), { p_customer_name: 'x'.repeat(41) })).reason === 'bad_customer')
check('bad phone refused', (await create(crypto.randomUUID(), { p_customer_phone: 'abc' })).reason === 'bad_customer')
check('a line for an unknown point refused', (await create(crypto.randomUUID(), { p_lines: [line(crypto.randomUUID())] })).reason === 'bad_point')
check('a line for ANOTHER branch\'s point refused',
  (await create(crypto.randomUUID(), { p_lines: [line((await rpc('pos_save_point', { p_staff: owner.id, p_branch: ghav, p_point: null, p_move: false, p_cfg: { name: 'אחר', colour: '#123456', category_ids: [] } })).point_id)] })).reason === 'bad_point')
check('qty 0 refused', (await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id, { qty: 0 })] })).reason === 'bad_line')
check('qty 100 refused', (await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id, { qty: 100 })] })).reason === 'bad_line')
check('negative price refused', (await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id, { unit_agorot: -5 })] })).reason === 'bad_line')
check('fractional qty refused', (await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id, { qty: 1.5 })] })).reason === 'bad_line')
check('a free (price 0) line is valid — free water needs a real line', (await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id, { unit_agorot: 0 })] })).ok === true)
check('empty lines refused', (await create(crypto.randomUUID(), { p_lines: [] })).reason === 'bad_line')
check('an unknown actor refused', (await rpc('pos_create_order', { p_staff: crypto.randomUUID(), p_branch: maor, p_client_key: crypto.randomUUID(), p_customer_name: 'a', p_customer_phone: null, p_receipt_ref: null, p_slip_total_agorot: null, p_note: null, p_lines: [line(coffee.point_id)] })).reason === 'no_actor')
const ev1 = await q(`select event, actor_handle, payload from public.pos_events where order_id = $1`, [o1.order_id])
check('order_created audit row written with the actor handle', ev1.length === 1 && ev1[0].event === 'order_created' && ev1[0].actor_handle === 'Dana')
check('…carrying display data (customer, items)', ev1[0].payload.customer_name === 'יוסי כהן' && ev1[0].payload.items.length === 2)
check('…and the PHONE never appears in the audit log', !JSON.stringify(ev1).includes('054'))

// ============================================================================
section('the lifecycle and the compare-and-swap')
const ids = lines1.map((l) => l.id)
const [coffeeLine, pizzaLine] = ids
const claim = await rpc('pos_advance_items', { p_staff: dana.id, p_ids: [coffeeLine], p_from: 'sent', p_to: 'preparing' })
check('claim: sent → preparing', claim.ok.length === 1 && claim.conflict.length === 0)
const cl = await one(`select * from public.pos_order_items where id = $1`, [coffeeLine])
check('claim stamps claimed_by / claimed_at', cl.claimed_by === dana.id && cl.claimed_at !== null && cl.status === 'preparing')
const [c1, c2] = await Promise.all([
  rpc('pos_advance_items', { p_staff: dana.id, p_ids: [pizzaLine], p_from: 'sent', p_to: 'preparing' }),
  rpc('pos_advance_items', { p_staff: yossi.id, p_ids: [pizzaLine], p_from: 'sent', p_to: 'preparing' }),
])
check('two tablets claiming the same line: exactly one wins',
  c1.ok.length + c2.ok.length === 1 && c1.conflict.length + c2.conflict.length === 1, `${c1.ok.length}/${c2.ok.length}`)
const winner = c1.ok.length === 1 ? dana.id : yossi.id
check('…and the winner is the one recorded', (await one(`select claimed_by from public.pos_order_items where id = $1`, [pizzaLine])).claimed_by === winner)
check('a stale "from" is a conflict, not an error', (await rpc('pos_advance_items', { p_staff: dana.id, p_ids: [coffeeLine], p_from: 'sent', p_to: 'preparing' })).conflict.length === 1)
check('an unknown id is reported missing', (await rpc('pos_advance_items', { p_staff: dana.id, p_ids: [crypto.randomUUID()], p_from: 'sent', p_to: 'preparing' })).missing.length === 1)
check('an illegal jump (sent → delivered) is invalid', (await rpc('pos_advance_items', { p_staff: dana.id, p_ids: [coffeeLine], p_from: 'sent', p_to: 'delivered' })).invalid === true)
check('delivered → ready needs manager', (await rpc('pos_advance_items', { p_staff: dana.id, p_ids: [coffeeLine], p_from: 'delivered', p_to: 'ready' })).invalid === true)
const ready = await rpc('pos_advance_items', { p_staff: dana.id, p_ids: [coffeeLine, pizzaLine], p_from: 'preparing', p_to: 'ready' })
check('batch: both lines ready in one call', ready.ok.length === 2)
check('ready stamps ready_at', (await one(`select ready_at from public.pos_order_items where id = $1`, [coffeeLine])).ready_at !== null)
check('a fast point may skip accept (sent → ready), claim stamped implicitly', await (async () => {
  const o = await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id)] })
  const l = (await one(`select id from public.pos_order_items where order_id = $1`, [o.order_id])).id
  const r = await rpc('pos_advance_items', { p_staff: yossi.id, p_ids: [l], p_from: 'sent', p_to: 'ready' })
  const row = await one(`select claimed_by, ready_at from public.pos_order_items where id = $1`, [l])
  return r.ok.length === 1 && row.claimed_by === yossi.id && row.ready_at !== null
})())
check('a mis-tap on ready can be reverted (ready → preparing), clearing ready_at', await (async () => {
  const r = await rpc('pos_advance_items', { p_staff: dana.id, p_ids: [coffeeLine], p_from: 'ready', p_to: 'preparing' })
  const row = await one(`select ready_at, status from public.pos_order_items where id = $1`, [coffeeLine])
  await rpc('pos_advance_items', { p_staff: dana.id, p_ids: [coffeeLine], p_from: 'preparing', p_to: 'ready' })
  return r.ok.length === 1 && row.ready_at === null && row.status === 'preparing'
})())
const deliver1 = await rpc('pos_advance_items', { p_staff: yossi.id, p_ids: [coffeeLine], p_from: 'ready', p_to: 'delivered' })
const dl = await one(`select * from public.pos_order_items where id = $1`, [coffeeLine])
check('deliver stamps delivered_by', deliver1.ok.length === 1 && dl.delivered_by === yossi.id && dl.delivered_at !== null)
check('serve implies pickup: picked_up_* stamped before delivered', dl.picked_up_by === yossi.id && dl.picked_up_at !== null)
check('order is still OPEN while a line is outstanding', (await one(`select status from public.pos_orders where id = $1`, [o1.order_id])).status === 'open')
await rpc('pos_advance_items', { p_staff: dana.id, p_ids: [pizzaLine], p_from: 'ready', p_to: 'delivered' })
const done1 = await one(`select status, completed_at from public.pos_orders where id = $1`, [o1.order_id])
check('order becomes COMPLETED when every line is delivered', done1.status === 'completed' && done1.completed_at !== null)
const evTypes = (await q(`select event from public.pos_events where order_id = $1 order by id`, [o1.order_id])).map((r) => r.event)
check('the whole story is in the audit log, in order',
  ['order_created', 'item_claimed', 'item_ready', 'item_picked_up', 'item_delivered', 'order_completed'].every((e) => evTypes.includes(e)), evTypes.join())
const actors = new Set((await q(`select actor_handle from public.pos_events where order_id = $1`, [o1.order_id])).map((r) => r.actor_handle))
check('…attributed to the people who actually did each step', actors.has('Dana') && actors.has('Yossi'))
check('manager can revert a delivery', (await rpc('pos_advance_items', { p_staff: owner.id, p_ids: [pizzaLine], p_from: 'delivered', p_to: 'ready', p_manager: true })).ok.length === 1
  && (await one(`select status from public.pos_orders where id = $1`, [o1.order_id])).status === 'open')
await rpc('pos_advance_items', { p_staff: dana.id, p_ids: [pizzaLine], p_from: 'ready', p_to: 'delivered' })

// concurrent completion of the last two lines must still end in 'completed'
const o2 = await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id), line(pizza.point_id, { item_uid: 'i2' })] })
const l2 = (await q(`select id from public.pos_order_items where order_id = $1 order by seq`, [o2.order_id])).map((r) => r.id)
await rpc('pos_advance_items', { p_staff: dana.id, p_ids: l2, p_from: 'sent', p_to: 'ready' })
await Promise.all([
  rpc('pos_advance_items', { p_staff: dana.id, p_ids: [l2[0]], p_from: 'ready', p_to: 'delivered' }),
  rpc('pos_advance_items', { p_staff: yossi.id, p_ids: [l2[1]], p_from: 'ready', p_to: 'delivered' }),
])
check('last two lines delivered at the SAME moment still complete the order (no stale "open")',
  (await one(`select status from public.pos_orders where id = $1`, [o2.order_id])).status === 'completed')

// ============================================================================
section('adding, editing, voiding')
const o3 = await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id, { unit_agorot: 1000 })] })
const add = await rpc('pos_add_items', { p_staff: yossi.id, p_order: o3.order_id, p_lines: [line(pizza.point_id, { item_uid: 'i2', unit_agorot: 3000 })] })
check('add items to an existing order', add.ok === true && add.added === 1 && add.total_agorot === 4000, JSON.stringify(add))
check('added lines are batch 2 and keep their own seq', (await one(`select batch_no, seq from public.pos_order_items where order_id = $1 and point_id = $2`, [o3.order_id, pizza.point_id])).batch_no === 2)
const o3lines = (await q(`select id from public.pos_order_items where order_id = $1 order by seq`, [o3.order_id])).map((r) => r.id)
await rpc('pos_advance_items', { p_staff: dana.id, p_ids: o3lines, p_from: 'sent', p_to: 'ready' })
await rpc('pos_advance_items', { p_staff: dana.id, p_ids: o3lines, p_from: 'ready', p_to: 'delivered' })
check('order is completed…', (await one(`select status from public.pos_orders where id = $1`, [o3.order_id])).status === 'completed')
const add2 = await rpc('pos_add_items', { p_staff: yossi.id, p_order: o3.order_id, p_lines: [line(coffee.point_id, { unit_agorot: 1000 })] })
check('…and adding to a COMPLETED order reopens it', add2.ok && (await one(`select status from public.pos_orders where id = $1`, [o3.order_id])).status === 'open')
const edit = await rpc('pos_edit_order', { p_staff: yossi.id, p_order: o3.order_id, p_customer_name: 'דנה', p_customer_phone: '0501112222', p_note: null, p_receipt_ref: null })
check('edit the customer (typo fix)', edit.ok === true)
const editEv = await one(`select payload from public.pos_events where order_id = $1 and event = 'order_edited'`, [o3.order_id])
check('…audited with old → new name, and the phone NOT copied', editEv.payload.name_changed === true && editEv.payload.previous_name === 'יוסי כהן' && !JSON.stringify(editEv.payload).includes('0501112222'))

const o4 = await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id), line(pizza.point_id, { item_uid: 'i2' })] })
const l4 = (await q(`select id from public.pos_order_items where order_id = $1 order by seq`, [o4.order_id])).map((r) => r.id)
check('void needs a reason', (await rpc('pos_void_items', { p_staff: dana.id, p_order: o4.order_id, p_item_ids: [l4[0]], p_reason: '  ' })).reason === 'bad_reason')
await rpc('pos_advance_items', { p_staff: dana.id, p_ids: [l4[0]], p_from: 'sent', p_to: 'preparing' })
const v1 = await rpc('pos_void_items', { p_staff: dana.id, p_order: o4.order_id, p_item_ids: [l4[0]], p_reason: 'טעות הקלדה' })
check('void one line (it was already being prepared)', v1.ok && v1.voided.length === 1)
const vrow = await one(`select status, voided_from, void_reason, voided_by from public.pos_order_items where id = $1`, [l4[0]])
check('…remembering what state it was in (for the station "ghost")', vrow.status === 'voided' && vrow.voided_from === 'preparing' && vrow.void_reason === 'טעות הקלדה' && vrow.voided_by === dana.id)
check('total drops by the voided line', (await one(`select total_agorot from public.pos_orders where id = $1`, [o4.order_id])).total_agorot === 1500)
check('voiding an already-voided line is a no-op (skipped)', (await rpc('pos_void_items', { p_staff: dana.id, p_order: o4.order_id, p_item_ids: [l4[0]], p_reason: 'x' })).skipped.length === 1)
const v2 = await rpc('pos_void_items', { p_staff: dana.id, p_order: o4.order_id, p_item_ids: null, p_reason: 'הלקוח ביטל' })
check('cancel order (null ids) voids every remaining line', v2.ok && v2.order_status === 'void')
const o4row = await one(`select status, voided_by, void_reason, total_agorot from public.pos_orders where id = $1`, [o4.order_id])
check('order is VOID with who/why, total 0', o4row.status === 'void' && o4row.voided_by === dana.id && o4row.void_reason === 'הלקוח ביטל' && o4row.total_agorot === 0)
check('cannot add items to a void order', (await rpc('pos_add_items', { p_staff: dana.id, p_order: o4.order_id, p_lines: [line(coffee.point_id)] })).reason === 'order_void')
const o5 = await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id)] })
const l5 = (await one(`select id from public.pos_order_items where order_id = $1`, [o5.order_id])).id
await rpc('pos_advance_items', { p_staff: dana.id, p_ids: [l5], p_from: 'sent', p_to: 'ready' })
await rpc('pos_advance_items', { p_staff: dana.id, p_ids: [l5], p_from: 'ready', p_to: 'delivered' })
check('a non-manager cannot void a DELIVERED line', (await rpc('pos_void_items', { p_staff: dana.id, p_order: o5.order_id, p_item_ids: [l5], p_reason: 'x' })).voided.length === 0)
check('a manager can', (await rpc('pos_void_items', { p_staff: owner.id, p_order: o5.order_id, p_item_ids: [l5], p_reason: 'החזר', p_manager: true })).voided.length === 1)

// ============================================================================
section('structured modifiers (015)')
const mod = (kind, label, delta, over = {}) => ({
  group_uid: 'g-' + kind, group: name('קבוצה', 'Group'), kind, option_uid: 'o-' + label,
  label: name(label, label), price_delta_agorot: delta, qty: 1, source: null, ...over,
})
const oat = mod('substitute', 'שיבולת שועל', 200, { source: name('חלב רגיל', 'Regular milk') })
const shot = mod('add', 'שוט נוסף', 300, { qty: 2 })
const noSugar = mod('remove', 'בלי סוכר', 0)
const hot = mod('prep', 'חם מאוד', 0)
const mOrder = await create(crypto.randomUUID(), {
  p_slip_total_agorot: null,
  p_lines: [line(coffee.point_id, { unit_agorot: 2300, base_agorot: 1500, modifiers: [oat, shot, noSugar, hot], for_name: 'שרה', note: 'לא יותר מדי קצף' })],
})
check('a line with structured modifiers is accepted (1500 + 200 + 2×300 = 2300)', mOrder.ok === true && mOrder.total_agorot === 2300, JSON.stringify(mOrder))
const mLine = await one(`select * from public.pos_order_items where order_id = $1`, [mOrder.order_id])
check('the line stores base + final price separately', mLine.base_agorot === 1500 && mLine.unit_agorot === 2300)
check('every selection is snapshotted, with kind, label, delta and qty',
  mLine.modifiers.length === 4 && mLine.modifiers.map((x) => x.kind).join() === 'substitute,add,remove,prep'
  && mLine.modifiers[1].qty === 2 && mLine.modifiers[1].price_delta_agorot === 300)
check('a substitution keeps its SOURCE (milk → oat)', mLine.modifiers[0].source.he === 'חלב רגיל' && mLine.modifiers[0].label.he === 'שיבולת שועל')
check('free-text note and for_name still sit beside the structured data', mLine.note === 'לא יותר מדי קצף' && mLine.for_name === 'שרה')
check('a discount modifier (negative delta) is allowed', (await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id, { unit_agorot: 1400, base_agorot: 1500, modifiers: [mod('choice', 'כוס אישית', -100)] })] })).ok === true)
check('wrong arithmetic is refused (final price ≠ base + modifiers)', (await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id, { unit_agorot: 2000, base_agorot: 1500, modifiers: [oat, shot] })] })).reason === 'bad_line')
check('modifiers without a base price are refused', (await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id, { unit_agorot: 1700, modifiers: [oat] })] })).reason === 'bad_line')
check('an unknown modifier kind is refused', (await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id, { unit_agorot: 1500, base_agorot: 1500, modifiers: [mod('magic', 'x', 0)] })] })).reason === 'bad_line')
check('a modifier with no label is refused', (await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id, { unit_agorot: 1500, base_agorot: 1500, modifiers: [{ ...noSugar, label: {} }] })] })).reason === 'bad_line')
check('a fractional delta is refused', (await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id, { unit_agorot: 1500, base_agorot: 1500, modifiers: [{ ...noSugar, price_delta_agorot: 1.5 }] })] })).reason === 'bad_line')
check('a hand-typed (custom) item cannot carry menu modifiers', (await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id, { is_custom: true, unit_agorot: 1500, base_agorot: 1500, modifiers: [noSugar] })] })).reason === 'bad_line')
check('more than 24 modifiers are refused', (await create(crypto.randomUUID(), { p_lines: [line(coffee.point_id, { unit_agorot: 1500, base_agorot: 1500, modifiers: Array.from({ length: 25 }, (_, i) => mod('prep', 'x' + i, 0)) })] })).reason === 'bad_line')
check('a plain line (no modifiers) still defaults base = final price', (await one(`select base_agorot, unit_agorot, modifiers from public.pos_order_items where order_id = $1 and seq = 1`, [o3.order_id])).base_agorot === 1000)
check('modifiers added with pos_add_items are validated the same way', (await rpc('pos_add_items', { p_staff: dana.id, p_order: mOrder.order_id, p_lines: [line(coffee.point_id, { unit_agorot: 1, base_agorot: 1500, modifiers: [oat] })] })).reason === 'bad_line')
check('…and accepted when the arithmetic holds', (await rpc('pos_add_items', { p_staff: dana.id, p_order: mOrder.order_id, p_lines: [line(coffee.point_id, { unit_agorot: 1700, base_agorot: 1500, modifiers: [oat] })] })).ok === true)
check('the modifier snapshot is immutable', (await refused(`update public.pos_order_items set modifiers = '[]' where id = $1`, [mLine.id])) === true)
check('the base price is immutable', (await refused(`update public.pos_order_items set base_agorot = 1 where id = $1`, [mLine.id])) === true)
check('voiding a modified line keeps its snapshot intact', await (async () => {
  await rpc('pos_void_items', { p_staff: dana.id, p_order: mOrder.order_id, p_item_ids: [mLine.id], p_reason: 'טעות הקלדה' })
  const after = await one(`select modifiers, status from public.pos_order_items where id = $1`, [mLine.id])
  return after.status === 'voided' && after.modifiers.length === 4
})())

// ============================================================================
section('immutability and append-only')
check('cannot change a line\'s price', (await refused(`update public.pos_order_items set unit_agorot = 1 where id = $1`, [coffeeLine])) === true)
check('cannot change a line\'s quantity', (await refused(`update public.pos_order_items set qty = 9 where id = $1`, [coffeeLine])) === true)
check('cannot re-point a line to another selling point', (await refused(`update public.pos_order_items set point_id = $2 where id = $1`, [coffeeLine, pizza.point_id])) === true)
check('cannot reassign who created an order', (await refused(`update public.pos_orders set created_by = $2 where id = $1`, [o1.order_id, yossi.id])) === true)
check('cannot rewrite an audit row', (await refused(`update public.pos_events set payload = '{}' where id = (select min(id) from public.pos_events)`)) === true)
check('cannot delete an audit row', (await refused(`delete from public.pos_events where id = (select min(id) from public.pos_events)`)) === true)

// ============================================================================
section('presence')
check('check in to a point', (await rpc('pos_checkin', { p_staff: dana.id, p_point: pizza.point_id, p_event: 'check_in' })).ok === true)
check('…recorded against the active session', (await one(`select session_id from public.pos_point_checkins order by at desc limit 1`)).session_id === sess.session_id)
check('check-ins are append-only', (await refused(`delete from public.pos_point_checkins`)) === true)
check('bad check-in event refused', (await rpc('pos_checkin', { p_staff: dana.id, p_point: pizza.point_id, p_event: 'lurk' })).reason === 'bad_event')

// ============================================================================
section('closing a session')
const closeBusy = await rpc('pos_close_session', { p_staff: owner.id, p_branch: maor })
check('cannot close while lines are in flight', closeBusy.reason === 'in_flight' && closeBusy.in_flight > 0, JSON.stringify(closeBusy))
for (const st of [['sent', 'preparing'], ['preparing', 'ready']]) {
  const rows = (await q(`select id from public.pos_order_items i where status = $1 and exists (select 1 from public.pos_orders o where o.id = i.order_id and o.session_id = $2)`, [st[0], sess.session_id])).map((r) => r.id)
  if (rows.length) await rpc('pos_advance_items', { p_staff: dana.id, p_ids: rows, p_from: st[0], p_to: st[1] })
}
const closeUncollected = await rpc('pos_close_session', { p_staff: owner.id, p_branch: maor })
check('ready-but-uncollected lines are called out, not silently dropped', closeUncollected.reason === 'uncollected' && closeUncollected.uncollected > 0, JSON.stringify(closeUncollected))
const closed = await rpc('pos_close_session', { p_staff: owner.id, p_branch: maor, p_void_uncollected: true })
check('closing with "void uncollected" succeeds', closed.ok === true && closed.voided_uncollected > 0)
check('…each uncollected line has its own voided audit row with the reason', (await one(`select count(*)::int n from public.pos_events where event = 'item_voided' and payload->>'reason' = 'לא נאסף'`)).n === closed.voided_uncollected)
check('the session is closed', (await one(`select status from public.pos_sessions where id = $1`, [sess.session_id])).status === 'closed')
const afterClose = await create(crypto.randomUUID())
check('after closing, new orders are refused…', afterClose.reason === 'no_session')
check('…but cleanup is never gated: a manager can still revert/void on a closed session', (await rpc('pos_void_items', { p_staff: owner.id, p_order: o1.order_id, p_item_ids: null, p_reason: 'תיקון', p_manager: true })).ok === true)

// ============================================================================
section('training sessions')
const trOrder = await rpc('pos_create_order', {
  p_staff: dana.id, p_branch: ghav, p_client_key: crypto.randomUUID(), p_customer_name: 'אימון', p_customer_phone: null,
  p_receipt_ref: null, p_slip_total_agorot: null, p_note: null,
  p_lines: [line((await one(`select id from public.pos_points where branch_id = $1`, [ghav])).id)],
})
check('orders can be created in a training session', trOrder.ok === true)
const wipe = await rpc('pos_wipe_training', { p_staff: owner.id, p_branch: ghav })
check('wiping training removes its orders', wipe.ok && wipe.orders === 1 && (await one(`select count(*)::int n from public.pos_orders where branch_id = $1`, [ghav])).n === 0)
check('…and leaves a trace that it happened', (await one(`select count(*)::int n from public.pos_events where event = 'training_wiped'`)).n === 1)
check('wiping NEVER touches a live session', (await one(`select count(*)::int n from public.pos_orders where branch_id = $1`, [maor])).n > 0)
check('the append-only guard is back on after a wipe', (await refused(`delete from public.pos_events where id = (select min(id) from public.pos_events)`)) === true)

// ============================================================================
section('retention')
await db.exec(`update public.pos_sessions set ended_at = now() - interval '40 days' where branch_id = '${maor}'`)
const clear1 = await rpc('pos_clear_old_pii', { p_phone_days: 30, p_name_days: 365 })
check('phones are cleared after the retention window', clear1.phones > 0 && (await one(`select count(*)::int n from public.pos_orders where customer_phone is not null`)).n === 0)
check('…names are kept inside their window', (await one(`select count(*)::int n from public.pos_orders where customer_name = 'לקוח'`)).n === 0)
await db.exec(`alter table public.pos_orders disable trigger pos_orders_immutable; update public.pos_orders set created_at = now() - interval '400 days'; alter table public.pos_orders enable trigger pos_orders_immutable; set pos.wiping = 'on'; update public.pos_events set at = now() - interval '400 days'; set pos.wiping = 'off';`)
const clear2 = await rpc('pos_clear_old_pii', { p_phone_days: 30, p_name_days: 365 })
check('names become a placeholder after their window', clear2.names > 0 && (await one(`select count(*)::int n from public.pos_orders where customer_name <> 'לקוח'`)).n === 0)
check('…and the name is scrubbed from the audit payloads too', (await one(`select count(*)::int n from public.pos_events where payload ? 'customer_name'`)).n === 0)

// ============================================================================
section('quick login (016): employee number + 6-digit passcode')
const empNos = (await q(`select employee_no from public.staff order by employee_no`)).map((r) => r.employee_no)
check('every staff row has an employee number, all different', empNos.every((x) => Number.isInteger(x)) && new Set(empNos).size === empNos.length)
check('numbers start small and typeable (>= 101)', Math.min(...empNos) >= 101, String(Math.min(...empNos)))
const newbie = await addStaff('newbie@x.test', 'Newbie')
const newbieNo = (await one(`select employee_no from public.staff where id = $1`, [newbie.id])).employee_no
check('a new staff row is auto-numbered (max + 1)', newbieNo === Math.max(...empNos) + 1, `${newbieNo}`)
check('the owner can renumber someone', (await rpc('pos_set_employee_no', { p_actor: owner.id, p_target: newbie.id, p_no: 4321 })).ok === true)
check('…not to a number already taken', (await rpc('pos_set_employee_no', { p_actor: owner.id, p_target: dana.id, p_no: 4321 })).reason === 'taken')
check('…not to nonsense', (await rpc('pos_set_employee_no', { p_actor: owner.id, p_target: dana.id, p_no: 0 })).reason === 'invalid')
const danaNo = (await one(`select employee_no from public.staff where id = $1`, [dana.id])).employee_no

const weak = ['000000', '111111', '123456', '654321', '456789', '789012', '121212', '123123', '987654']
for (const w of weak) {
  check(`a weak passcode is refused: ${w}`, (await rpc('pos_set_pin', { p_actor: owner.id, p_target: dana.id, p_pin: w })).reason === 'weak')
}
for (const bad of ['12345', '1234567', 'abcdef', '12 345', '', null]) {
  check(`a malformed passcode is refused: ${JSON.stringify(bad)}`, (await rpc('pos_set_pin', { p_actor: owner.id, p_target: dana.id, p_pin: bad })).reason === 'invalid')
}
check('a good passcode is accepted', (await rpc('pos_set_pin', { p_actor: dana.id, p_target: dana.id, p_pin: '482913' })).ok === true)
const pinRow = await one(`select pin_hash, pin_set_at from public.staff where id = $1`, [dana.id])
check('it is stored as a bcrypt HASH, never the code', pinRow.pin_hash.startsWith('$2') && !pinRow.pin_hash.includes('482913') && pinRow.pin_set_at !== null)
check('the passcode appears nowhere in the audit log', (await one(`select count(*)::int n from public.pos_events where payload::text like '%482913%'`)).n === 0)
check('…but the change itself IS logged, by whom, with no secret in it', await (async () => {
  const e = await one(`select actor_handle, payload from public.pos_events where event = 'pin_changed' order by id desc limit 1`)
  return e.actor_handle === 'Dana' && e.payload.by_self === true && e.payload.cleared === false && !JSON.stringify(e.payload).includes('pin')
})())

const ok1 = await rpc('pos_verify_pin', { p_employee_no: danaNo, p_pin: '482913' })
check('the right number + passcode verifies', ok1.ok === true && ok1.staff_id === dana.id && ok1.email === 'dana@x.test' && ok1.handle === 'Dana', JSON.stringify(ok1))
const badPin = await rpc('pos_verify_pin', { p_employee_no: danaNo, p_pin: '482914' })
const noSuch = await rpc('pos_verify_pin', { p_employee_no: 99999, p_pin: '482913' })
check('a wrong passcode fails', badPin.ok === false)
check('…and an unknown employee fails IDENTICALLY (nothing to enumerate)', JSON.stringify(badPin) === JSON.stringify(noSuch) && JSON.stringify(noSuch) === '{"ok":false}')
check('a non-numeric passcode fails', (await rpc('pos_verify_pin', { p_employee_no: danaNo, p_pin: 'abcdef' })).ok === false)
check('someone with no passcode set cannot quick-login', (await rpc('pos_verify_pin', { p_employee_no: (await one(`select employee_no from public.staff where id = $1`, [yossi.id])).employee_no, p_pin: '482913' })).ok === false)
await rpc('pos_set_pin', { p_actor: owner.id, p_target: newbie.id, p_pin: '395726' })
await db.exec(`update public.staff set auth_user_id = null where id = '${newbie.id}'`)
check('someone who has never signed in with Google cannot (no auth user to open a session for)', (await rpc('pos_verify_pin', { p_employee_no: 4321, p_pin: '395726' })).ok === false)
await db.exec(`update public.staff set auth_user_id = '${newbie.authId}' where id = '${newbie.id}'`)
check('…and can once they have', (await rpc('pos_verify_pin', { p_employee_no: 4321, p_pin: '395726' })).ok === true)
await db.exec(`update public.staff set active = false where id = '${newbie.id}'`)
check('a deactivated person cannot quick-login', (await rpc('pos_verify_pin', { p_employee_no: 4321, p_pin: '395726' })).ok === false)
await db.exec(`update public.staff set active = true where id = '${newbie.id}'`)
check('a successful quick login is audited (who, which number) with no passcode', await (async () => {
  const e = await one(`select actor_handle, payload from public.pos_events where event = 'quick_login' order by id desc limit 1`)
  return e && e.payload.employee_no === 4321 && !JSON.stringify(e.payload).includes('395726')
})())
check('a failed attempt writes nothing to the audit log (the rate limiter handles abuse)', await (async () => {
  const before = (await one(`select count(*)::int n from public.pos_events where event = 'quick_login'`)).n
  await rpc('pos_verify_pin', { p_employee_no: danaNo, p_pin: '000001' })
  return (await one(`select count(*)::int n from public.pos_events where event = 'quick_login'`)).n === before
})())

check('changing a passcode ENDS that person\'s quick sessions', await (async () => {
  const sid = crypto.randomUUID()
  await db.query(`insert into public.pos_quick_sessions (session_id, staff_id) values ($1, $2)`, [sid, dana.id])
  await rpc('pos_set_pin', { p_actor: dana.id, p_target: dana.id, p_pin: '571904' })
  return (await one(`select count(*)::int n from public.pos_quick_sessions where session_id = $1`, [sid])).n === 0
})())
check('the OLD passcode stops working after a change', (await rpc('pos_verify_pin', { p_employee_no: danaNo, p_pin: '482913' })).ok === false
  && (await rpc('pos_verify_pin', { p_employee_no: danaNo, p_pin: '571904' })).ok === true)
check('clearing a passcode disables quick login', (await rpc('pos_clear_pin', { p_actor: owner.id, p_target: dana.id })).ok === true
  && (await rpc('pos_verify_pin', { p_employee_no: danaNo, p_pin: '571904' })).ok === false
  && (await one(`select pin_hash from public.staff where id = $1`, [dana.id])).pin_hash === null)
check('…and that is logged as cleared', (await one(`select payload from public.pos_events where event = 'pin_changed' order by id desc limit 1`)).payload.cleared === true)
check('old quick sessions are swept after N days', await (async () => {
  const sid = crypto.randomUUID()
  await db.query(`insert into public.pos_quick_sessions (session_id, staff_id, created_at) values ($1, $2, now() - interval '5 days')`, [sid, yossi.id])
  const n = await rpc('pos_clear_old_quick_sessions', { p_days: 3 })
  return n >= 1 && (await one(`select count(*)::int c from public.pos_quick_sessions where session_id = $1`, [sid])).c === 0
})())
check('quick sessions are invisible to a browser role', await asRole('authenticated', dana.authId, () => refused(`select * from public.pos_quick_sessions`)) === true
  && await asRole('anon', null, () => refused(`select * from public.pos_quick_sessions`)) === true)
check('the passcode hash cannot be read by a browser role (staff grants nothing to it at all)',
  (await asRole('authenticated', dana.authId, () => refused(`select pin_hash from public.staff`))) === true
  && (await asRole('anon', null, () => refused(`select pin_hash from public.staff`))) === true)

// ============================================================================
section('privileges — as the roles a browser would be')
const staffRead = await asRole('authenticated', dana.authId, () => q(`select count(*)::int n from public.pos_orders`))
check('staff can READ orders (realtime + direct reads)', staffRead[0].n > 0)
const custRead = await asRole('authenticated', customer.id, () => q(`select count(*)::int n from public.pos_orders`))
check('a signed-in NON-staff Google user reads nothing', custRead[0].n === 0)
check('anon has no table privilege at all', await asRole('anon', null, () => refused(`select * from public.pos_orders`)) === true)
for (const t of ['pos_orders', 'pos_order_items', 'pos_events', 'pos_points', 'pos_sessions']) {
  check(`staff cannot INSERT into ${t}`, await asRole('authenticated', dana.authId, () => refused(`insert into public.${t} default values`)) === true)
}
check('staff cannot UPDATE an order directly', await asRole('authenticated', dana.authId, () => refused(`update public.pos_orders set status = 'void'`)) === true)
check('staff cannot DELETE an order directly', await asRole('authenticated', dana.authId, () => refused(`delete from public.pos_orders`)) === true)
check('staff cannot read pos_branch_settings (the board token)', await asRole('authenticated', dana.authId, () => refused(`select * from public.pos_branch_settings`)) === true)
check('staff cannot read the ticket counters', await asRole('authenticated', dana.authId, () => refused(`select * from public.pos_ticket_counters`)) === true)
for (const fn of ['pos_create_order', 'pos_advance_items', 'pos_void_items', 'pos_save_point', 'pos_wipe_training', 'pos_open_session', 'pos_set_handle', 'pos_log_event', 'pos_clear_old_pii', 'pos_set_pin', 'pos_clear_pin', 'pos_verify_pin', 'pos_set_employee_no', 'pos_clear_old_quick_sessions']) {
  const procs = await q(`select p.oid::regprocedure::text sig from pg_proc p where p.proname = $1`, [fn])
  const ok = procs.length > 0 && await (async () => {
    for (const p of procs) {
      const r = await one(`select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') b, has_function_privilege('public', $1, 'execute') c, has_function_privilege('service_role', $1, 'execute') d`, [p.sig])
      if (r.a || r.b || r.c || !r.d) return false
    }
    return true
  })()
  check(`${fn}() is executable by service_role ONLY`, ok)
}
const dirStaff = await asRole('authenticated', dana.authId, () => q(`select * from public.pos_staff_directory`))
check('staff directory exposes id/handle/colour only', dirStaff.length >= 3 && Object.keys(dirStaff[0]).sort().join() === 'colour,handle,id')
const dirCust = await asRole('authenticated', customer.id, () => q(`select * from public.pos_staff_directory`))
check('…and returns NOTHING to a non-staff Google user', dirCust.length === 0)
check('…and cannot be written through', await asRole('authenticated', dana.authId, () => refused(`update public.pos_staff_directory set handle = 'hacked'`)) === true)
check('the directory is not readable by anon', await asRole('anon', null, () => refused(`select * from public.pos_staff_directory`)) === true)
check('realtime publication carries the POS tables',
  (await q(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'pos\\_%'`)).length === 6)

// ============================================================================
section('every function the app calls by name can be executed by whoever calls it')
// 005 revoked create_branch_with_menu from PUBLIC on the belief that "service-role bypasses grants
// entirely". It bypasses RLS, not EXECUTE: on a real project that left the function callable by
// nobody, and the owner's "add branch" and the POS "create event" both failed. The list is DERIVED
// from the source tree (a hand-kept copy would drift the first time someone adds an .rpc call).
const USER_SESSION_RPCS = new Set(['claim_staff_invite']) // called with the signed-in person's own session, not the server key
const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url))
const walkSrc = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkSrc(`${d}${e.name}/`) : /\.tsx?$/.test(e.name) ? [`${d}${e.name}`] : []))
const calledRpcs = new Set()
for (const f of walkSrc(SRC_DIR)) {
  for (const m of readFileSync(f, 'utf8').matchAll(/(?:\.rpc|callPosRpc)(?:<[^()]*>)?\(\s*['"]([a-z_0-9]+)['"]/g)) calledRpcs.add(m[1])
}
check('the source tree was scanned for rpc calls', calledRpcs.size >= 30, `${calledRpcs.size} found`)
for (const fn of [...calledRpcs].sort()) {
  const who = USER_SESSION_RPCS.has(fn) ? 'authenticated' : 'service_role'
  const procs = await q(`select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn])
  const reachable = procs.length > 0 && (await Promise.all(procs.map((p) => one(`select has_function_privilege($1, $2, 'execute') ok`, [who, p.sig])))).every((r) => r.ok)
  check(`${fn}() exists and ${who} may execute it`, reachable)
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
