/*
 * Sarcafe kiosk app: the staff control panel. Opened by the Android app after the staff PIN (5 taps on the top-left corner,
 * then the PIN): the app calls window.KioskAdmin.open(token). It is a full screen of every setting staff may want to tune,
 * in big touch controls, with a live preview and one place for every switch, number and choice:
 *
 *   סקירה      the battery, the connection, who is on shift, which tablet and branch this is
 *   מסכים      the header (who is on shift, closing time, branch, item count), the welcome credit line, the club
 *   מודעות     arrows, drag, auto-play, going round, slide or fade, what a tap does, the time on each, which ads this tablet shows
 *   זמנים      the time before the privacy reset warning, the warning, the confirmation, how often the content refreshes
 *   שפות       which languages are offered, the default one, the switch
 *   סוללה      where the charge shows, the alerts to the developer (on or off, where the ladder starts: one alert per 5 % from
 *              there down to 5 %), the urgent title for the low rungs, a test alert
 *   מכשיר      (the app) rotation, speed, brightness, Wi-Fi, unlock, restart, exit the kiosk, a new PIN
 *   עדכונים    (the app) which page and app versions run, check now, undo
 *   אבחון      what the tablet knows about itself, clear the cache, everything back to the defaults
 *
 * Every change applies at once and is saved to the portal in the background (kiosk-config.js): "נשמר" once the portal has it,
 * "ממתין" while it has not (offline: it is sent again every few minutes, nothing is lost). "תצוגה מקדימה" puts the panel away to
 * look at the kiosk itself and brings it back with one tap. The panel closes by itself after three minutes without a touch,
 * and the app only lets it ask for device actions while the staff session it opened is alive (a token only the app and this page know).
 *
 * The app side is window.KioskStaff (APK 0.3 and later): info(token), act(token, action, arg), close(token). With an older app the
 * device tabs say so and everything that is a setting of the page still works.
 */
(() => {
  const C = window.KioskConfig;
  if (!C) return;
  const S = window.KioskSession;
  const body = document.body;

  const IDLE_CLOSE_MS = 3 * 60000;
  const hasNative = () => typeof window.KioskStaff === 'object' && window.KioskStaff !== null && typeof window.KioskStaff.act === 'function';
  // a page that is NOT served from the kiosk's own origin (a developer's desktop browser) may open the panel without the app
  const isDesktopTest = () => location.hostname !== 'kiosk.sarcafe.invalid';

  let root = null;
  let token = '';
  let tab = 'overview';
  let previewing = false;
  let idleTimer;
  let clock;
  let native = null;      // the last info() answer
  let toast = '';
  let toastTimer;
  let unsub = null;

  // ---- tiny DOM helper ------------------------------------------------------------------------------------------------
  const h = (tag, props, ...kids) => {
    const node = document.createElement(tag);
    Object.keys(props || {}).forEach((key) => {
      const value = props[key];
      if (value === false || value === null || value === undefined) return;
      if (key === 'class') node.className = value;
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    });
    kids.flat(2).forEach((kid) => { if (kid === null || kid === undefined || kid === false) return; node.append(kid.nodeType ? kid : document.createTextNode(String(kid))); });
    return node;
  };
  const svg = (d, cls) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('aria-hidden', 'true');
    if (cls) el.setAttribute('class', cls);
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    el.append(p);
    return el;
  };

  // ---- talking to the app --------------------------------------------------------------------------------------------
  function ask(action, arg) {
    if (!hasNative()) return { ok: false, error: 'no_app' };
    try {
      return JSON.parse(window.KioskStaff.act(token, action, arg === undefined ? '' : String(arg)) || '{"ok":false}');
    } catch (_) {
      return { ok: false, error: 'bad_answer' };
    }
  }
  function loadInfo() {
    if (!hasNative()) { native = null; return; }
    try { native = JSON.parse(window.KioskStaff.info(token) || 'null'); } catch (_) { native = null; }
  }

  // ---- values -----------------------------------------------------------------------------------------------------------
  const cget = (path) => C.get(path);
  const set = (path, value) => {
    const [section, key] = path.split('.');
    C.patch({ [section]: { [key]: value } });
  };
  const say = (text) => {
    toast = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast = ''; paintStatus(); }, 3500);
    paintStatus();
  };
  const ago = (ms) => {
    if (!ms) return 'עוד לא';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'לפני רגע';
    if (s < 3600) return `לפני ${Math.round(s / 60)} דק׳`;
    if (s < 86400) return `לפני ${Math.round(s / 3600)} שע׳`;
    return `לפני ${Math.round(s / 86400)} ימים`;
  };

  // ---- the controls -----------------------------------------------------------------------------------------------------
  function textOf(label, hint) { return h('div', { class: 'kx-text' }, h('b', null, label), hint ? h('small', null, hint) : null); }

  function toggle(label, hint, path, extra) {
    const on = !!cget(path);
    const btn = h('button', { type: 'button', role: 'switch', 'aria-checked': String(on), class: 'kx-switch', 'aria-label': label,
      onclick: () => { if (extra && extra.guard && !extra.guard(!on)) return; set(path, !on); } }, h('i'));
    return h('div', { class: 'kx-row' }, textOf(label, hint), btn);
  }

  function segment(label, hint, path, options, extra) {
    const now = cget(path);
    const group = h('div', { class: 'kx-seg', role: 'radiogroup', 'aria-label': label }, options.map(([value, text]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(now === value), class: now === value ? 'is-on' : '',
      onclick: () => { if (now !== value) { if (extra && extra.after) extra.after(value); else set(path, value); } },
    }, text)));
    return h('div', { class: 'kx-row kx-row-stack' }, textOf(label, hint), group);
  }

  // a number with − and +; `fallback` (a function) is the value in force while the setting follows the branch (null)
  function stepper(label, hint, path, o) {
    const stored = cget(path);
    const shown = stored === null || stored === undefined ? o.fallback() : stored;
    const move = (dir) => {
      const next = Math.min(o.max, Math.max(o.min, shown + dir * o.step));
      if (next !== shown) set(path, next);
    };
    const value = h('output', { class: 'kx-num' }, `${shown}`, h('small', null, ` ${o.unit}`));
    const box = h('div', { class: 'kx-stepper' },
      h('button', { type: 'button', 'aria-label': 'פחות', onclick: () => move(-1), disabled: shown <= o.min }, '−'),
      value,
      h('button', { type: 'button', 'aria-label': 'יותר', onclick: () => move(1), disabled: shown >= o.max }, '+'));
    const follow = o.nullable ? h('button', { type: 'button', class: `kx-link${stored === null ? ' is-on' : ''}`, onclick: () => set(path, null) }, stored === null ? 'לפי הסניף' : 'איפוס לפי הסניף') : null;
    return h('div', { class: 'kx-row' }, textOf(label, hint), h('div', { class: 'kx-end' }, box, follow));
  }

  const section = (title, hint) => h('h3', { class: 'kx-sec' }, title, hint ? h('small', null, hint) : null);
  const note = (text, tone) => h('p', { class: `kx-note${tone ? ` is-${tone}` : ''}` }, text);
  const info = (label, value, cls) => h('div', { class: 'kx-row kx-info' }, h('span', null, label), h('b', { class: cls || '' , dir: 'auto' }, value === null || value === undefined || value === '' ? '—' : String(value)));
  const action = (label, hint, onclick, tone) => h('button', { type: 'button', class: `kx-action${tone ? ` is-${tone}` : ''}`, onclick }, h('b', null, label), hint ? h('small', null, hint) : null);

  // ---- the tabs -----------------------------------------------------------------------------------------------------------
  const TABS = [
    ['overview', 'סקירה'], ['stock', 'מלאי'], ['menu', 'תפריט'], ['display', 'מסכים'], ['ads', 'מודעות'], ['timing', 'זמנים'], ['lang', 'שפות'],
    ['battery', 'סוללה'], ['device', 'מכשיר'], ['updates', 'עדכונים'], ['diag', 'אבחון'],
  ];
  // one 24-px outline icon per tab (stroke styled in kiosk-admin.css); the button text stays the label alone
  const TAB_ICONS = {
    overview: 'M4 11 12 4l8 7v9H4zM10 20v-6h4v6',
    stock: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
    menu: 'M5 4h11l3 3v13H5zM8 9h8M8 13h8M8 17h5',
    display: 'M3 5h18v11H3zM8 20h8M12 16v4',
    ads: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M16 9.5h.01',
    timing: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
    lang: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3.2 3.4 3.2 14.6 0 18M12 3c-3.2 3.4-3.2 14.6 0 18',
    battery: 'M3 8h15v8H3zM18 10.5h3v3h-3zM6 11v2M9 11v2',
    device: 'M6 3h12v18H6zM11 18h2',
    updates: 'M20 12a8 8 0 1 0-2.4 5.7M20 4.5V10h-5.5',
    diag: 'M3 12h4l2.5-6 4 12 2.5-6H21',
  };

  // pieces that change by themselves (the charge, the connection) are redrawn on their own every two seconds, so a tap on a
  // control is never lost to a redraw of the whole tab
  const LIVE = {
    cards() {
      const B = window.KioskBattery;
      const shift = window.KioskShift;
      const D = window.KioskDevice;
      const level = B ? B.level : null;
      const charging = B ? B.charging : null;
      // green = fine or charging, orange = 30 % or less, red = 15 % or less; the state is always also written out
      const tone = level === null ? '' : charging ? 'good' : level <= 15 ? 'bad' : level <= 30 ? 'warn' : 'good';
      const state = level === null ? 'אין נתון מהמכשיר' : charging ? 'בטעינה' : charging === false ? 'לא בטעינה' : '';
      return h('div', { class: 'kx-cards', 'data-live': 'cards' },
        h('div', { class: `kx-card kx-battery ${tone ? `is-${tone}` : ''}` },
          h('div', { class: 'kx-ring', style: `--p:${level === null ? 0 : level}%` }, h('strong', { dir: 'ltr' }, level === null ? '—' : `${level}%`)),
          h('div', { class: 'kx-battery-copy' },
            h('small', null, 'סוללה'),
            state ? h('span', { class: `kx-pill${level === null ? ' is-quiet' : ''}` }, state) : null,
            h('span', null, level === null ? 'אין קריאה מהמכשיר' : level <= 15 && !charging ? 'כמעט ריקה, חברו למטען' : level <= 30 && !charging ? 'נמוכה' : 'תקינה'))),
        h('div', { class: 'kx-card' },
          h('small', null, 'חיבור לשרת'),
          h('strong', { class: D && D.ok ? 'is-good' : 'is-warn' }, navigator.onLine === false ? 'אין רשת' : D && D.ok ? 'מחובר' : D && D.error === 'not_ready' ? 'ממתין לעדכון שרת' : 'לא ידוע'),
          h('span', null, `דיווח אחרון: ${ago(D && D.lastAt)}`)),
        h('div', { class: 'kx-card' },
          h('small', null, 'במשמרת עכשיו'),
          h('strong', null, shift && shift.people.length ? shift.people.join(', ') : '—'),
          h('span', null, shift && shift.closesAt ? `סגירה ב־${shift.closesAt}` : 'אין זמן סגירה')),
        h('div', { class: 'kx-card' },
          h('small', null, 'הטאבלט'),
          h('strong', null, C.deviceName),
          h('span', null, C.branchName('he') ? `סניף ${C.branchName('he')}` : 'הסניף עוד לא ידוע')));
    },
    // the alert ladder of the battery tab: one chip per 5 % from the level where the alerts start; lit = already reached
    ladder() {
      const B = window.KioskBattery;
      const level = B ? B.level : null;
      const charging = B ? B.charging : null;
      const start = Math.floor(cget('battery.alertPercent') / 5) * 5;
      const here = level === null ? null : Math.max(5, Math.ceil(level / 5) * 5);
      const steps = [];
      for (let p = start; p >= 5; p -= 5) steps.push(p);
      return h('div', { class: 'kx-row kx-row-stack', 'data-live': 'ladder' },
        textOf('סולם ההתראות', steps.length ? `${steps.length} התראות, מ־${steps[0]}% ועד 5%, אחת לכל 5%. כל שלב מצלצל פעם אחת בכל ירידה.` : 'אין שלבים'),
        h('div', { class: 'kx-ladder', role: 'list', 'aria-label': 'שלבי ההתראה' }, steps.map((p) => h('span', {
          role: 'listitem', class: `kx-step${level !== null && charging !== true && level <= p ? ' is-hit' : ''}${p === here && charging !== true ? ' is-here' : ''}`,
        }, `${p}%`))));
    },
    reading() {
      const B = window.KioskBattery;
      const level = B ? B.level : null;
      return h('div', { class: 'kx-row kx-info', 'data-live': 'reading' }, h('span', null, 'הטעינה עכשיו'),
        h('b', { dir: 'auto' }, level === null ? '—' : `${level}%${B.charging === true ? ' · בטעינה' : B.charging === false ? ' · לא בטעינה' : ''}`));
    },
  };
  function liveTick() {
    if (!root || previewing) { paintStatus(); return; }
    root.querySelectorAll('[data-live]').forEach((node) => { const make = LIVE[node.dataset.live]; if (make) node.replaceWith(make()); });
    paintStatus();
  }

  // ---- live stock (owner, 2026-11-06): the dashboard's live-stock list, edited from here too ---------------------------------------
  // GET/POST {apiBase}/stock (src/app/api/kiosk/stock): the categories marked live on the dashboard (sandwiches & toasts, pastries,
  // shakes, cookies), each item and each of its types: in stock / sold out and, when counted, how many. The portal applies the
  // dashboard's rules: only during opening hours, a count of 0 is sold out, every change is in the menu's audit log ("מהקיוסק").
  let stock = { state: 'idle', open: true, categories: [], busy: '' };
  // the portal's kiosk endpoints the panel writes to ({apiBase}/stock, {apiBase}/menu-edit), with the kiosk key
  const stockCall = (method, payload) => portalCall('stock', method, payload);
  async function portalCall(path, method, payload) {
    const url = C.apiBase ? `${C.apiBase}/${path}` : '';
    const headers = C.headers();
    if (!url || !headers) return { ok: false, error: 'not_configured' };
    const abort = new AbortController();
    const cut = setTimeout(() => abort.abort(), 10000);
    try {
      // no name = the one tablet the portal already knows (like the device report): then the name is left out
      const res = await fetch(method === 'GET' && C.device ? `${url}?device=${encodeURIComponent(C.device)}` : url, {
        method, cache: 'no-store', signal: abort.signal,
        headers: method === 'GET' ? headers : { 'Content-Type': 'application/json', ...headers },
        body: method === 'GET' ? undefined : JSON.stringify({ device: C.device || undefined, ...payload }),
      });
      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      return data && typeof data === 'object' ? { status: res.status, ...data } : { ok: false, status: res.status, error: 'bad_answer' };
    } catch (_) {
      return { ok: false, error: 'offline' };
    } finally { clearTimeout(cut); }
  }
  async function loadStock() {
    stock.state = 'loading';
    if (tab === 'stock') render();
    const r = await stockCall('GET');
    if (r.ok && Array.isArray(r.categories)) stock = { state: 'ready', open: r.open !== false, categories: r.categories, busy: '' };
    else stock.state = r.error === 'not_configured' ? 'no_key' : 'error';
    if (tab === 'stock') render();
  }
  const STOCK_ERRORS = { closed: 'מחוץ לשעות הפעילות: אפשר לעדכן מלאי רק כשהסניף פתוח.', not_live: 'הפריט הזה לא ברשימת המלאי של הסניף.', rate_limited: 'יותר מדי שינויים ברגע. נסו שוב בעוד דקה.', offline: 'אין חיבור לרשת. השינוי לא נשמר.' };
  async function changeStock(key, payload) {
    if (stock.busy) return;
    stock.busy = key;
    render();
    const r = await stockCall('POST', payload);
    stock.busy = '';
    if (r.ok && Array.isArray(r.categories)) { stock.categories = r.categories; say('נשמר. התפריט מתעדכן מיד.'); }
    else { say(STOCK_ERRORS[r.error] || 'השינוי לא נשמר. נסו שוב.'); if (r.error === 'closed') stock.open = false; }
    render();
  }
  function stockRow(label, entry, itemUid, typeUid) {
    const key = `${itemUid}:${typeUid || ''}`;
    const busy = stock.busy === key;
    const off = !stock.open || !!stock.busy;
    const q = entry.quantity;
    const send = (payload) => changeStock(key, { itemUid, typeUid: typeUid || null, ...payload });
    const counter = h('div', { class: 'kx-stepper', 'aria-label': `כמות: ${label}` },
      h('button', { type: 'button', 'aria-label': `פחות ${label}`, disabled: off || !(q > 0), onclick: () => send({ quantity: q - 1 }) }, '−'),
      h('output', { class: 'kx-num' }, q === null ? '—' : `${q}`),
      h('button', { type: 'button', 'aria-label': `יותר ${label}`, disabled: off || q >= 999, onclick: () => send({ quantity: q === null ? 1 : q + 1 }) }, '+'));
    const sw = h('button', { type: 'button', role: 'switch', 'aria-checked': String(entry.available), class: 'kx-switch', 'aria-label': `${label}: ${entry.available ? 'במלאי' : 'אזל'}`, disabled: off,
      onclick: () => send(entry.available ? { available: false } : (q === 0 ? { available: true, quantity: 1 } : { available: true })) }, h('i'));
    const state = busy ? 'שומר…' : entry.available ? (q === null ? 'במלאי' : `במלאי · ${q}`) : 'אזל';
    return h('div', { class: `kx-row kx-stock${entry.available ? '' : ' is-out'}` }, textOf(label, state), h('div', { class: 'kx-end' }, counter, sw));
  }
  function stockTab() {
    if (stock.state === 'idle') { setTimeout(loadStock, 0); return [note('טוען את המלאי…')]; }
    if (stock.state === 'loading' && !stock.categories.length) return [note('טוען את המלאי…')];
    if (stock.state === 'no_key') return [note('הקיוסק לא מחובר לפורטל (אין כתובת או מפתח). אפשר לעדכן מלאי מלוח הבקרה של הבעלים.', 'warn')];
    if (stock.state === 'error' && !stock.categories.length) return [note('לא הצלחנו לטעון את המלאי.', 'warn'), action('לנסות שוב', null, () => loadStock())];
    const out = [
      stock.open ? note('אותה רשימה כמו המלאי החי בלוח הבקרה: שינוי כאן מופיע בתפריט מיד, וגם בלוח הבקרה. כמות 0 = אזל.')
        : note('הסניף סגור עכשיו: אפשר לראות את המלאי, ולעדכן רק בשעות הפעילות.', 'warn'),
    ];
    if (!stock.categories.length) out.push(note('אין קטגוריות של מלאי חי בסניף. בוחרים אותן בעורך התפריט בלוח הבקרה.'));
    stock.categories.forEach((c) => {
      let header = '';
      const head = (title) => { if (header !== title) { header = title; out.push(section(title)); } };
      c.items.forEach((item) => {
        if (item.types.length) {
          head(`${c.name} · ${item.name}`);
          item.types.forEach((t) => out.push(stockRow(t.name, t, item.uid, t.uid)));
        } else {
          head(c.name);
          out.push(stockRow(item.name, item, item.uid, null));
        }
      });
    });
    out.push(action('רענון המלאי', 'טוען שוב מהפורטל', () => loadStock()));
    return out;
  }

  // ---- the menu editor (owner, 2026-11-06: the full editor on the tablet, behind the staff PIN) -----------------------------------
  // GET/POST {apiBase}/menu-edit (src/app/api/kiosk/menu-edit): every category, item and type; rename, reprice, add, remove. The
  // portal applies the dashboard's rules: only during opening hours, the tablet's own branch, each change in the menu's audit log.
  let menu = { state: 'idle', open: true, categories: [], busy: false, openCat: '' };
  async function loadMenu() {
    menu.state = 'loading';
    if (tab === 'menu') render();
    const r = await portalCall('menu-edit', 'GET');
    if (r.ok && Array.isArray(r.categories)) Object.assign(menu, { state: 'ready', open: r.open !== false, categories: r.categories });
    else menu.state = r.error === 'not_configured' ? 'no_key' : 'error';
    if (tab === 'menu') render();
  }
  const MENU_ERRORS = { closed: 'מחוץ לשעות הפעילות: אפשר לערוך את התפריט רק כשהסניף פתוח.', not_found: 'הפריט כבר לא בתפריט. מרעננים…', rate_limited: 'יותר מדי שינויים ברגע. נסו שוב בעוד דקה.', offline: 'אין חיבור לרשת. השינוי לא נשמר.', bad_request: 'משהו בשדות לא תקין (שם עד 80 תווים, מחיר בספרות).', not_ready: 'עדכון מסד הנתונים של עריכת התפריט עוד לא הוחל.' };
  async function menuEdit(payload, done) {
    if (menu.busy) return false;
    menu.busy = true;
    render();
    const r = await portalCall('menu-edit', 'POST', payload);
    menu.busy = false;
    if (r.ok && Array.isArray(r.categories)) { menu.categories = r.categories; say(done || 'נשמר. התפריט מתעדכן מיד.'); render(); return true; }
    say(MENU_ERRORS[r.error] || 'השינוי לא נשמר. נסו שוב.');
    if (r.error === 'closed') menu.open = false;
    if (r.error === 'not_found') loadMenu(); else render();
    return false;
  }
  const PRICE_RE = /^$|^[0-9]+(\.[0-9]{1,2})?(\/[0-9]+(\.[0-9]{1,2})?)?$/;
  // one dialog for adding and editing: a name and an optional price
  function entryDialog(title, start, onSave) {
    const nameIn = h('input', { type: 'text', value: start.name || '', maxlength: '80', class: 'kx-input', 'aria-label': 'שם', placeholder: 'שם' });
    const priceIn = h('input', { type: 'text', value: start.price || '', maxlength: '20', inputmode: 'decimal', dir: 'ltr', class: 'kx-input', 'aria-label': start.priceLabel || 'מחיר (₪)', placeholder: start.priceLabel || 'מחיר (₪)' });
    const msg = h('p', { class: 'kx-note is-warn', hidden: true });
    const d = dialog(title, [nameIn, priceIn, h('p', { class: 'kx-note' }, start.priceHint || 'מחיר בספרות (למשל 14 או 20/24). ריק = בלי מחיר.'), msg], [
      h('button', { type: 'button', class: 'kx-btn', onclick: () => d.close() }, 'ביטול'),
      h('button', { type: 'button', class: 'kx-btn is-primary', onclick: async () => {
        const fail = (t) => { msg.textContent = t; msg.hidden = false; };
        const name = nameIn.value.trim();
        const price = priceIn.value.trim();
        if (!name) return fail('צריך שם.');
        if (!PRICE_RE.test(price)) return fail('מחיר בספרות בלבד (למשל 14 או 20/24).');
        d.close();
        await onSave(name, price);
      } }, 'שמירה'),
    ]);
    setTimeout(() => nameIn.focus(), 60);
  }
  function menuTab() {
    if (menu.state === 'idle') { setTimeout(loadMenu, 0); return [note('טוען את התפריט…')]; }
    if (menu.state === 'loading' && !menu.categories.length) return [note('טוען את התפריט…')];
    if (menu.state === 'no_key') return [note('הקיוסק לא מחובר לפורטל (אין כתובת או מפתח). אפשר לערוך את התפריט מלוח הבקרה של הבעלים.', 'warn')];
    if (menu.state === 'error' && !menu.categories.length) return [note('לא הצלחנו לטעון את התפריט.', 'warn'), action('לנסות שוב', null, () => loadMenu())];
    const off = !menu.open || menu.busy;
    const out = [menu.open
      ? note('עריכת התפריט של הסניף: שם ומחיר, הוספה ומחיקה של פריטים וסוגים. כל שינוי מופיע בתפריט מיד, ונרשם ביומן.')
      : note('הסניף סגור עכשיו: אפשר לראות את התפריט, ולערוך רק בשעות הפעילות.', 'warn')];
    const btn = (label, aria, onclick, tone) => h('button', { type: 'button', class: `kx-mini${tone ? ` is-${tone}` : ''}`, 'aria-label': aria, disabled: off, onclick }, label);
    const priceOf = (p) => (p ? `₪${p}` : 'בלי מחיר');
    menu.categories.forEach((c) => {
      const opened = menu.openCat === c.id;
      out.push(h('button', { type: 'button', class: `kx-row kx-cat${opened ? ' is-open' : ''}`, 'aria-expanded': String(opened), onclick: () => { menu.openCat = opened ? '' : c.id; render(); } },
        textOf(c.name, `${c.items.length} פריטים`), svg(opened ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6', 'kx-chev')));
      if (!opened) return;
      out.push(section(c.name));
      c.items.forEach((item) => {
        out.push(h('div', { class: 'kx-row kx-menu-item' }, textOf(item.name, item.types.length ? `${item.types.length} סוגים${item.price ? ` · ${priceOf(item.price)}` : ''}` : priceOf(item.price)),
          h('div', { class: 'kx-end' },
            btn('עריכה', `עריכה: ${item.name}`, () => entryDialog(`עריכה: ${item.name}`, { name: item.name, price: item.price }, (name, price) =>
              menuEdit({ op: 'update', itemUid: item.uid, typeUid: null, ...(name !== item.name ? { name } : {}), ...(price !== item.price ? { price } : {}) }))),
            btn('+ סוג', `הוספת סוג ל${item.name}`, () => entryDialog(`סוג חדש ל${item.name}`, { priceLabel: 'תוספת מחיר (₪)', priceHint: 'כמה הסוג מוסיף למחיר הפריט. ריק = אותו מחיר.' }, (name, price) =>
              menuEdit({ op: 'add_type', itemUid: item.uid, name, ...(price ? { price } : {}) }, 'הסוג נוסף.'))),
            btn('מחיקה', `מחיקה: ${item.name}`, () => confirmBox('מחיקת פריט', `למחוק את "${item.name}"${item.types.length ? ` ואת ${item.types.length} הסוגים שלו` : ''} מהתפריט?`, 'מחיקה', () =>
              menuEdit({ op: 'remove_item', itemUid: item.uid }, 'הפריט נמחק.')), 'bad'))));
        item.types.forEach((t) => {
          out.push(h('div', { class: 'kx-row kx-menu-type' }, textOf(`· ${t.name}`, t.price ? `+₪${t.price}` : 'אותו מחיר'),
            h('div', { class: 'kx-end' },
              btn('עריכה', `עריכה: ${item.name} ${t.name}`, () => entryDialog(`עריכה: ${t.name}`, { name: t.name, price: t.price, priceLabel: 'תוספת מחיר (₪)' }, (name, price) =>
                menuEdit({ op: 'update', itemUid: item.uid, typeUid: t.uid, ...(name !== t.name ? { name } : {}), ...(price !== t.price ? { price } : {}) }))),
              btn('מחיקה', `מחיקה: ${item.name} ${t.name}`, () => confirmBox('מחיקת סוג', `למחוק את "${t.name}" מ"${item.name}"?`, 'מחיקה', () =>
                menuEdit({ op: 'remove_type', typeUid: t.uid }, 'הסוג נמחק.')), 'bad'))));
        });
      });
      out.push(action(`הוספת פריט ל${c.name}`, 'שם ומחיר', () => { if (!off) entryDialog(`פריט חדש ב${c.name}`, {}, (name, price) => menuEdit({ op: 'add_item', categoryId: c.id, name, ...(price ? { price } : {}) }, 'הפריט נוסף.')); }));
    });
    out.push(action('רענון התפריט', 'טוען שוב מהפורטל', () => loadMenu()));
    return out;
  }

  function overview() {
    return [
      LIVE.cards(),
      !C.registered ? note('הטאבלט עדיין לא רשום בשרת. ההגדרות נשמרות על הטאבלט בלבד עד שעדכון מסד הנתונים של הקיוסק יוחל.', 'warn') : null,
      section('פעולות מהירות'),
      action('סנכרון עכשיו', 'מביא מודעות והגדרות, שולח דיווח ומי במשמרת', async () => {
        say('מסנכרן…');
        if (window.__kioskAttract) await window.__kioskAttract.fetchContent(true);
        if (window.KioskShift) await window.KioskShift.poll();
        if (window.KioskDevice) await window.KioskDevice.report('panel');
        await C.flush();
        say('הסנכרון הסתיים');
        render();
      }),
      action('טעינת המסך מחדש', 'חוזר למסך הפתיחה', () => { if (hasNative()) ask('reload'); else location.reload(); }),
      action('תצוגה מקדימה', 'מסתיר את הפאנל כדי לראות את הקיוסק כמו שהלקוחות רואים אותו', () => setPreview(true)),
      note('להצגת הטעינה בלי לפתוח את הפאנל: החליקו מהקצה העליון של המסך כלפי מטה.'),
    ];
  }

  function display() {
    return [
      section('הכותרת העליונה', 'מה כתוב בסרגל בראש המסך'),
      toggle('להציג מי במשמרת', 'שמות פרטיים בלבד, מהמשמרות שפורסמו. לא מוצג כשאין משמרת.', 'display.showEmployees'),
      toggle('להציג מתי סוגרים', 'כתוב "סגירה ב־" והשעה.', 'display.showClosing'),
      segment('מאיפה לקחת את שעת הסגירה', 'סוף המשמרת הוא סוף שרשרת המשמרות: אם משמרת אחרת מתחילה בדיוק כשהקודמת נגמרת, הסגירה היא בסוף האחרונה.', 'display.closingSource',
        [['shift_then_hours', 'משמרת, ואחרת שעות'], ['shift', 'סוף המשמרת'], ['hours', 'שעות הפעילות']]),
      toggle('להציג את שם הסניף', null, 'display.showBranch'),
      toggle('להציג את מספר הפריטים בתפריט', 'בכותרת, כשאין מקום למשמרת.', 'display.showItemCount'),
      section('מסך הפתיחה והמועדון'),
      toggle('שורת "פרויקט שנוצר ביוזמת ג׳ון"', 'מתחת למסך הפתיחה.', 'display.showCredit'),
      toggle('להציג את מועדון הלקוחות', 'כפתור ההצטרפות, הכרטיס במסך הבחירה, והמודעה על המועדון. כבוי: אין הרשמה בקיוסק.', 'display.clubEnabled'),
    ];
  }

  function ads() {
    const list = (window.KioskContent && window.KioskContent.ads) || [];
    const hidden = new Set(cget('ads.hiddenIds') || []);
    const KIND = { location: 'מיקום', feedback: 'משוב', loyalty: 'מועדון', hours: 'שעות', menu_highlight: 'מהתפריט', custom: 'כללי' };
    return [
      section('איך המודעות מתנהגות'),
      toggle('חצים בצדדים', 'חץ ימני וחץ שמאלי לחזרה למודעה שפספסו.', 'ads.arrows'),
      toggle('החלקה עם האצבע', 'גוררים הצידה כדי לעבור למודעה אחרת.', 'ads.swipe'),
      toggle('מעבר אוטומטי', 'מודעה אחרי מודעה. כבוי: נשארים על המודעה עד שנוגעים.', 'ads.autoPlay'),
      toggle('להמשיך בסיבוב', 'אחרי האחרונה חוזרים לראשונה, ולהפך.', 'ads.loop'),
      segment('איך עוברים בין מודעות', null, 'ads.transition', [['slide', 'החלקה'], ['fade', 'מעבר הדרגתי']]),
      segment('מה קורה בלחיצה על מודעה', 'לחיצה על החצים או גרירה אינן לחיצה.', 'ads.tapAction', [['ad', 'הפעולה של המודעה, אחרת המסך הראשי'], ['main', 'תמיד המסך הראשי']]),
      stepper('כמה זמן כל מודעה', 'בשניות. "לפי הסניף" = הזמן שנקבע בעמוד הבעלים.', 'ads.slideSeconds', { min: 3, max: 60, step: 1, unit: 'שנ׳', nullable: true, fallback: () => C.branchTiming.slideSeconds }),
      section('המודעות בטאבלט הזה', 'כיבוי כאן מסתיר מודעה רק בטאבלט הזה. טקסט, תמונה וסדר נערכים בעמוד הבעלים.'),
      list.length ? list.map((ad) => h('div', { class: 'kx-row' }, h('div', { class: 'kx-text' }, h('b', null, ad.title), h('small', null, KIND[ad.kind] || '')),
        h('button', { type: 'button', role: 'switch', 'aria-checked': String(!hidden.has(ad.id)), class: 'kx-switch', 'aria-label': ad.title,
          onclick: () => { const next = new Set(hidden); if (next.has(ad.id)) next.delete(ad.id); else next.add(ad.id); set('ads.hiddenIds', [...next]); } }, h('i'))))
        : note('עדיין לא הגיעו מודעות מהשרת, לכן מוצגות מודעות ברירת המחדל. לחצו "סנכרון עכשיו" בסקירה.'),
    ];
  }

  function timing() {
    const t = C.branchTiming;
    return [
      section('איפוס פרטיות', 'אחרי זמן בלי נגיעה המסך מתנקה, כדי שפרטים לא יישארו לאף אחד.'),
      stepper('זמן בלי פעילות עד האזהרה', 'בשניות.', 'timing.idleSeconds', { min: 30, max: 300, step: 10, unit: 'שנ׳', nullable: true, fallback: () => t.idleSeconds }),
      stepper('זמן האזהרה "עדיין כאן?"', 'בשניות, עד שהמסך מתנקה.', 'timing.graceSeconds', { min: 5, max: 30, step: 5, unit: 'שנ׳', nullable: true, fallback: () => t.graceSeconds }),
      stepper('כמה זמן מסך האישור נשאר', 'אחרי הרשמה. בשניות.', 'timing.successSeconds', { min: 5, max: 60, step: 5, unit: 'שנ׳' }),
      section('תוכן'),
      stepper('כל כמה זמן לרענן מודעות והגדרות', 'בדקות, כשהמסך בפתיחה. שינוי בתפריט מגיע מיד.', 'timing.contentRefreshMinutes', { min: 5, max: 120, step: 5, unit: 'דק׳' }),
      note('השפה חוזרת לברירת המחדל באותם זמנים: בסוף כל ביקור, וגם כשמישהו משאיר את מסך הפתיחה בשפה אחרת ללא נגיעה.'),
    ];
  }

  function langs() {
    const NAMES = { he: 'עברית', en: 'English', ar: 'العربية' };
    const enabled = cget('language.enabled') || [];
    const def = cget('language.default');
    return [
      section('שפות בקיוסק'),
      ['he', 'en', 'ar'].map((code) => {
        const on = enabled.indexOf(code) >= 0;
        return h('div', { class: 'kx-row' }, textOf(NAMES[code], code === def ? 'שפת ברירת המחדל' : null),
          h('button', { type: 'button', role: 'switch', 'aria-checked': String(on), class: 'kx-switch', 'aria-label': NAMES[code],
            onclick: () => {
              if (on && code === def) { say('שפת ברירת המחדל חייבת להיות מופעלת.'); return; }
              if (on && enabled.length === 1) { say('חייבת להישאר שפה אחת לפחות.'); return; }
              set('language.enabled', on ? enabled.filter((l) => l !== code) : [...enabled, code]);
            } }, h('i')));
      }),
      segment('שפת ברירת המחדל', 'הקיוסק מתחיל בה וחוזר אליה אחרי כל ביקור.', 'language.default', enabled.map((code) => [code, NAMES[code]])),
      toggle('להציג את מתג השפות', 'כבוי: אין בחירה של שפה, הקיוסק רק בשפת ברירת המחדל. גם כשיש שפה אחת בלבד אין מתג.', 'language.showSwitch'),
    ];
  }

  function battery() {
    const B = window.KioskBattery;
    const alertOn = cget('battery.alertEnabled');
    const critOn = cget('battery.criticalEnabled');
    const alertAt = cget('battery.alertPercent');
    return [
      section('איפה הטעינה מוצגת', 'הטעינה מיועדת לצוות, לא ללקוחות.'),
      segment('תצוגה', 'מגירה = החלקה מהקצה העליון כלפי מטה. פינה = תג קטן תמיד על המסך (לבדיקות).', 'battery.display', [['tray', 'מגירה מלמעלה'], ['corner', 'תג בפינה'], ['hidden', 'מוסתר']]),
      LIVE.reading(),
      section('התראה למפתח', 'ההתראה נשלחת למפתח בלבד (לא לבעלים) ורק כשהטאבלט לא בטעינה. התראה בכל ירידה של 5%, החל מהרמה שנקבעה כאן, ושוב מההתחלה אחרי טעינה.'),
      toggle('להתריע כשהטעינה יורדת', null, 'battery.alertEnabled'),
      stepper('להתחיל להתריע מ־', 'באחוזים. ההתראה הראשונה בדיוק ברמה הזאת, ואחריה כל 5% למטה.', 'battery.alertPercent', { min: 10, max: 90, step: 5, unit: '%', fallback: () => 50 }),
      LIVE.ladder(),
      toggle('התראה דחופה נוספת', 'השלבים הנמוכים נשלחים עם כותרת דחופה, כשהסוללה כמעט נגמרת.', 'battery.criticalEnabled'),
      critOn ? stepper('התראה דחופה מתחת ל־', `חייב להיות נמוך מ־${alertAt}%.`, 'battery.criticalPercent', { min: 5, max: Math.max(5, Math.min(40, alertAt - 5)), step: 5, unit: '%', fallback: () => 15 }) : null,
      !alertOn ? note('ההתראה כבויה: המפתח לא יקבל הודעה על סוללה נמוכה.', 'warn') : null,
      action('שליחת התראת בדיקה למפתח', 'כך תיראה ההתראה בטלפון. דורש חיבור לשרת.', async () => {
        const D = window.KioskDevice;
        say('שולח…');
        const res = D && D.test ? await D.test() : { ok: false };
        say(res.ok ? 'נשלחה התראת בדיקה למפתח' : res.error === 'not_ready' ? 'עדכון השרת של הקיוסק עדיין לא הוחל' : 'השליחה נכשלה. בדקו חיבור.');
      }),
    ];
  }

  function device() {
    if (!hasNative()) {
      return [note('פעולות המכשיר (סיבוב מסך, בהירות, Wi-Fi, יציאה ממצב קיוסק, החלפת קוד) זמינות אחרי עדכון האפליקציה בטאבלט לגרסה 0.3 ומעלה. כל שאר ההגדרות כאן עובדות כבר עכשיו.', 'warn')];
    }
    const n = native || {};
    const orient = n.orient || 'auto';
    const perf = n.perf || 'auto';
    const bright = typeof n.brightness === 'number' ? n.brightness : -1;
    const seg = (label, hint, current, options, name) => h('div', { class: 'kx-row kx-row-stack' }, textOf(label, hint),
      h('div', { class: 'kx-seg', role: 'radiogroup', 'aria-label': label }, options.map(([value, text]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(current === value), class: current === value ? 'is-on' : '',
        onclick: () => { const res = ask(name, value); if (res.ok === false) say('הפעולה נכשלה'); else { loadInfo(); render(); } } }, text))));
    return [
      section('המסך'),
      seg('כיוון המסך', 'אוטומטי = לפי איך שמחזיקים את הטאבלט.', orient, [['auto', 'אוטומטי'], ['portrait', 'לאורך'], ['landscape', 'לרוחב']], 'orient'),
      seg('מצב ביצועים', 'קל = בלי צללים, אותן אנימציות. אוטומטי בודק מהירות. נטען מחדש.', perf, [['auto', 'אוטומטי'], ['lite', 'קל'], ['full', 'מלא']], 'perf'),
      h('div', { class: 'kx-row' }, textOf('בהירות המסך', bright < 0 ? 'ברירת מחדל של המכשיר' : null),
        h('div', { class: 'kx-end' }, h('div', { class: 'kx-stepper' },
          h('button', { type: 'button', 'aria-label': 'פחות', disabled: bright >= 0 && bright <= 10, onclick: () => { ask('brightness', String(Math.max(10, (bright < 0 ? 60 : bright) - 10))); loadInfo(); render(); } }, '−'),
          h('output', { class: 'kx-num' }, bright < 0 ? 'אוטו׳' : `${bright}`, h('small', null, bright < 0 ? '' : ' %')),
          h('button', { type: 'button', 'aria-label': 'יותר', disabled: bright >= 100, onclick: () => { ask('brightness', String(Math.min(100, (bright < 0 ? 60 : bright) + 10))); loadInfo(); render(); } }, '+')),
          h('button', { type: 'button', class: 'kx-link', onclick: () => { ask('brightness', '-1'); loadInfo(); render(); } }, 'ברירת מחדל'))),
      section('חיבור ותחזוקה'),
      action('הגדרות Wi-Fi', 'פותח את ההגדרות לחמש דקות', () => ask('wifi')),
      action('שחרור המסך ל־5 דקות', 'מאפשר לצאת מהקיוסק זמנית. ננעל שוב לבד.', () => ask('unlock')),
      action('הפעלה מחדש של האפליקציה', 'סוגר ופותח את הקיוסק', () => ask('restart_app')),
      action('הפעלה מחדש של הטאבלט', 'המכשיר כולו. יידרש אישור.', () => ask('reboot'), 'warn'),
      section('קוד הצוות'),
      action('החלפת קוד הצוות', 'דורש את הקוד הנוכחי. קוד חדש: 6 עד 8 ספרות.', () => changePinDialog()),
      section('מצב קיוסק'),
      action('יציאה ממצב קיוסק', 'הטאבלט חוזר למסך הבית הרגיל. לחיצה על אייקון הקיוסק מחזירה.', () => ask('exit'), 'warn'),
      action('תפריט מערכת מתקדם', 'התפריט הקודם, כולל הסרת הקיוסק לחלוטין', () => ask('native_menu'), 'warn'),
    ];
  }

  function updates() {
    if (!hasNative()) return [note('פרטי העדכונים זמינים אחרי עדכון האפליקציה לגרסה 0.3 ומעלה.', 'warn')];
    const n = native || {};
    const lines = String(n.updates || '').split('\n').filter(Boolean);
    return [
      note('האפליקציה בודקת עדכונים בעצמה כל 10 דקות ומתקינה אותם בלי לבקש אישור, ברגע שאין לקוח מול המסך. עדכון שלא מצא רגע פנוי מותקן בכל זאת אחרי 3 שעות.'),
      section('גרסאות'),
      info('גרסת האפליקציה', n.appName ? `${n.appName} (${n.appCode})` : null),
      info('גרסת המסכים (העדכון האחרון)', n.webVersion || 'מובנית באפליקציה'),
      ...lines.map((line) => { const at = line.indexOf(':'); return at > 0 ? info(line.slice(0, at), line.slice(at + 1).trim()) : null; }),
      section('פעולות'),
      action('בדיקת עדכון עכשיו', 'מסכים חדשים מגיעים לבד, כל כמה דקות, ברגע שאין לקוח.', () => { ask('check_updates'); say('בודק עדכונים…'); setTimeout(() => { loadInfo(); render(); }, 4000); }),
      action('ביטול העדכון האחרון של המסכים', 'חוזר לגרסה הקודמת ולא מקבל שוב את הגרסה שבוטלה', () => { const r = ask('undo_web'); say(r.ok ? 'חוזר לגרסה הקודמת…' : 'אין עדכון לבטל. פועלת הגרסה המובנית.'); }, 'warn'),
    ];
  }

  function diag() {
    const P = window.__kioskPerf || {};
    const sync = C.sync;
    const n = native || {};
    return [
      section('מה הטאבלט יודע על עצמו'),
      info('שם המכשיר', `${C.deviceSlug} · ${C.deviceName}${C.device ? '' : ' (ברירת מחדל)'}`),
      info('רשום בשרת', C.registered ? 'כן' : 'עדיין לא'),
      info('הגדרות עודכנו בשרת', C.settingsUpdatedAt ? new Date(C.settingsUpdatedAt).toLocaleString('he-IL') : null),
      info('שינויים שממתינים לשליחה', sync.pending ? 'כן' : 'אין'),
      info('שגיאה אחרונה בשמירה', sync.lastError || null),
      info('גרסת התוכן', window.KioskContent ? window.KioskContent.version : null),
      info('גרסת התפריט', window.__kioskSync ? window.__kioskSync.version : null),
      info('מצב ביצועים', P.decided ? `${P.decided}${P.fps ? ` · ${P.fps} פריימים` : ''}` : null),
      info('מסך', `${window.innerWidth}×${window.innerHeight} · צפיפות ${window.devicePixelRatio}`),
      info('דפדפן', (/Chrome\/(\d+)/.exec(navigator.userAgent) || [])[0] || navigator.userAgent.slice(0, 40)),
      info('אזור זמן של המכשיר', Intl.DateTimeFormat().resolvedOptions().timeZone),
      native ? info('מכשיר', `${n.model || ''} · Android ${n.android || ''}`) : null,
      native && n.freeMb !== undefined ? info('מקום פנוי', `${n.freeMb} MB`) : null,
      section('תחזוקה'),
      action('שינוי שם המכשיר במערכת', 'מתקדם: הזהות שבה הטאבלט מזוהה בשרת. כך מחברים טאבלט נוסף לסניף אחר.', () => identityDialog()),
      action('ניקוי המודעות השמורות', 'מוחק את העותק השמור ומביא מחדש', () => { try { localStorage.removeItem('sarcafe.kiosk.content.v1'); } catch (_) { /* nothing stored */ } say('נוקה. מביא מחדש…'); if (window.__kioskAttract) window.__kioskAttract.fetchContent(true); }),
      action('החזרת כל ההגדרות לברירת המחדל', 'כל מה שנקבע בפאנל חוזר לברירת המחדל', () => confirmBox('להחזיר הכול לברירת המחדל?', 'כל ההגדרות שנקבעו בפאנל יחזרו לברירת המחדל. מודעות ותוכן לא ישתנו.', 'החזרה', () => { C.resetAll(); say('ההגדרות הוחזרו'); }), 'warn'),
    ];
  }

  // ---- little dialogs ---------------------------------------------------------------------------------------------------
  function dialog(title, bodyNodes, actions) {
    const box = h('div', { class: 'kx-dialog', role: 'dialog', 'aria-modal': 'true' }, h('h3', null, title), ...bodyNodes, h('div', { class: 'kx-dialog-actions' }, actions));
    const shade = h('div', { class: 'kx-shade' }, box);
    root.append(shade);
    return { close: () => shade.remove(), box };
  }
  function confirmBox(title, text, okLabel, onOk) {
    const d = dialog(title, [h('p', null, text)], [
      h('button', { type: 'button', class: 'kx-btn', onclick: () => d.close() }, 'ביטול'),
      h('button', { type: 'button', class: 'kx-btn is-primary', onclick: () => { d.close(); onOk(); } }, okLabel),
    ]);
  }
  function identityDialog() {
    const input = h('input', { type: 'text', value: C.device || '', placeholder: 'givat-haviva-1', dir: 'ltr', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false', maxlength: '40', class: 'kx-input', 'aria-label': 'שם המכשיר' });
    const msg = h('p', { class: 'kx-note is-warn', hidden: true });
    const d = dialog('שם המכשיר במערכת', [
      h('p', null, 'אותיות אנגליות קטנות, ספרות ומקף (למשל givat-haviva-1). השם חייב להיות רשום קודם בעמוד הבעלים, אחרת הטאבלט ימשיך עם הגדרות ברירת המחדל. השארת השדה ריק מחזירה לטאבלט הראשון.'),
      input, msg,
    ], [
      h('button', { type: 'button', class: 'kx-btn', onclick: () => d.close() }, 'ביטול'),
      h('button', { type: 'button', class: 'kx-btn is-primary', onclick: () => {
        const ok = C.setDevice(input.value);
        if (!ok) { msg.textContent = 'שם לא תקין.'; msg.hidden = false; return; }
        d.close();
        say('השם הוחלף. מביא הגדרות…');
        if (window.__kioskAttract) window.__kioskAttract.fetchContent(true);
        render();
      } }, 'שמירה'),
    ]);
    setTimeout(() => input.focus(), 60);
  }
  function changePinDialog() {
    const mk = (label) => h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '8', autocomplete: 'off', class: 'kx-input', 'aria-label': label, placeholder: label, dir: 'ltr' });
    const oldPin = mk('הקוד הנוכחי');
    const newPin = mk('קוד חדש (6 עד 8 ספרות)');
    const again = mk('קוד חדש שוב');
    const msg = h('p', { class: 'kx-note is-warn', hidden: true });
    const d = dialog('החלפת קוד הצוות', [oldPin, newPin, again, msg], [
      h('button', { type: 'button', class: 'kx-btn', onclick: () => d.close() }, 'ביטול'),
      h('button', { type: 'button', class: 'kx-btn is-primary', onclick: () => {
        const fail = (text) => { msg.textContent = text; msg.hidden = false; };
        if (!/^\d{6,8}$/.test(newPin.value)) return fail('הקוד החדש חייב להיות 6 עד 8 ספרות.');
        if (newPin.value !== again.value) return fail('הקודים החדשים לא זהים.');
        const res = ask('set_pin', `${oldPin.value}\n${newPin.value}`);
        if (res.ok) { d.close(); say('הקוד הוחלף'); } else fail(res.error === 'locked' ? 'נעול זמנית אחרי ניסיונות שגויים.' : 'הקוד הנוכחי שגוי.');
      } }, 'החלפה'),
    ]);
    setTimeout(() => oldPin.focus(), 60);
  }

  // ---- the shell ---------------------------------------------------------------------------------------------------------
  let statusEl;
  function paintStatus() {
    if (!statusEl) return;
    const sync = C.sync;
    let text;
    let cls = '';
    if (toast) { text = toast; cls = 'is-info'; }
    else if (sync.saving) { text = 'שומר…'; cls = 'is-info'; }
    else if (sync.pending) { text = sync.lastError === 'not_ready' || !sync.registered ? 'נשמר בטאבלט בלבד' : 'ממתין לשליחה'; cls = 'is-warn'; }
    else { text = 'הכול נשמר'; cls = 'is-good'; }
    statusEl.textContent = text;
    statusEl.className = `kx-status ${cls}`;
  }

  // each titled section becomes one glass card holding its rows (and the notes under them); cards, notes and the like stand alone
  function groups(nodes) {
    const out = [];
    let box = null;
    nodes.flat(2).forEach((node) => {
      if (!node) return;
      const cls = node.classList;
      if (cls && cls.contains('kx-sec')) { box = h('section', { class: 'kx-group' }, node); out.push(box); return; }
      if (cls && (cls.contains('kx-row') || cls.contains('kx-action') || cls.contains('kx-note')) && box) { box.append(node); return; }
      if (cls && (cls.contains('kx-row') || cls.contains('kx-action'))) { box = h('section', { class: 'kx-group' }, node); out.push(box); return; }
      box = null;
      out.push(node);
    });
    return out;
  }

  function render() {
    if (!root) return;
    const scroller = root.querySelector('.kx-body');
    const top = scroller ? scroller.scrollTop : 0;
    const rows = groups([{ overview, stock: stockTab, menu: menuTab, display, ads, timing, lang: langs, battery, device, updates, diag }[tab]()]);
    const tabs = h('nav', { class: 'kx-tabs', role: 'tablist' }, TABS.map(([id, label]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(id === tab), class: id === tab ? 'is-on' : '',
      onclick: () => { tab = id; if (id === 'device' || id === 'updates' || id === 'diag') loadInfo(); if (id === 'stock') { loadStock(); return; } if (id === 'menu') { loadMenu(); return; } render(); const b = root.querySelector('.kx-body'); if (b) b.scrollTop = 0; },
    }, svg(TAB_ICONS[id]), label)));
    const logo = h('img', { src: 'sarcafe-logo.png', alt: '', width: '38', height: '38', draggable: 'false' });
    logo.addEventListener('error', () => { logo.hidden = true; });
    const head = h('header', { class: 'kx-head' },
      h('span', { class: 'kx-logo', 'aria-hidden': 'true' }, logo),
      h('div', { class: 'kx-title' }, h('strong', null, 'לוח בקרה'), h('small', null, `${C.deviceName}${C.branchName('he') ? ` · ${C.branchName('he')}` : ''}`)),
      (statusEl = h('span', { class: 'kx-status', role: 'status' })),
      h('button', { type: 'button', class: 'kx-btn', onclick: () => setPreview(true) }, 'תצוגה מקדימה'),
      h('button', { type: 'button', class: 'kx-close', 'aria-label': 'סגירה', onclick: () => close() }, svg('M6 6l12 12M18 6 6 18')));
    const bodyEl = h('main', { class: 'kx-body' }, h('div', { class: 'kx-col' }, rows));
    root.replaceChildren(head, tabs, bodyEl);
    bodyEl.scrollTop = top;
    // the chosen tab is always in view in the strip (nine tabs do not fit a narrow screen)
    const chosen = tabs.querySelector('.is-on');
    if (chosen && chosen.scrollIntoView) { try { chosen.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (_) { /* the strip just stays where it is */ } }
    paintStatus();
  }

  function setPreview(on) {
    previewing = on;
    if (!root) return;
    root.classList.toggle('is-previewing', on);
    body.classList.toggle('kx-previewing', on);
    if (on) say('');
  }

  function bump() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => close(), IDLE_CLOSE_MS);
  }

  function open(withToken) {
    if (root) { token = String(withToken || token || ''); return true; }
    if (!hasNative() && !isDesktopTest()) return false;         // on the tablet only the app, after the PIN, may open it
    if (hasNative() && !withToken) return false;
    token = String(withToken || '');
    loadInfo();
    // the app answers "null" to a token it did not give (or one whose session ended): then there is no panel
    if (hasNative() && native === null) { token = ''; return false; }
    root = h('div', { id: 'kiosk-admin', class: 'kx-panel', dir: 'rtl', lang: 'he' });
    const back = h('button', { type: 'button', class: 'kx-back', onclick: () => setPreview(false) }, svg('M9 5l7 7-7 7'), 'חזרה ללוח הבקרה');
    body.append(root, back);
    root.__back = back;
    body.classList.add('kx-admin-open');
    render();
    bump();
    unsub = C.onChange(() => { if (!previewing) render(); else paintStatus(); });
    clock = setInterval(liveTick, 2000);
    document.addEventListener('pointerdown', bump, true);
    return true;
  }

  function close() {
    if (!root) return;
    clearTimeout(idleTimer);
    clearInterval(clock);
    document.removeEventListener('pointerdown', bump, true);
    if (unsub) unsub();
    if (root.__back) root.__back.remove();
    root.remove();
    root = null;
    previewing = false;
    body.classList.remove('kx-admin-open', 'kx-previewing');
    if (hasNative()) { try { window.KioskStaff.close(token); } catch (_) { /* the app ends the staff session by itself */ } }
    token = '';
    // whatever the staff left on the kiosk (a preview, a typed field) goes with the privacy reset
    if (S && S.state !== 'ATTRACT') S.resetNow('staff');
  }

  window.KioskAdmin = { open, close, get isOpen() { return !!root; }, get tab() { return tab; }, show(id) { tab = id; render(); } };
  if (/[?&]kioskAdmin=open\b/.test(location.search) && isDesktopTest()) open('');
})();
