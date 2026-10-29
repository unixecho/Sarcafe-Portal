#!/usr/bin/env node
/*
 * Checks the kiosk's privacy reset (overrides/kiosk-session.js) and its welcome screen with announcements
 * (overrides/kiosk-attract.js) on the page exactly as the app packages it (scripts/assemble-kiosk-bundle.mjs),
 * in headless Edge/Chromium at the tablet's sizes (600x1000 portrait, 1000x600 landscape).
 *
 *   node scripts/check-kiosk-session.mjs            (KIOSK_SHOTS=<dir> also saves screenshots there)
 *
 * A local mock stands in for the portal (content, menu, sign-up). Durations run at ?kioskTestScale=0.1, so the
 * 60 s / 10 s of the kiosk are 3 s / 1 s here (the mock content sets idle 30 s). Nothing touches production.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { assemble, LAYERS } from './assemble-kiosk-bundle.mjs';

const require = createRequire(import.meta.url);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const overrides = join(repo, 'prototypes', 'sarcafe-kiosk-app', 'overrides');
const SCALE = 0.1;
const SHOTS = process.env.KIOSK_SHOTS ? resolve(process.env.KIOSK_SHOTS) : '';
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));

let passed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) passed += 1;
  else { failures.push(`${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); console.log(`  FAIL ${name}`, detail ?? ''); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- static checks --------------------------------------------------------------------------------------------
const read = (f) => readFileSync(f, 'utf8');
const attractJs = read(join(overrides, 'kiosk-attract.js'));
const sessionJs = read(join(overrides, 'kiosk-session.js'));
const buildPs1 = read(join(repo, 'prototypes', 'sarcafe-kiosk-app', 'build.ps1'));
check('static: kiosk-attract.js never uses innerHTML / insertAdjacentHTML / outerHTML', !/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(attractJs));
const sessionHtml = sessionJs.match(/innerHTML\s*=\s*`([\s\S]*?)`/g) || [];
check('static: kiosk-session.js innerHTML is one fixed template with no interpolation', sessionHtml.length === 1 && !sessionHtml[0].includes('${'));
check('static: old kiosk-idle.js is gone', !existsSync(join(overrides, 'kiosk-idle.js')));
check('static: build.ps1 uses the shared assembly and no longer injects kiosk-idle.js', buildPs1.includes('assemble-kiosk-bundle.mjs') && !buildPs1.includes('kiosk-idle'));
check('static: the session controller loads before every layer that registers with it',
  LAYERS.body.indexOf('kiosk-session.js') >= 0 && ['kiosk-legal.js', 'kiosk-attract.js', 'kiosk-signup.js', 'kiosk-sync.js', 'kiosk-ready.js']
    .every((f) => LAYERS.body.indexOf(f) > LAYERS.body.indexOf('kiosk-session.js')) && LAYERS.body.at(-1) === 'kiosk-ready.js');
for (const file of ['kiosk-attract.css', 'kiosk-app.css']) {
  const css = read(join(overrides, file));
  check(`static: ${file} has nothing WebView 97 lacks or the tablet cannot afford`, !/color-mix\(|:has\(|@container|backdrop-filter|filter:\s*blur/.test(css));
}
const oneTimer = (sessionJs.match(/idleTimer = setTimeout/g) || []).length >= 1 && !/setTimeout\(onIdle|LIMIT_SECONDS/.test(sessionJs);
check('static: one inactivity timer and one grace timer in the session controller', oneTimer && (sessionJs.match(/graceTimer = setTimeout/g) || []).length >= 1);
{
  const QR = require('qrcode');
  const q = QR.create('https://sarcafe-portal.vercel.app/feedback', { errorCorrectionLevel: 'M' });
  const rows = [];
  for (let r = 0; r < q.modules.size; r += 1) { let s = ''; for (let c = 0; c < q.modules.size; c += 1) s += q.modules.get(r, c) ? '1' : '0'; rows.push(s); }
  const embedded = JSON.parse(attractJs.match(/const FEEDBACK_QR = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  check('static: built-in feedback QR matches a fresh encoding of the feedback URL', JSON.stringify(rows) === JSON.stringify(embedded));
}

// ---- the packaged page + a mock portal --------------------------------------------------------------------------
const work = mkdtempSync(join(tmpdir(), 'sarcafe-kiosk-check-'));
const assets = join(work, 'assets');
assemble(assets);
const assets2 = join(work, 'again');
assemble(assets2);
check('bundle: assembling twice gives identical bytes', ['index.html', 'device-check.html', 'kiosk-session.js'].every((f) => read(join(assets, f)) === read(join(assets2, f))));
const indexHtml = read(join(assets, 'index.html'));
check('bundle: no Google Fonts and no ../../public paths', !/fonts\.g(oogleapis|static)\.com|\.\.\/\.\.\/public/.test(indexHtml));
check('bundle: no kiosk-idle.js', !indexHtml.includes('kiosk-idle') && !existsSync(join(assets, 'kiosk-idle.js')));

const zoneDate = (offsetDays) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 86400000));
const MOCK_CONTENT = {
  version: 'test-v1',
  settings: { idleSeconds: 30, graceSeconds: 10, slideSeconds: 10 },
  ads: [
    { id: 'loc', kind: 'location', title: 'סניף האם במאור', body: 'בואו לבקר את סניף האם שלנו במאור באווירת מושב חמה בימי ראשון עד שישי', action: 'none', qr: null, imageUrl: null },
    { id: 'fb', kind: 'feedback', title: 'משוב', body: 'סרקו את קוד ה-QR', action: 'none', qr: { url: 'https://sarcafe-portal.vercel.app/feedback', modules: JSON.parse(attractJs.match(/const FEEDBACK_QR = (\[[^\]]+\])/)[1].replace(/'/g, '"')) }, imageUrl: null },
    { id: 'club', kind: 'loyalty', title: 'מועדון', body: 'מעוניינים במועדון לקוחות עם צבירת נקודות ואירועים? הירשמו בלחיצה על המסך', action: 'join', qr: null, imageUrl: null },
    { id: 'hrs', kind: 'hours', title: 'שעות הפתיחה', body: '', action: 'none', qr: null, imageUrl: null },
    { id: 'hl', kind: 'menu_highlight', title: 'כדאי לטעום', body: '', action: 'menu', qr: null, imageUrl: null },
    { id: 'xss', kind: 'custom', title: '<img src=x onerror="window.__xss=1">', body: '<b>bold</b><script>window.__xss=2</script>', action: 'none', qr: null, imageUrl: 'javascript:window.__xss=3' },
    { id: 'evil', kind: 'popup', title: 'dropped', body: '', action: 'none', qr: null, imageUrl: null },
    { id: 'badqr', kind: 'custom', title: 'bad qr', body: '', action: 'none', qr: { url: 'x', modules: ['0101'] }, imageUrl: null },
  ],
  hours: {
    timezone: 'Asia/Jerusalem',
    week: [0, 1, 2, 3, 4, 5].map((day) => ({ day, open: '07:00', close: '15:00' })).concat([{ day: 6, open: null, close: null }]),
    exceptions: [{ date: zoneDate(1), closed: true, open: null, close: null, note: 'סגור לרגל חג' }],
  },
  highlights: [{ name: 'שייק פירות', price: 25, note: null }],
};

const mock = { content: 'ok', contentHits: 0, signupDelay: 0, signupStatus: 200, signups: [] };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/api/kiosk/content') {
    mock.contentHits += 1;
    if (mock.content === 'fail') return json(500, { error: 'down' });
    if (url.searchParams.get('since') === MOCK_CONTENT.version) return json(200, { unchanged: true });
    return json(200, MOCK_CONTENT);
  }
  if (url.pathname === '/api/kiosk/menu') return json(200, { unchanged: true });
  if (url.pathname === '/api/kiosk/waitlist' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const entry = { at: Date.now(), answeredAt: 0, body: JSON.parse(body || '{}') };
      mock.signups.push(entry);
      setTimeout(() => { entry.answeredAt = Date.now(); json(mock.signupStatus, { ok: mock.signupStatus === 200 }); }, mock.signupDelay);
    });
    return undefined;
  }
  const file = join(assets, decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html');
  if (!file.startsWith(assets) || !existsSync(file)) { res.writeHead(404); res.end(); return undefined; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
  return undefined;
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, ...(EDGE ? { executablePath: EDGE } : {}) });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// what the Android app gives the page: its config bridge and the "ready" hook; plus monitors used by the checks
const initScript = (api) => {
  window.SarcafeKiosk = { config: () => JSON.stringify({ api, signupKey: 'test-key', perf: 'full' }) };
  window.__ready = [];
  window.KioskNative = { ready: (v) => window.__ready.push(v) };
  window.__screens = [];
  window.__attractWithData = 0;
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(() => window.__screens.push(document.body.dataset.screen)).observe(document.body, { attributes: true, attributeFilter: ['data-screen'] });
  });
  window.addEventListener('load', () => {
    window.KioskSession.onChange((state) => {
      window.__states = (window.__states || []).concat([[state, Date.now()]]);
      if (state === 'ATTRACT') {
        const filled = [...document.querySelectorAll('.kiosk-screen input')].some((i) => (i.type === 'checkbox' ? i.checked : i.value !== ''));
        const filledText = document.querySelector('[data-phone-summary]')?.textContent !== '—';
        if (filled || filledText) window.__attractWithData += 1;
      }
    });
  });
};

async function openPage(viewport, { content = 'ok' } = {}) {
  mock.content = content;
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: false, locale: 'he-IL' });
  await context.addInitScript(initScript, `${base}/api/kiosk/menu`);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/index.html?kioskTestScale=${SCALE}`);
  await page.waitForFunction(() => window.KioskSession && window.__kioskAttract);
  return { context, page, errors };
}

const state = (page) => page.evaluate(() => window.KioskSession.state);
const screenName = (page) => page.evaluate(() => document.body.dataset.screen);
const waitState = (page, s, timeout = 8000) => page.waitForFunction((x) => window.KioskSession.state === x, s, { timeout });
const activeAd = (page) => page.evaluate(() => document.querySelector('.attract-ad.is-active')?.dataset.kind || null);
async function waitAd(page, kind) {
  await page.waitForFunction((k) => document.querySelector('.attract-ad.is-active')?.dataset.kind === k, kind, { timeout: 15000 });
}
// a still of each slide, without the crossfade in the picture
async function shotOf(page, kinds, label, prefix) {
  await page.evaluate(() => document.querySelector('.attract').classList.add('is-instant'));
  for (const kind of kinds) {
    await waitAd(page, kind);
    await page.screenshot({ path: join(SHOTS, `${prefix}-${kind}-${label}.png`) });
  }
  await page.evaluate(() => document.querySelector('.attract').classList.remove('is-instant'));
}
async function resetToAttract(page) {
  await page.evaluate(() => window.KioskSession.resetNow('check'));
  await waitState(page, 'ATTRACT');
}
async function phoneToConsent(page, digits = '0501234567') {
  for (const d of digits) await page.click(`.numpad [data-key="${d}"]`);
  await page.click('.quick-submit');
  await page.waitForFunction(() => document.body.dataset.screen === 'consent');
}
async function fillConsent(page) {
  await page.fill('.consent-form [name="firstName"]', 'בודק');
  await page.fill('.consent-form [name="email"]', 'test@example.com');
  await page.check('.consent-form [name="privacy"]');
  await page.check('.consent-form [name="marketing"]');
}
const formSnapshot = (page) => page.evaluate(() => ({
  phone: document.getElementById('quick-phone').value,
  name: document.querySelector('.consent-form [name="firstName"]').value,
  email: document.querySelector('.consent-form [name="email"]').value,
  privacy: document.querySelector('.consent-form [name="privacy"]').checked,
  marketing: document.querySelector('.consent-form [name="marketing"]').checked,
  summary: document.querySelector('[data-phone-summary]').textContent,
  messages: [...document.querySelectorAll('.quick-message, .consent-message')].map((m) => m.textContent).join(''),
  anyInput: [...document.querySelectorAll('.kiosk-screen input')].filter((i) => (i.type === 'checkbox' ? i.checked : i.value)).length,
  focused: document.activeElement === document.body || document.activeElement === null,
}));
const isClean = (f) => !f.phone && !f.name && !f.email && !f.privacy && !f.marketing && f.summary === '—' && !f.messages && f.anyInput === 0;

async function runViewport(label, viewport) {
  console.log(`\n${label} ${viewport.width}x${viewport.height}`);
  const { context, page, errors } = await openPage(viewport);
  const t = (name) => `${label}: ${name}`;

  // boot
  await page.waitForFunction(() => window.__kioskAttract.version === 'test-v1', null, { timeout: 5000 }).catch(() => {});
  check(t('boots in ATTRACT on the welcome screen'), (await state(page)) === 'ATTRACT' && (await screenName(page)) === 'welcome');
  check(t('KioskSession.state is a synchronous string'), typeof (await state(page)) === 'string');
  check(t('remote content applied (version test-v1)'), (await page.evaluate(() => window.__kioskAttract.version)) === 'test-v1');
  check(t('KioskNative.ready called once, with the (empty) bundle version'), JSON.stringify(await page.evaluate(() => window.__ready)) === '[""]');
  check(t('session settings from content'), JSON.stringify(await page.evaluate(() => window.KioskSession.settings)) === JSON.stringify({ idleSeconds: 30, graceSeconds: 10 }));
  const kinds = await page.evaluate(() => [...document.querySelectorAll('.attract-ad')].map((a) => a.dataset.kind));
  check(t('valid ads shown, unknown kind dropped'), JSON.stringify(kinds) === JSON.stringify(['location', 'feedback', 'loyalty', 'hours', 'menu_highlight', 'custom', 'custom']), kinds);
  const xss = await page.evaluate(() => {
    const ad = document.querySelector('.attract-ad[data-id="xss"]');
    return { title: ad.querySelector('h2').textContent, imgs: ad.querySelectorAll('img, script, b').length, flag: window.__xss };
  });
  check(t('remote strings are text, never HTML; javascript: image refused'), xss.title.startsWith('<img') && xss.imgs === 0 && xss.flag === undefined, xss);
  check(t('bad QR matrix is dropped (no canvas on that ad)'), (await page.locator('.attract-ad[data-id="badqr"] canvas').count()) === 0);
  check(t('feedback QR drawn on a canvas'), (await page.locator('.attract-ad[data-kind="feedback"] canvas.attract-qr').count()) === 1);
  check(t('loyalty ad says the club is planned, not active'), (await page.locator('.attract-ad[data-kind="loyalty"] .attract-note').textContent()) === 'המועדון בהקמה · ההטבות עוד לא פעילות');
  const hours = await page.evaluate(() => document.querySelector('.attract-ad[data-kind="hours"]').textContent);
  check(t('hours ad shows the week and the coming closure'), hours.includes('יום שבת') && hours.includes('סגור לרגל חג') && hours.includes('07:00–15:00'), hours);
  check(t('highlights ad uses the dashboard highlights'), (await page.evaluate(() => document.querySelector('.attract-ad[data-kind="menu_highlight"]').textContent)).includes('שייק פירות'));
  const btnText = await page.evaluate(() => [...document.querySelectorAll('.attract-btn')].map((b) => b.textContent.trim()));
  check(t('two permanent buttons with the exact labels'), JSON.stringify(btnText) === JSON.stringify(['לתפריט שלנו', 'הצטרפו למועדון']), btnText);

  // buttons never move while the ads rotate
  const boxes = [];
  const seen = new Set();
  for (let i = 0; i < 40 && seen.size < 4; i += 1) {
    const kind = await activeAd(page);
    if (!seen.has(kind)) {
      seen.add(kind);
      boxes.push(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.attract-btn')].map((b) => { const r = b.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }))));
    }
    await sleep(250);
  }
  check(t('ads rotate (4 different slides seen)'), seen.size >= 4, [...seen]);
  check(t('buttons stationary across slides (identical bounding boxes)'), new Set(boxes).size === 1, boxes);
  const visible = await page.evaluate(() => [...document.querySelectorAll('.attract-btn')].every((b) => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0 && r.height >= 80; }));
  check(t('buttons fully on screen and large'), visible);
  if (SHOTS) await shotOf(page, ['loyalty', 'hours', 'feedback'], label, 'attract');

  // one tap on "לתפריט שלנו" opens the menu
  await page.click('.attract-menu');
  check(t('one tap on the menu button opens the menu'), (await screenName(page)) === 'menu' && (await state(page)) === 'ACTIVE');
  const adBefore = await activeAd(page);
  await sleep(1600);
  check(t('slideshow stopped while a customer is active'), (await activeAd(page)) === adBefore);
  // a menu selection and a scroll, then the customer taps home: everything goes
  await page.click('.category-tabs [data-category]:nth-child(3)');
  await page.evaluate(() => { document.querySelector('.panel-menu').scrollTop = 200; document.querySelector('.category-tabs').scrollLeft = -80; });
  await page.click('.kiosk-header .home-icon');
  await waitState(page, 'ATTRACT');
  const menuState = await page.evaluate(() => ({
    first: document.querySelector('.category-tabs [data-category]').getAttribute('aria-selected'),
    scroll: document.querySelector('.panel-menu').scrollTop,
    tabs: document.querySelector('.category-tabs').scrollLeft,
  }));
  check(t('home button resets: first category again, scroll positions back to 0'), menuState.first === 'true' && menuState.scroll === 0 && menuState.tabs === 0, menuState);

  // one tap on "הצטרפו למועדון" opens the join form, then the full warning flow
  await page.click('.attract-join');
  check(t('one tap on the join button opens the join form'), (await screenName(page)) === 'join' && (await state(page)) === 'ACTIVE');
  await phoneToConsent(page);
  await fillConsent(page);
  await page.waitForSelector('.kiosk-warning.is-open', { timeout: 6000 });
  const modal = await page.evaluate(() => ({
    text: document.querySelector('.kiosk-warning').textContent,
    buttons: [...document.querySelectorAll('.kiosk-warning button')].map((b) => b.textContent.trim()),
    focus: document.activeElement?.dataset.session || null,
    state: window.KioskSession.state,
    screen: document.body.dataset.screen,
    count: Number(document.querySelector('.kiosk-warning-count').textContent),
  }));
  check(t('warning modal appears at timeout with the exact privacy sentence'), modal.text.includes('המסך יתאפס כדי לשמור על פרטיותכם.') && modal.state === 'WARNING', modal);
  check(t('warning buttons are "אני עדיין כאן" and "סיום ואיפוס"'), JSON.stringify(modal.buttons) === JSON.stringify(['אני עדיין כאן', 'סיום ואיפוס']), modal.buttons);
  check(t('warning has focus on "still here" and the screen underneath is unchanged'), modal.focus === 'stay' && modal.screen === 'consent');
  check(t('visible countdown starts near the grace period'), modal.count >= 5 && modal.count <= 10, modal.count);
  await page.click('.kiosk-warning [data-session="stay"]');
  const kept = await formSnapshot(page);
  check(t('"אני עדיין כאן" keeps the screen and every field'), (await screenName(page)) === 'consent' && (await state(page)) === 'ACTIVE'
    && kept.name === 'בודק' && kept.email === 'test@example.com' && kept.privacy && kept.marketing && kept.summary === '050-1234567' && kept.phone === '050-1234567', kept);
  check(t('modal closed after "still here"'), await page.evaluate(() => document.querySelector('.kiosk-warning').hidden));

  // nobody answers: grace runs out
  await page.waitForSelector('.kiosk-warning.is-open', { timeout: 6000 });
  const c1 = Number(await page.locator('.kiosk-warning-count').textContent());
  await sleep(450);
  const c2 = Number(await page.locator('.kiosk-warning-count').textContent());
  check(t('countdown ticks down'), c2 < c1, [c1, c2]);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `warning-${label}.png`) });
  await waitState(page, 'ATTRACT', 6000);
  const cleared = await formSnapshot(page);
  check(t('grace expiry clears every field, box, message and summary'), isClean(cleared), cleared);
  check(t('grace expiry returns to the welcome screen, ads running'), (await screenName(page)) === 'welcome');
  const order = await page.evaluate(() => window.__states.slice(-4).map((s) => s[0]).join('>'));
  check(t('state order WARNING>RESETTING>CLEAN>ATTRACT'), order === 'WARNING>RESETTING>CLEAN>ATTRACT', order);
  const adA = await activeAd(page); await sleep(1500);
  check(t('ads rotate again after the reset'), (await activeAd(page)) !== adA);

  // tap on the background (not a button, not an action ad) -> the regular choice screen
  await page.mouse.click(viewport.width / 2, 40);
  check(t('tap on the background opens the choice screen'), (await screenName(page)) === 'choice');
  await page.waitForSelector('.kiosk-warning.is-open', { timeout: 6000 });
  const t0 = Date.now();
  await page.click('.kiosk-warning [data-session="reset"]');
  await waitState(page, 'ATTRACT', 3000);
  check(t('"סיום ואיפוס" resets at once'), Date.now() - t0 < 1500 && (await screenName(page)) === 'welcome');

  // action ads
  await waitAd(page, 'loyalty');
  const adBox = await page.locator('.attract-ads').boundingBox();
  await page.mouse.click(adBox.x + adBox.width / 2, adBox.y + adBox.height / 2);
  check(t('tap on the loyalty ad opens the join form'), (await screenName(page)) === 'join');
  await resetToAttract(page);
  await waitAd(page, 'location');
  await page.mouse.click(adBox.x + adBox.width / 2, adBox.y + adBox.height / 2);
  check(t('tap on a non-actionable ad opens the choice screen'), (await screenName(page)) === 'choice');
  await resetToAttract(page);

  // no ads while a form has data
  await page.click('.attract-join');
  for (const d of '05012') await page.click(`.numpad [data-key="${d}"]`);
  check(t('no ads while a form has data'), (await page.evaluate(() => document.querySelector('.panel-welcome').hidden)) && (await state(page)) === 'ACTIVE');

  // a page hidden past its deadline resets as soon as it is back (the screen was off; timers do not count)
  await page.evaluate(() => {
    window.__realNow = Date.now;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const skew = 120000;
    Date.now = () => window.__realNow() + skew;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const afterReturn = await state(page);
  check(t('return after the deadline resets immediately (no warning)'), afterReturn === 'RESETTING' || afterReturn === 'ATTRACT', afterReturn);
  await waitState(page, 'ATTRACT');
  check(t('...and the typed digits are gone'), (await formSnapshot(page)).phone === '');
  await page.evaluate(() => { Date.now = window.__realNow; delete document.hidden; });

  // a reset waits for the sign-up in flight, and its late answer never shows success or data
  mock.signupDelay = 2500; mock.signupStatus = 200;
  await page.click('.attract-join');
  await phoneToConsent(page);
  await fillConsent(page);
  await page.evaluate(() => { window.__screens = []; });
  await page.click('.submit-consent');
  await sleep(200);
  await page.evaluate(() => { window.KioskSession.resetNow('check'); });
  await sleep(600);
  check(t('reset is held while the sign-up is in flight'), (await state(page)) === 'RESETTING');
  await waitState(page, 'ATTRACT', 8000);
  const sent = mock.signups.at(-1);
  const attractAt = await page.evaluate(() => window.__states.filter((s) => s[0] === 'ATTRACT').at(-1)[1]);
  check(t('reset finished only after the server answered'), sent.answeredAt > 0 && attractAt >= sent.answeredAt, { answered: sent.answeredAt, attractAt });
  const screens = await page.evaluate(() => window.__screens);
  check(t('late success answer never showed success'), !screens.includes('success') && (await screenName(page)) === 'welcome', screens);
  check(t('late answer did not put data back'), isClean(await formSnapshot(page)));

  // same with a late failure: no error screen for the next visitor
  mock.signupStatus = 500;
  await page.click('.attract-join');
  await phoneToConsent(page);
  await fillConsent(page);
  await page.evaluate(() => { window.__screens = []; });
  await page.click('.submit-consent');
  await sleep(200);
  await page.click('.kiosk-header .home-icon'); // the customer walks off through home
  await waitState(page, 'ATTRACT', 8000);
  await sleep(2600);
  check(t('late failure answer never showed the error screen'), !(await page.evaluate(() => window.__screens)).includes('error') && (await screenName(page)) === 'welcome');

  // success: form cleared at once, confirmation, quiet return home
  mock.signupDelay = 0; mock.signupStatus = 200;
  await page.click('.attract-join');
  await phoneToConsent(page, '0527654321');
  await fillConsent(page);
  const requestIdBefore = mock.signups.at(-1).body.requestId;
  await page.click('.submit-consent');
  await page.waitForFunction(() => document.body.dataset.screen === 'success');
  check(t('success: every field cleared while the confirmation shows'), isClean(await formSnapshot(page)));
  check(t('success: a new request id per form fill'), mock.signups.at(-1).body.requestId !== requestIdBefore);
  await waitState(page, 'ATTRACT', 5000);
  check(t('success returns home by itself without the warning'), !(await page.evaluate(() => window.__states.slice(-5).some((s) => s[0] === 'WARNING'))));

  // settings are clamped
  const clamped = await page.evaluate(() => { window.KioskSession.configure({ idleSeconds: 5, graceSeconds: 100 }); const s = window.KioskSession.settings; window.KioskSession.configure({ idleSeconds: 30, graceSeconds: 10 }); return s; });
  check(t('idle/grace clamped to 30-300 / 5-30'), clamped.idleSeconds === 30 && clamped.graceSeconds === 30, clamped);

  // the content endpoint is asked with ?since and the menu ping triggers a refresh in ATTRACT
  const hits = mock.contentHits;
  // ping refreshes are at most one per 10 s; the boot fetch is long past by now
  await page.evaluate(() => window.dispatchEvent(new Event('kiosk:menu-ping')));
  await sleep(500);
  check(t('menu ping refreshes the announcements in ATTRACT'), mock.contentHits > hits);

  check(t('the welcome screen never showed while a form held data'), (await page.evaluate(() => window.__attractWithData)) === 0);
  check(t('no page errors'), errors.length === 0, errors);
  await context.close();
}

async function runDefaults(label, viewport) {
  console.log(`\n${label} ${viewport.width}x${viewport.height} (content endpoint down)`);
  const { context, page, errors } = await openPage(viewport, { content: 'fail' });
  await sleep(800);
  const t = (name) => `${label}: ${name}`;
  check(t('endpoint failure: built-in announcements'), (await page.evaluate(() => window.__kioskAttract.version)) === 'builtin');
  const kinds = await page.evaluate(() => [...document.querySelectorAll('.attract-ad')].map((a) => a.dataset.kind));
  check(t('defaults: location, feedback, loyalty, menu highlight; no hours without data'), JSON.stringify(kinds) === JSON.stringify(['location', 'feedback', 'loyalty', 'menu_highlight']), kinds);
  const texts = await page.evaluate(() => [...document.querySelectorAll('.attract-ad p')].map((p) => p.textContent));
  check(t('defaults: exact location text'), texts.includes('בואו לבקר את סניף האם שלנו במאור באווירת מושב חמה בימי ראשון עד שישי'));
  check(t('defaults: exact feedback text'), texts.includes('סרקו את קוד ה-QR כדי להצביע ולהשפיע על מה שיש לעגלה להציע — אנחנו רוצים לשמוע אתכם'));
  check(t('defaults: exact loyalty text'), texts.includes('מעוניינים במועדון לקוחות עם צבירת נקודות ואירועים? הירשמו בלחיצה על המסך'));
  check(t('defaults: feedback QR on a canvas, with its address'), (await page.locator('.attract-ad[data-kind="feedback"] canvas').count()) === 1
    && (await page.locator('.attract-ad[data-kind="feedback"] figcaption').textContent()) === 'sarcafe-portal.vercel.app/feedback');
  const qrOk = await page.evaluate(() => {
    const c = document.querySelector('.attract-qr');
    const ctx = c.getContext('2d');
    const k = c.width / 37; // 29 modules + 2 x 4 quiet
    const px = (mx, my) => ctx.getImageData(Math.floor((mx + 4.5) * k), Math.floor((my + 4.5) * k), 1, 1).data[0];
    return px(0, 0) < 50 && px(7, 0) > 200 && px(3, 3) < 50 && px(1, 1) > 200; // finder pattern corner
  });
  check(t('defaults: QR finder pattern drawn correctly'), qrOk);
  check(t('defaults: menu highlight falls back to recommended items of the cached menu'), (await page.evaluate(() => document.querySelector('.attract-ad[data-kind="menu_highlight"]').textContent)).includes('3 שוקולדים'));
  check(t('defaults: idle 60 / grace 10'), JSON.stringify(await page.evaluate(() => window.KioskSession.settings)) === JSON.stringify({ idleSeconds: 60, graceSeconds: 10 }));
  if (SHOTS) await shotOf(page, ['feedback'], label, 'attract-defaults');
  check(t('no page errors'), errors.length === 0, errors);
  await context.close();
}

try {
  await runDefaults('portrait', { width: 600, height: 1000 });
  await runDefaults('landscape', { width: 1000, height: 600 });
  await runViewport('portrait', { width: 600, height: 1000 });
  await runViewport('landscape', { width: 1000, height: 600 });
} catch (error) {
  failures.push(`crashed: ${error && error.stack || error}`);
} finally {
  await browser.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\ncheck-kiosk-session: ${passed} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
