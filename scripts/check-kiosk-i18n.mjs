#!/usr/bin/env node
/*
 * Checks the kiosk's three languages (overrides/kiosk-i18n.js and every layer that speaks through it) on the page
 * exactly as the app packages it (scripts/assemble-kiosk-bundle.mjs), in headless Chromium at the tablet's sizes
 * (600x1000 portrait, 1000x600 landscape).
 *
 *   node scripts/check-kiosk-i18n.mjs            (KIOSK_SHOTS=<dir> also saves a screenshot of every screen)
 *
 * What it proves, per language and orientation: the switch changes the whole page (lang, dir, title); no Hebrew is
 * left on any screen in English or Arabic (only the owner's legal name, which names a real person); nothing
 * overflows sideways and no button clips its words; the menu, its badges and the announcements follow; the
 * sign-up sends the version ids of the language on screen; messages, the warning and the success screen speak the
 * language; a privacy reset, a timeout and an abandoned welcome screen all bring back Hebrew; switching keeps what
 * was typed. A local mock stands in for the portal; durations run at ?kioskTestScale=0.1. Nothing touches production.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { assemble } from './assemble-kiosk-bundle.mjs';

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
const read = (f) => readFileSync(f, 'utf8');
const HEBREW = /[\u0590-\u05FF]/;

// ---- static: the dictionaries are complete ------------------------------------------------------------------------
{
  // run the language file in a bare context just far enough to read its tables (no DOM needed for that part)
  const src = read(join(overrides, 'kiosk-i18n.js'));
  const tables = src.slice(src.indexOf('const T = {'), src.indexOf('// ---- state'));
  const ctx = {};
  vm.runInNewContext(`${tables}; this.T = T; this.A = ANNOUNCEMENTS;`, ctx);
  const { T, A } = ctx;
  const he = Object.keys(T.he);
  for (const lang of ['en', 'ar']) {
    const keys = Object.keys(T[lang]);
    const missing = he.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !he.includes(k));
    check(`static: ${lang} has every Hebrew key and no other`, !missing.length && !extra.length, { missing, extra });
    const wrongType = he.filter((k) => typeof T.he[k] !== typeof T[lang][k] || Array.isArray(T.he[k]) !== Array.isArray(T[lang][k]));
    check(`static: ${lang} values have the Hebrew shapes (text, list or function)`, !wrongType.length, wrongType);
    const hebrewLeft = keys.filter((k) => {
      const v = T[lang][k];
      const text = typeof v === 'function' ? String(v(3)) : JSON.stringify(v);
      return HEBREW.test(text);
    });
    check(`static: no Hebrew letters in the ${lang} words`, !hebrewLeft.length, hebrewLeft);
    check(`static: ${lang} has all seven day names`, [0, 1, 2, 3, 4, 5, 6].every((d) => T[lang].day(d) && !HEBREW.test(T[lang].day(d))));
    check(`static: ${lang} has every announcement kind`, ['location', 'feedback', 'loyalty', 'hours', 'menu_highlight', 'custom'].every((k) => T[lang].kinds[k]));
  }
  check('static: every announcement translation has English and Arabic, no Hebrew in them', Object.values(A).every((row) => row.length === 2 && row.every((s) => s && !HEBREW.test(s))));
  check('static: the Hebrew words are the prototype\'s own (the buttons that existed keep their exact text)', T.he.btnMenu === 'לתפריט שלנו' && T.he.btnJoin === 'הצטרפו למועדון' && T.he.warnStay === 'אני עדיין כאן' && T.he.warnReset === 'סיום ואיפוס');

  const gloss = {};
  vm.runInNewContext(read(join(overrides, 'kiosk-menu-i18n.js')), { window: gloss });
  const G = gloss.SARCAFE_MENU_GLOSSARY;
  check('static: every glossary row is [English, Arabic], neither empty nor Hebrew', Object.values(G).every((row) => row.length === 2 && row.every((s) => typeof s === 'string' && s && !HEBREW.test(s))));
  const menu = {};
  vm.runInNewContext(read(join(repo, 'prototypes', 'sarcafe-kiosk', 'menu-data.js')), { window: menu });
  const words = [];
  menu.SARCAFE_MENU.categories.forEach((c) => {
    words.push(c.title);
    c.items.forEach((i) => { words.push(i.name); if (i.note) words.push(i.note); (i.types || []).forEach((t) => words.push(t.replace(/ — אזל$/, ''))); });
  });
  const unknown = words.filter((w) => !G[w]);
  check('static: every word of the menu shipped in the app is in the glossary', !unknown.length, unknown);

  // the server accepts exactly the ids the kiosk shows, per language
  const dir = mkdtempSync(join(tmpdir(), 'check-kiosk-i18n-ts-'));
  const lib = join(repo, 'scripts', '.tmp-check-kiosk-i18n');
  mkdirSync(lib, { recursive: true });
  process.on('exit', () => { try { rmSync(lib, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } });
  const out = join(lib, 'waitlist.mjs');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(out, ts.transpileModule(read(join(repo, 'src', 'lib', 'kiosk', 'waitlist.ts')), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText);
  const W = await import(pathToFileURL(out).href);
  const legal = read(join(overrides, 'kiosk-legal.js'));
  for (const lang of ['he', 'en', 'ar']) {
    const set = W.KIOSK_LEGAL_VERSIONS[lang];
    check(`static: the ${lang} version ids in kiosk-legal.js are the server's`, Object.values(set).every((v) => legal.includes(`'${v}'`)));
  }
}

// ---- the packaged page + a mock portal --------------------------------------------------------------------------
const work = mkdtempSync(join(tmpdir(), 'sarcafe-kiosk-i18n-'));
const assets = join(work, 'assets');
const bundled = assemble(assets);
check('bundle: the language files and the Arabic font are packed', ['kiosk-i18n.js', 'kiosk-menu-i18n.js', 'rubik-arabic.woff2'].every((f) => bundled.includes(f)));
const indexHtml = read(join(assets, 'index.html'));
check('bundle: the language layer loads before every layer that speaks through it',
  indexHtml.indexOf('kiosk-menu-i18n.js') < indexHtml.indexOf('kiosk-i18n.js') && indexHtml.indexOf('kiosk-i18n.js') < indexHtml.indexOf('kiosk-app.js'));

const mock = { signups: [], signupStatus: 200, menu: null };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/api/kiosk/content') return json(500, { error: 'down' }); // the built-in announcements
  if (url.pathname === '/api/kiosk/menu') return json(200, { unchanged: true });
  if (url.pathname === '/api/kiosk/waitlist' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { mock.signups.push(JSON.parse(body || '{}')); json(mock.signupStatus, { ok: mock.signupStatus === 200 }); });
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

const initScript = ({ api, menu }) => {
  window.SarcafeKiosk = { config: () => JSON.stringify({ api, signupKey: 'test-key', perf: 'full' }) };
  window.KioskNative = { ready: () => {} };
  if (menu) localStorage.setItem('sarcafe.menu.v1', JSON.stringify(menu));
  else localStorage.removeItem('sarcafe.menu.v1');
};

async function openPage(viewport, { menu = null } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: SHOTS ? 2 : 1, locale: 'he-IL' });
  await context.addInitScript(initScript, { api: `${base}/api/kiosk/menu`, menu });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${base}/index.html?kioskTestScale=${SCALE}`);
  await page.waitForFunction(() => window.KioskSession && window.KioskI18n && window.__kioskAttract);
  return { context, page, errors };
}

const go = (page, name) => page.evaluate((n) => document.querySelector(`.screen-picker [data-screen="${n}"], .kiosk-footer [data-screen="${n}"]`).click(), name);
const waitState = (page, s, timeout = 8000) => page.waitForFunction((x) => window.KioskSession.state === x, s, { timeout });
const langOf = (page) => page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir, i18n: window.KioskI18n.lang, title: document.title }));

// Everything a visitor can see on the current screen: text of rendered elements, placeholders, alt and aria labels.
const visibleText = (page) => page.evaluate(() => {
  const out = [];
  const shown = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05; };
  const walker = document.createTreeWalker(document.querySelector('.kiosk-screen'), NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.nodeValue.trim() || !el || !shown(el) || el.closest('.lang-switch, .attract-ad:not(.is-active)')) continue;
    out.push(n.nodeValue.trim());
  }
  document.querySelectorAll('.kiosk-screen [placeholder], .kiosk-screen [aria-label], .kiosk-screen img[alt]').forEach((el) => {
    if (!shown(el) || el.closest('.lang-switch')) return;
    ['placeholder', 'aria-label', 'alt'].forEach((a) => { if (el.getAttribute(a)) out.push(el.getAttribute(a)); });
  });
  return out;
});
// the owner's legal name (a real person's name, written as she writes it) is the one Hebrew allowed in other languages
const ALLOWED = ['שרי איסרליס', 'שרקפה'];
const hebrewIn = (texts) => texts.map((t) => ALLOWED.reduce((s, a) => s.split(a).join(''), t)).filter((t) => HEBREW.test(t));

// sideways overflow of the page or of any screen, and buttons/labels whose words do not fit
const layoutProblems = (page) => page.evaluate(() => {
  const problems = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) problems.push(`page ${document.documentElement.scrollWidth}>${vw}`);
  const panel = document.querySelector(`.panel[data-panel="${document.body.dataset.screen}"]`);
  // a screen that scrolls sideways (a clipped one, overflow hidden, only hides decoration such as the photo drift)
  if (panel && getComputedStyle(panel).overflowX !== 'hidden' && panel.scrollWidth > panel.clientWidth + 1) problems.push(`panel ${panel.scrollWidth}>${panel.clientWidth}`);
  // the decision cards clip a decorative circle on purpose, so their words are measured instead of the card
  document.querySelectorAll('.kiosk-screen button:not(.decision-card), .decision-copy strong, .decision-copy small, .kiosk-screen h1, .kiosk-screen h2, .kiosk-screen label, .attract-btn span').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') return;
    if (el.closest('.attract-ad:not(.is-active), .menu-peek, .category-tabs')) return; // stacked slides; the tabs row scrolls by design
    if (el.scrollWidth > el.clientWidth + 2) problems.push(`clipped: ${el.className || el.tagName} "${el.textContent.trim().slice(0, 40)}" ${el.scrollWidth}>${el.clientWidth}`);
    if (r.right > vw + 1 || r.left < -1) problems.push(`off screen: ${el.className || el.tagName} "${el.textContent.trim().slice(0, 40)}"`);
  });
  return problems;
});

async function phoneToConsent(page, digits = '0501234567') {
  for (const d of digits) await page.click(`.numpad [data-key="${d}"]`);
  await page.click('.quick-submit');
  await page.waitForFunction(() => document.body.dataset.screen === 'consent');
}
async function fillConsent(page, name = 'Dana') {
  await page.fill('.consent-form [name="firstName"]', name);
  await page.check('.consent-form [name="privacy"]');
}
async function pickLang(page, lang, where = 'header') {
  await page.click(`.lang-switch-${where} [data-lang="${lang}"]`);
  await page.waitForFunction((l) => document.documentElement.lang === l, lang);
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };

const SCREENS = ['choice', 'join', 'menu', 'consent', 'privacy', 'terms', 'success', 'error'];

async function runLanguage(label, viewport, lang) {
  console.log(`\n${label} ${viewport.width}x${viewport.height} ${lang}`);
  const { context, page, errors } = await openPage(viewport);
  const t = (name) => `${label}/${lang}: ${name}`;
  const expectDir = lang === 'en' ? 'ltr' : 'rtl';

  check(t('starts in Hebrew, right to left'), JSON.stringify(await langOf(page)).includes('"lang":"he","dir":"rtl"'));
  const switchBox = await page.locator('.lang-switch-welcome').boundingBox();
  check(t('the switch is on the welcome screen, on screen, with three big enough buttons'), switchBox && switchBox.y >= 0 && switchBox.x >= 0 && switchBox.x + switchBox.width <= viewport.width
    && (await page.locator('.lang-switch-welcome button').count()) === 3 && switchBox.height >= 44, switchBox);
  const labels = await page.evaluate(() => [...document.querySelectorAll('.lang-switch-welcome button')].map((b) => [b.textContent, b.lang]));
  check(t('each language is named in itself'), JSON.stringify(labels) === JSON.stringify([['עברית', 'he'], ['English', 'en'], ['العربية', 'ar']]), labels);

  // the welcome screen: a language tap is not a tap on the screen behind it
  await pickLang(page, lang, 'welcome');
  const l = await langOf(page);
  check(t('the switch sets lang, dir and the title'), l.lang === lang && l.dir === expectDir && l.i18n === lang && !HEBREW.test(l.title), l);
  check(t('a language tap on the welcome screen stays on it (no visit started)'), (await page.evaluate(() => [document.body.dataset.screen, window.KioskSession.state])).join() === 'welcome,ATTRACT');
  check(t('the pressed button says so'), (await page.getAttribute(`.lang-switch-welcome [data-lang="${lang}"]`, 'aria-pressed')) === 'true');
  const btns = await page.evaluate(() => [...document.querySelectorAll('.attract-btn span')].map((s) => s.textContent));
  check(t('the two big buttons speak the language'), btns.every((b) => !HEBREW.test(b)) && btns.length === 2, btns);
  // every slide of the built-in announcements
  const slideTexts = await page.evaluate(() => [...document.querySelectorAll('.attract-ad')].map((a) => a.textContent));
  check(t('every announcement slide is translated'), slideTexts.length >= 3 && slideTexts.every((s) => !HEBREW.test(s)), slideTexts.filter((s) => HEBREW.test(s)));
  check(t('welcome screen: no Hebrew visible'), !hebrewIn(await visibleText(page)).length, hebrewIn(await visibleText(page)));
  check(t('welcome screen: layout fits'), !(await layoutProblems(page)).length, await layoutProblems(page));
  if (SHOTS) {
    await page.evaluate(() => document.querySelector('.attract').classList.add('is-instant'));
    for (const kind of ['loyalty', 'feedback', 'menu_highlight']) {
      await page.waitForFunction((k) => document.querySelector('.attract-ad.is-active')?.dataset.kind === k, kind, { timeout: 15000 });
      await shot(page, `${label}-${lang}-welcome-${kind}`);
    }
  }

  // every screen
  for (const screen of SCREENS) {
    await go(page, screen);
    await sleep(60);
    const texts = await visibleText(page);
    const left = hebrewIn(texts);
    check(t(`${screen}: no Hebrew visible`), !left.length, left.slice(0, 6));
    const problems = await layoutProblems(page);
    check(t(`${screen}: layout fits (no sideways overflow, no clipped button)`), !problems.length, problems.slice(0, 6));
    check(t(`${screen}: still ${lang} / ${expectDir}`), (await langOf(page)).dir === expectDir);
    await shot(page, `${label}-${lang}-${screen}`);
    if (screen === 'menu') {
      // every category of the menu
      const tabs = await page.locator('.category-tabs [data-category]').count();
      const bad = [];
      for (let i = 0; i < tabs; i += 1) {
        await page.locator('.category-tabs [data-category]').nth(i).click();
        const words = hebrewIn(await visibleText(page));
        if (words.length) bad.push(...words);
      }
      check(t('menu: every category, item, note, type and badge translated'), !bad.length, bad.slice(0, 8));
      const badge = await page.evaluate(() => [...document.querySelectorAll('.menu-content .badge')].map((b) => b.textContent));
      check(t('menu: badges in the language'), badge.length > 0 && badge.every((b) => !HEBREW.test(b)), badge);
      await page.locator('.category-tabs [data-category]').first().click();
    }
  }

  // the sign-up in this language: the ids of this language travel with it
  await go(page, 'join');
  await page.click('.quick-submit'); // no number yet
  const quick = await page.textContent('.quick-message');
  check(t('wrong number message in the language'), quick && !HEBREW.test(quick), quick);
  await phoneToConsent(page);
  await page.click('.submit-consent'); // nothing filled
  const need = await page.textContent('.consent-message');
  check(t('missing name / consent message in the language'), need && !HEBREW.test(need), need);
  // switching language mid-form keeps what was typed and re-says the message
  await fillConsent(page);
  const other = lang === 'en' ? 'ar' : 'en';
  await pickLang(page, other);
  const kept = await page.evaluate(() => ({ phone: document.getElementById('quick-phone').value, name: document.querySelector('[name="firstName"]').value, privacy: document.querySelector('[name="privacy"]').checked, screen: document.body.dataset.screen, state: window.KioskSession.state, msg: document.querySelector('.consent-message').textContent }));
  check(t('switching language mid-form keeps the screen and everything typed'), kept.phone === '050-1234567' && kept.name === 'Dana' && kept.privacy && kept.screen === 'consent' && kept.state === 'ACTIVE', kept);
  check(t('...and the message on screen is said again in the new language'), kept.msg && !HEBREW.test(kept.msg) && kept.msg !== need, kept.msg);
  await pickLang(page, lang);

  mock.signupStatus = 409;
  await page.click('.submit-consent');
  await page.waitForFunction(() => document.querySelector('.consent-message').textContent.length > 0);
  const already = await page.textContent('.consent-message');
  check(t('"already registered" in the language'), already && !HEBREW.test(already), already);
  const sent409 = mock.signups.at(-1);
  check(t('the sign-up names this language\'s notice, consent and terms'), [sent409.privacyVersion, sent409.consentVersion, sent409.termsVersion].every((v) => v.includes(`-${lang}-v`)), sent409);

  mock.signupStatus = 200;
  await page.click('.submit-consent');
  await page.waitForFunction(() => document.body.dataset.screen === 'success');
  check(t('success screen stays in the visitor\'s language'), (await langOf(page)).lang === lang && !HEBREW.test(await page.textContent('.panel-success')));
  await shot(page, `${label}-${lang}-success-live`);
  await waitState(page, 'ATTRACT', 6000);
  check(t('after the confirmation the kiosk is back in Hebrew for the next visitor'), JSON.stringify(await langOf(page)).includes('"lang":"he","dir":"rtl"'));
  const heBtns = await page.evaluate(() => [...document.querySelectorAll('.attract-btn span')].map((s) => s.textContent));
  check(t('...the welcome buttons in Hebrew again'), JSON.stringify(heBtns) === JSON.stringify(['לתפריט שלנו', 'הצטרפו למועדון']), heBtns);

  // the warning in this language, and its timeout resets to Hebrew
  await pickLang(page, lang, 'welcome');
  await page.click('.attract-join');
  for (const d of '0501') await page.click(`.numpad [data-key="${d}"]`);
  await page.waitForSelector('.kiosk-warning.is-open', { timeout: 8000 });
  const warn = await page.evaluate(() => document.querySelector('.kiosk-warning').textContent);
  check(t('the privacy warning speaks the language'), !HEBREW.test(warn), warn);
  check(t('warning: layout fits'), !(await layoutProblems(page)).length, await layoutProblems(page));
  await shot(page, `${label}-${lang}-warning`);
  await waitState(page, 'ATTRACT', 8000);
  const after = await page.evaluate(() => ({ phone: document.getElementById('quick-phone').value, lang: document.documentElement.lang, dir: document.documentElement.dir }));
  check(t('timeout: data gone and Hebrew back'), after.phone === '' && after.lang === 'he' && after.dir === 'rtl', after);

  // the header's home button ends the visit: Hebrew back
  await page.click('.attract-menu');
  await pickLang(page, lang);
  await page.click('.kiosk-header .home-icon');
  await waitState(page, 'ATTRACT');
  check(t('home button: Hebrew back'), (await langOf(page)).lang === 'he');

  // a language picked on the welcome screen by someone who walked away goes back to Hebrew after the idle time
  await pickLang(page, lang, 'welcome');
  const idle = await page.evaluate(() => window.KioskSession.settings.idleSeconds * 1000 * window.KioskSession.scale);
  await sleep(idle + 600);
  check(t('an abandoned language on the welcome screen returns to Hebrew'), (await langOf(page)).lang === 'he' && (await page.evaluate(() => window.KioskSession.state)) === 'ATTRACT');

  // the reverse: back to Hebrew from the switch gives the original page
  await pickLang(page, lang, 'welcome');
  await page.click(`.lang-switch-welcome [data-lang="he"]`);
  await page.waitForFunction(() => document.documentElement.lang === 'he');
  await go(page, 'choice');
  check(t('back to Hebrew: the prototype\'s own words return'), (await page.textContent('.choice-heading h1')) === 'איך תרצו להמשיך?');
  await page.click('.kiosk-header .home-icon');

  check(t('no page errors'), errors.length === 0, errors);
  await context.close();
}

// the server's own translations win over the built-in glossary
async function runServerMenu() {
  console.log('\nserver-sent translations');
  const menu = {
    branch: 'גבעת חביבה', publishedAt: '2026-11-01T08:00:00Z', version: 'test-tr-1',
    categories: [{ id: 'hot', title: 'קפה חם', tr: { en: { title: 'Hot (server)' }, ar: { title: 'ساخن (خادم)' } }, items: [
      { name: 'הפוך קטן', price: 13, recommended: true, tr: { en: { name: 'Latte (server)' }, ar: { name: 'لاتيه (خادم)' } } },
      { name: 'מאפה', price: 15, types: ['גבינית', 'שקדים — אזל'], tr: { en: { name: 'Pastry (server)', types: ['Cheese (server)', 'Almond — Sold out'] } } },
      { name: 'פריט חדש שאין לו תרגום', price: 9 },
    ] }],
  };
  const { context, page, errors } = await openPage({ width: 1000, height: 600 }, { menu });
  await page.click('.attract-menu');
  await pickLang(page, 'en');
  const en = await page.evaluate(() => ({ tab: document.querySelector('.category-tabs [data-category]').textContent, items: [...document.querySelectorAll('.menu-item')].map((i) => i.textContent) }));
  check('server menu: the category title from the server', en.tab === 'Hot (server)', en.tab);
  check('server menu: item names and types from the server', en.items[0].includes('Latte (server)') && en.items[1].includes('Cheese (server)') && en.items[1].includes('Almond — Sold out'), en.items);
  check('server menu: an item nobody translated stays in Hebrew rather than vanish', en.items[2].includes('פריט חדש שאין לו תרגום'));
  await pickLang(page, 'ar');
  const ar = await page.evaluate(() => [...document.querySelectorAll('.menu-item')].map((i) => i.textContent));
  check('server menu: Arabic from the server; types the server did not translate fall back to the glossary', ar[0].includes('لاتيه (خادم)') && ar[1].includes('معجنة بالجبنة') && ar[1].includes('نفدت الكمية'), ar);
  await page.click('.lang-switch-header [data-lang="he"]');
  const he = await page.evaluate(() => [...document.querySelectorAll('.menu-item h2')].map((i) => i.textContent));
  check('server menu: back to Hebrew gives the Hebrew names exactly', JSON.stringify(he) === JSON.stringify(['הפוך קטן', 'מאפה', 'פריט חדש שאין לו תרגום']), he);
  check('server menu: no page errors', errors.length === 0, errors);
  await context.close();
}

try {
  for (const [label, viewport] of [['portrait', { width: 600, height: 1000 }], ['landscape', { width: 1000, height: 600 }]]) {
    for (const lang of ['en', 'ar']) await runLanguage(label, viewport, lang);
  }
  await runServerMenu();
} catch (error) {
  failures.push(`crashed: ${error && error.stack || error}`);
} finally {
  await browser.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(`\ncheck-kiosk-i18n: ${passed} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
