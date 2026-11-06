// Kiosk suite, stage 3 — the kiosk's APIs against the running app (the same production build the dashboard suite uses, against the
// stand-in Supabase): the tablet's own calls with its key, and the owner's remote control of it (docs/SARCAFE_KIOSK_REMOTE.md).
import { createStage, assert } from '../lib/harness.mjs'
import { ID } from '../standin/seed.mjs'
import { SECRETS } from '../live/app.mjs'
import { pbkdf2Sync } from 'node:crypto'

const KEY = SECRETS.KIOSK_SIGNUP_KEY
const LEAK = /stack|at \/|node_modules|PGRST|relation |select |postgres/i
const matches = (record, pin) => {
  const [, it, salt, hash] = record.split('$')
  return pbkdf2Sync(pin, Buffer.from(salt, 'hex'), Number(it), 32, 'sha1').toString('hex') === hash
}

export function kioskApiStage(live) {
  const stage = createStage('kiosk-api', 'הקיוסק: ה־API של הטאבלט ושליטה מרחוק מלוח הבקרה')
  const tablet = (path, { method = 'POST', body, key = KEY, type = 'application/json', raw } = {}) => live().call(path, {
    method, body: raw ?? body, headers: { ...(key ? { 'x-kiosk-key': key } : {}), ...(type ? { 'content-type': type } : {}) },
  })
  const act = (as, body, origin = true) => live().call('/api/owner/kiosk/devices/actions', { method: 'POST', as, origin, body })
  const device = () => live().db('kiosk_devices').find((d) => d.slug === 'givat-haviva-1')
  const fresh = () => { live().standin.state.limits.clear(); const d = device(); d.pending_command = null; live().db('kiosk_pin_resets').length = 0 }

  stage.test('report-key', 'הדיווח של הטאבלט: בלי מפתח או עם מפתח שגוי — 401; סוג תוכן שגוי, גוף גדול או לא תקין — נדחה; תקין — נרשם', 'security', async () => {
    fresh()
    assert.status(await tablet('/api/kiosk/device', { key: null, body: {} }), 401, 'no key')
    assert.status(await tablet('/api/kiosk/device', { key: 'wrong-key-0000000000', body: {} }), 401, 'wrong key')
    assert.status(await tablet('/api/kiosk/device', { type: 'text/plain', raw: '{}' }), 415, 'not JSON')
    assert.status(await tablet('/api/kiosk/device', { raw: '{"a":"' + 'x'.repeat(6000) + '"}' }), 413, 'too large')
    assert.status(await tablet('/api/kiosk/device', { raw: '{nope' }), 400, 'broken JSON')
    assert.status(await tablet('/api/kiosk/device', { body: { device: 'givat-haviva-1', extra: 1 } }), 400, 'an unknown field')
    assert.status(await tablet('/api/kiosk/device', { body: { device: 'givat-haviva-1', battery: { level: 140 } } }), 400, 'a charge over 100%')
    const ok = await tablet('/api/kiosk/device', { body: { device: 'givat-haviva-1', battery: { level: 63, charging: false }, app: 3, web: 'abc1234' } })
    assert.status(ok, 200, 'a good report')
    assert.equal(device().battery_level, 63, 'recorded')
    assert.equal(device().app_version, 3)
    assert.status(await tablet('/api/kiosk/device', { body: { device: 'no-such-tablet' } }), 404, 'an unknown tablet')
  })

  stage.test('settings-own', 'הטאבלט שומר רק את ההגדרות שלו, בתוך הגבולות; לא את הסניף, השם או המפתח', 'security', async () => {
    fresh()
    assert.status(await tablet('/api/kiosk/device', { method: 'PUT', body: { device: 'givat-haviva-1', patch: { timing: { idleSeconds: 9999 } } } }), 400, 'out of bounds')
    assert.status(await tablet('/api/kiosk/device', { method: 'PUT', body: { device: 'givat-haviva-1', branchId: ID.maor, patch: {} } }), 400, 'the branch is the owner\'s')
    assert.status(await tablet('/api/kiosk/device', { method: 'PUT', body: { device: 'givat-haviva-1', patch: { secret: { x: 1 } } } }), 400, 'an unknown section')
    const ok = await tablet('/api/kiosk/device', { method: 'PUT', body: { device: 'givat-haviva-1', patch: { ads: { autoPlay: false } } } })
    assert.status(ok, 200, 'a good save')
    assert.equal(device().settings.ads.autoPlay, false, 'stored')
    assert.equal(device().branch_id, ID.gh, 'the branch did not move')
  })

  stage.test('commands', 'פקודה מלוח הבקרה: מגיעה לטאבלט עם הדיווח, נשארת עד שהוא מאשר אותה, ומתנקה רק עם המזהה שלה', 'e2e', async () => {
    fresh()
    assert.status(await act('owner', { action: 'command', slug: 'givat-haviva-1', kind: 'reload' }), 200, 'the owner sends a reload')
    const sent = device().pending_command
    assert.ok(sent?.id && sent.kind === 'reload', 'stored on the tablet')
    const first = await tablet('/api/kiosk/device', { body: { device: 'givat-haviva-1' } })
    assert.equal(first.json?.command?.id, sent.id, 'handed over with the report')
    const again = await tablet('/api/kiosk/device', { body: { device: 'givat-haviva-1', commandDone: '00000000-0000-4000-8000-000000000000' } })
    assert.equal(again.json?.command?.id, sent.id, 'another id does not clear it')
    const done = await tablet('/api/kiosk/device', { body: { device: 'givat-haviva-1', commandDone: sent.id } })
    assert.status(done, 200)
    assert.equal(done.json?.command, undefined, 'cleared once done')
    assert.equal(device().pending_command, null)
    assert.status(await act('owner', { action: 'command', slug: 'givat-haviva-1', kind: 'format_disk' }), 400, 'an unknown command')
    assert.status(await act('owner', { action: 'command', slug: 'givat-haviva-1', kind: 'check_updates' }), 200)
    assert.status(await act('owner', { action: 'cancel_command', slug: 'givat-haviva-1' }), 200, 'cancel')
    assert.equal(device().pending_command, null, 'cancelled')
  })

  stage.test('pin-roundtrip', 'איפוס קוד מלוח הבקרה: נשמרת רק "טביעה", הטאבלט מושך אותה עם המפתח, מאשר, והיא נמחקת', 'security', async () => {
    fresh()
    assert.status(await tablet('/api/kiosk/device/pin?device=givat-haviva-1', { method: 'GET', key: null, type: null }), 401, 'no key')
    const none = await tablet('/api/kiosk/device/pin?device=givat-haviva-1', { method: 'GET', type: null })
    assert.status(none, 200)
    assert.equal(none.json?.reset, null, 'nothing waiting')
    const set = await act('owner', { action: 'pin', slug: 'givat-haviva-1', pin: '583917', confirm: '583917' })
    assert.status(set, 200, 'the owner sets a PIN')
    assert.ok(!JSON.stringify(set.json).includes('583917') && !JSON.stringify(set.json).includes('pbkdf2'), 'the answer carries neither the PIN nor its record')
    const stored = live().db('kiosk_pin_resets')[0]
    assert.ok(stored && !JSON.stringify(stored).includes('583917'), 'the PIN itself is not stored')
    assert.ok(/^pbkdf2\$15000\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(stored.record), 'stored as the app\'s own record format')
    const got = await tablet('/api/kiosk/device/pin?device=givat-haviva-1', { method: 'GET', type: null })
    assert.status(got, 200)
    assert.ok(matches(got.json.reset.record, '583917') && !matches(got.json.reset.record, '583918'), 'the record opens with that PIN only')
    assert.ok(stored.delivered_at, 'marked delivered')
    assert.equal(got.headers.get('cache-control'), 'no-store')
    assert.status(await tablet('/api/kiosk/device/pin', { body: { device: 'givat-haviva-1', id: '00000000-0000-4000-8000-000000000000' } }), 404, 'a wrong id is not confirmed')
    assert.status(await tablet('/api/kiosk/device/pin', { body: { device: 'givat-haviva-1', id: got.json.reset.id } }), 200, 'confirmed')
    assert.equal(live().db('kiosk_pin_resets').length, 0, 'deleted after the tablet took it')
    assert.ok(device().pin_reset_applied_at, 'the tablet\'s row says when')
    assert.equal((await tablet('/api/kiosk/device/pin?device=givat-haviva-1', { method: 'GET', type: null })).json?.reset, null, 'nothing waiting any more')
  })

  stage.test('pin-rules', 'קוד חדש: 6–8 ספרות, לא רצף ולא ספרה חוזרת, שני הקודים זהים; בעלים בלבד, מאותו אתר; 5 בשעה', 'security', async () => {
    fresh()
    for (const [pin, why] of [['12345', 'too short'], ['123456789', 'too long'], ['12a456', 'not digits'], ['111111', 'one digit'], ['123456', 'ascending'], ['987654', 'descending'], ['890123', 'ascending round']]) {
      assert.status(await act('owner', { action: 'pin', slug: 'givat-haviva-1', pin, confirm: pin }), 400, `${pin}: ${why}`)
    }
    assert.status(await act('owner', { action: 'pin', slug: 'givat-haviva-1', pin: '583917', confirm: '583918' }), 400, 'the two do not match')
    assert.status(await act(null, { action: 'pin', slug: 'givat-haviva-1', pin: '583917', confirm: '583917' }), 401, 'signed out')
    assert.status(await act('dana', { action: 'pin', slug: 'givat-haviva-1', pin: '583917', confirm: '583917' }), 403, 'an employee')
    assert.status(await act('gm', { action: 'pin', slug: 'givat-haviva-1', pin: '583917', confirm: '583917' }), 403, 'a general manager')
    assert.status(await act('owner', { action: 'pin', slug: 'givat-haviva-1', pin: '583917', confirm: '583917' }, 'https://evil.example'), 403, 'from another site')
    assert.status(await act('owner', { action: 'pin', slug: 'no-such-tablet', pin: '583917', confirm: '583917' }), 404, 'an unknown tablet')
    for (let i = 0; i < 5; i++) assert.status(await act('owner', { action: 'pin', slug: 'givat-haviva-1', pin: `58391${i}`.padEnd(6, '7'), confirm: `58391${i}`.padEnd(6, '7') }), 200, `reset ${i + 1}`)
    assert.status(await act('owner', { action: 'pin', slug: 'givat-haviva-1', pin: '583917', confirm: '583917' }), 429, 'the sixth in an hour')
    assert.equal(live().db('kiosk_pin_resets').length, 1, 'one waiting at a time (the newest)')
    assert.status(await act('owner', { action: 'cancel_pin', slug: 'givat-haviva-1' }), 200)
    assert.equal(live().db('kiosk_pin_resets').length, 0, 'cancelled')
  })

  stage.test('owner-settings', 'הבעלים משנה כל הגדרה של הטאבלט מלוח הבקרה, בתוך הגבולות, וכלל צולב נאכף', 'e2e', async () => {
    fresh()
    const patch = (as, settings, origin = true) => live().call('/api/owner/kiosk/devices', { method: 'PATCH', as, origin, body: { slug: 'givat-haviva-1', settings } })
    assert.status(await patch('owner', { display: { showCredit: false }, battery: { alertPercent: 40 } }), 200, 'two sections at once')
    assert.equal(device().settings.display.showCredit, false)
    assert.equal(device().settings.battery.alertPercent, 40)
    assert.status(await patch('owner', { battery: { alertPercent: 95 } }), 400, 'out of bounds')
    assert.status(await patch('owner', { language: { enabled: ['en'], default: 'he' } }), 400, 'the default language must be on')
    assert.status(await patch('dana', { display: { showCredit: true } }), 403, 'an employee')
  })

  // live stock from the tablet's panel (src/app/api/kiosk/stock): the dashboard's live list, its rules, the tablet's own branch only
  const menu = () => live().db('menus').find((m) => m.slug === 'givat-haviva')
  const find = (doc, item, type) => { for (const c of doc.categories) for (const i of c.items) if (i.uid === item) return type ? i.types.find((t) => t.uid === type) : i; return null }
  const hours = (open) => { const s = live().db('shift_settings').find((x) => x.branch_id === ID.gh); Object.assign(s, open ? { working_days: [0, 1, 2, 3, 4, 5, 6], open_time: '00:00', close_time: '23:59', day_hours: {} } : { working_days: [], open_time: '07:00', close_time: '19:00', day_hours: {} }) }
  const freshMenu = (seedMenus) => { const m = menu(); const s = seedMenus.find((x) => x.slug === 'givat-haviva'); m.draft = structuredClone(s.draft); m.published = structuredClone(s.published); live().db('menu_audit').length = 0 }

  stage.test('stock-list', 'מלאי מהקיוסק: רק עם המפתח; מציג בדיוק את הקטגוריות של המלאי החי בלוח הבקרה (כריכים, מאפים, שייקים), עם כל הסוגים', 'security', async () => {
    fresh(); hours(true)
    const { seed } = await import('../standin/seed.mjs'); freshMenu(seed().menus)
    assert.status(await tablet('/api/kiosk/stock?device=givat-haviva-1', { method: 'GET', key: null, type: null }), 401, 'no key')
    assert.status(await tablet('/api/kiosk/stock?device=givat-haviva-1', { method: 'GET', key: 'wrong-key-0000000000', type: null }), 401, 'wrong key')
    assert.status(await tablet('/api/kiosk/stock?device=..%2Fx', { method: 'GET', type: null }), 400, 'bad tablet name')
    assert.status(await tablet('/api/kiosk/stock?device=nobody-9', { method: 'GET', type: null }), 404, 'unknown tablet')
    const r = await tablet('/api/kiosk/stock?device=givat-haviva-1', { method: 'GET', type: null })
    assert.status(r, 200, 'the list')
    assert.equal(r.headers.get('cache-control'), 'no-store')
    const data = await r.json()
    assert.equal(data.open, true)
    assert.deepEqual(data.categories.map((c) => c.name), ['כריכים וטוסטים', 'מאפים', 'שייק פירות טבעי'], 'the live categories only, in menu order (no coffee)')
    const toasts = data.categories[0].items.find((i) => i.uid === 'toasts')
    assert.deepEqual(toasts.types.map((t) => [t.name, t.available]), [['קפרזה', true], ["מוצרלה וצ'דר", false]], 'types with their state')
    assert.equal(data.categories[1].items[0].types[1].quantity, 3, 'counts come along')
  })

  stage.test('stock-write', 'עדכון מלאי מהקיוסק: נכנס לטיוטה ולתפריט שמוצג ללקוחות מיד, כמות 0 = אזל, ונרשם ביומן "מהקיוסק"', 'e2e', async () => {
    fresh(); hours(true)
    const { seed } = await import('../standin/seed.mjs'); freshMenu(seed().menus)
    const set = (body) => tablet('/api/kiosk/stock', { body: { device: 'givat-haviva-1', ...body } })
    let r = await set({ itemUid: 'pastry', typeUid: 'pastry-cinnamon', quantity: 2 })
    assert.status(r, 200, 'count down')
    assert.equal(find(menu().draft, 'pastry', 'pastry-cinnamon').quantity, 2, 'draft')
    assert.equal(find(menu().published, 'pastry', 'pastry-cinnamon').quantity, 2, 'published: customers see it at once')
    const back = await r.json()
    assert.equal(back.categories[1].items[0].types[1].quantity, 2, 'the answer is the new list')
    assert.status(await set({ itemUid: 'pastry', typeUid: 'pastry-cheese', quantity: 0 }), 200, 'last one sold')
    assert.equal(find(menu().published, 'pastry', 'pastry-cheese').available, false, 'a count of 0 is sold out')
    assert.status(await set({ itemUid: 'toasts', typeUid: 'toast-cheddar', available: true }), 200, 'back in stock')
    assert.equal(find(menu().published, 'toasts', 'toast-cheddar').available, true)
    assert.status(await set({ itemUid: 'sandwiches', quantity: 7 }), 200, 'an item without types')
    assert.equal(find(menu().published, 'sandwiches').quantity, 7)
    const log = live().db('menu_audit')
    assert.equal(log.length, 4, 'every change in the menu log')
    assert.ok(log.every((x) => /מהקיוסק/.test(x.summary) && x.action === 'menu.availability'), 'marked as from the kiosk')
    assert.ok(log.some((x) => /דניש קינמון — 2/.test(x.summary)), 'with what and how many')
  })

  stage.test('stock-rules', 'מלאי מהקיוסק — כללי לוח הבקרה: רק בשעות הפעילות, רק פריטים של המלאי החי, רק עם המפתח, קלט לא תקין נדחה', 'security', async () => {
    fresh(); hours(true)
    const { seed } = await import('../standin/seed.mjs'); freshMenu(seed().menus)
    const set = (body, opts = {}) => tablet('/api/kiosk/stock', { body: { device: 'givat-haviva-1', ...body }, ...opts })
    assert.status(await set({ itemUid: 'shake', typeUid: 'shake-banana', available: false }, { key: null }), 401, 'no key')
    assert.status(await set({ itemUid: 'coffee-1', available: false }), 404, 'coffee is not on the live list: the kiosk cannot touch it')
    assert.equal(find(menu().published, 'coffee-1').available, undefined, 'untouched')
    assert.status(await set({ itemUid: 'shake', typeUid: 'nope', available: false }), 404, 'unknown type')
    assert.status(await set({ itemUid: 'shake', typeUid: 'shake-banana' }), 400, 'nothing to change')
    assert.status(await set({ itemUid: 'shake', typeUid: 'shake-banana', quantity: -1 }), 400, 'negative count')
    assert.status(await set({ itemUid: 'shake', typeUid: 'shake-banana', quantity: 1.5 }), 400, 'a fraction')
    assert.status(await set({ itemUid: 'shake', typeUid: 'shake-banana', available: false, branch: 'maor' }), 400, 'no other fields (another branch)')
    assert.status(await set({ itemUid: "x'; drop table menus;--", available: false }), 400, 'odd ids refused')
    assert.status(await tablet('/api/kiosk/stock', { type: 'text/plain', raw: '{}' }), 415, 'not JSON')
    hours(false)
    const closed = await set({ itemUid: 'shake', typeUid: 'shake-banana', available: false })
    assert.status(closed, 403, 'closed: no live stock (the dashboard rule for anyone but the owner)')
    assert.equal(find(menu().published, 'shake', 'shake-banana').available, undefined, 'nothing changed while closed')
    const list = await (await tablet('/api/kiosk/stock?device=givat-haviva-1', { method: 'GET', type: null })).json()
    assert.equal(list.open, false, 'the list says closed, so the panel can say so')
    hours(true)
    live().standin.state.limits.clear()
    live().standin.state.limits.set('kiosk-stock:givat-haviva-1', Array.from({ length: 240 }, () => Date.now())) // 240 changes in 10 minutes
    assert.status(await set({ itemUid: 'shake', typeUid: 'shake-banana', available: false }), 429, 'a flood is limited')
    live().standin.state.limits.clear()
  })

  stage.test('outage', 'מסד הנתונים לא עונה: ה־API של הקיוסק עונה בשגיאה מסודרת בלי פרטים פנימיים, וחוזר לעבוד', 'survival', async () => {
    fresh()
    await live().control('/__qa/fault', { mode: 'down' })
    try {
      for (const [path, opts] of [['/api/kiosk/device', { body: { device: 'givat-haviva-1' } }], ['/api/kiosk/device/pin?device=givat-haviva-1', { method: 'GET', type: null }]]) {
        const r = await tablet(path, opts)
        assert.ok(r.status >= 500, `${path} → ${r.status}`)
        assert.notMatch(r.text, LEAK, `${path} leaks`)
      }
      const owner = await act('owner', { action: 'command', slug: 'givat-haviva-1', kind: 'reload' })
      assert.ok(owner.status >= 500, `the owner's action → ${owner.status} (never "sign in")`)
    } finally { await live().control('/__qa/fault', { mode: 'none' }) }
    assert.status(await tablet('/api/kiosk/device', { body: { device: 'givat-haviva-1' } }), 200, 'back after the outage')
  })

  return stage
}
