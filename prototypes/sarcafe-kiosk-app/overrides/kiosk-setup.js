/*
 * Sarcafe kiosk app: the setup screen (owner, 2026-11-06: "a little install wizard inside the app itself when it first runs, like it's
 * installing and needs to do stuff, some quirky lines about a kiosk app"). docs/SARCAFE_KIOSK_INSTALL.md.
 *
 * Shown while the app is not ready to be a kiosk, and once more to celebrate when it is:
 *   1. the network                       navigator.onLine
 *   2. the settings from the portal      the app has none: it shows the 6-character pairing code to type in the dashboard
 *                                        (/owner/kiosk/install → "קוד ממסך הטאבלט"); a QR install trades its code by itself
 *   3. the lock                          the app is the device owner and the screen is pinned; if not: how to lock it, and a way
 *                                        to carry on unlocked (staff only)
 *   4. the menu                          the page reloads with the settings
 * Reads the app's state through window.KioskNative.setupState() (APK 0.7+); without it (older app, desktop) it never shows, except
 * the desktop test hook ?kioskSetup=demo. Nothing secret is on this screen: the pairing code is not a credential.
 */
(() => {
  const N = window.KioskNative;
  const demo = /[?&]kioskSetup=demo\b/.test(location.search) && location.hostname !== 'kiosk.sarcafe.invalid';
  if (!demo && !(N && typeof N.setupState === 'function')) return;

  const LINES = [
    'מחמם את מכונת האספרסו הדיגיטלית…',
    'מלמד את הטאבלט לחייך ללקוחות…',
    'סופר כריכים. בלי לאכול אף אחד, מבטיחים.',
    'מבריק את הזכוכית (הנוזלית)…',
    'מסביר לטאבלט שעברית קוראים מימין לשמאל…',
    'מתאמן על "שלום! מה תרצו היום?"…',
    'מוודא שאין פירורים על המסך…',
    'מקציף חלב בשביל ההפוך של הצוות…',
    'מכין את הקרואסונים הווירטואליים…',
    'בודק שהמודעות יודעות לרקוד…',
  ];
  const KEY_UNLOCKED_OK = 'sarcafe.kiosk.setup.unlocked-ok.v1';
  const KEY_CELEBRATED = 'sarcafe.kiosk.setup.celebrated.v1';
  const get = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* a private window: just shows again */ } };

  const read = () => {
    if (demo) return window.__setupDemo || { configured: false, owner: false, locked: false, pairStatus: 'waiting', pairCode: 'K7Q2MP' };
    try { return JSON.parse(N.setupState() || '{}') || {}; } catch (_) { return {}; }
  };

  let root = null, lineEl = null, line = 0, timer = null, ticker = null, closing = false;
  const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

  function step(label, state, extra) {
    const li = h('li', `ks-step is-${state}`);
    const mark = h('span', 'ks-mark', state === 'done' ? '✓' : state === 'warn' ? '!' : state === 'now' ? '' : '');
    mark.setAttribute('aria-hidden', 'true');
    const body = h('div', 'ks-step-body');
    body.append(h('b', null, label));
    if (extra) body.append(extra);
    li.append(mark, body);
    li.setAttribute('aria-label', `${label}: ${state === 'done' ? 'הושלם' : state === 'warn' ? 'דורש תשומת לב' : state === 'now' ? 'עכשיו' : 'ממתין'}`);
    return li;
  }

  function paint(s) {
    const online = navigator.onLine !== false;
    const configured = !!s.configured;
    const lockedOk = !!s.owner;
    const unlockedOk = get(KEY_UNLOCKED_OK) === '1';
    const ready = configured && (lockedOk || unlockedOk);
    if (ready && get(KEY_CELEBRATED) === '1') return close(false);
    if (!root) open();
    const list = h('ol', 'ks-steps');

    list.append(step('מתחבר לרשת', online ? 'done' : 'now', online ? null : h('small', null, 'אין חיבור. בודקים את ה־Wi‑Fi בהגדרות הטאבלט.')));

    let settings;
    if (configured) settings = step('מקבל הגדרות מהפורטל', 'done', h('small', null, s.device ? `הטאבלט: ${s.device}` : null));
    else if (s.enrolling) settings = step('מקבל הגדרות מהפורטל', 'now', h('small', null, 'משתמש בקוד מה־QR…'));
    else {
      const box = h('div', 'ks-pair');
      if (s.pairCode) {
        box.append(h('small', null, 'בלוח הבקרה: התקנת קיוסק ← "קוד ממסך הטאבלט", ומקלידים:'));
        const code = h('div', 'ks-code', String(s.pairCode).replace(/^(.{3})(.{3})$/, '$1 $2'));
        code.setAttribute('dir', 'ltr');
        code.setAttribute('aria-label', `קוד ההתקנה ${String(s.pairCode).split('').join(' ')}`);
        box.append(code, h('small', 'ks-dim', 'הקוד מתחלף כל 15 דקות. אחרי ההקלדה הטאבלט ממשיך לבד.'));
      } else box.append(h('small', null, s.pairStatus === 'offline' ? 'מחכה לרשת כדי לבקש קוד…' : 'מבקש קוד התקנה מהפורטל…'));
      settings = step('מקבל הגדרות מהפורטל', 'now', box);
    }
    list.append(settings);

    let lock;
    if (lockedOk) lock = step('ננעל במצב קיוסק', 'done', h('small', null, 'אי אפשר לצאת מהאפליקציה בלי קוד הצוות.'));
    else {
      const box = h('div', 'ks-lock');
      box.append(h('small', null, 'האפליקציה הותקנה כאפליקציה רגילה, אז אפשר לצאת ממנה. נעילה מלאה רק אחרי איפוס יצרן וסריקת ה־QR מלוח הבקרה (6 הקשות במסך הפתיחה), או מהמחשב:'));
      const cmd = h('code', 'ks-cmd', 'adb shell dpm set-device-owner il.co.sarcafe.kiosk/.KioskAdminReceiver');
      cmd.setAttribute('dir', 'ltr');
      box.append(cmd);
      if (configured && !unlockedOk) {
        const go = h('button', 'ks-btn', 'להמשיך בינתיים בלי נעילה');
        go.type = 'button';
        go.addEventListener('click', () => { put(KEY_UNLOCKED_OK, '1'); refresh(); });
        box.append(go);
      }
      lock = step('ננעל במצב קיוסק', unlockedOk ? 'warn' : configured ? 'warn' : 'wait', box);
    }
    list.append(lock);

    list.append(step('טוען את התפריט והמודעות', ready ? 'done' : 'wait'));

    const title = ready ? 'הקיוסק מוכן! ☕' : 'מתקינים את הקיוסק';
    root.querySelector('.ks-title').textContent = title;
    root.querySelector('.ks-list').replaceChildren(list);
    root.classList.toggle('is-ready', ready);
    if (ready) { put(KEY_CELEBRATED, '1'); lineEl.textContent = 'הכול מוכן. בתיאבון!'; clearInterval(ticker); setTimeout(() => close(true), 2600); }
  }

  function open() {
    root = h('div', 'ks-screen');
    root.id = 'kiosk-setup';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'ks-title');
    root.setAttribute('dir', 'rtl');
    root.setAttribute('lang', 'he');
    const card = h('div', 'ks-card');
    const logo = h('img', 'ks-logo');
    logo.src = 'sarcafe-logo.png'; logo.alt = ''; logo.width = 64; logo.height = 64;
    logo.addEventListener('error', () => { logo.hidden = true; });
    const t = h('h1', 'ks-title', 'מתקינים את הקיוסק'); t.id = 'ks-title';
    lineEl = h('p', 'ks-line', LINES[0]); lineEl.setAttribute('aria-live', 'polite');
    const bar = h('div', 'ks-bar'); bar.append(h('i'));
    card.append(logo, t, lineEl, bar, h('div', 'ks-list'));
    root.append(card);
    document.body.append(root);
    document.body.classList.add('ks-open');
    ticker = setInterval(() => { line = (line + 1) % LINES.length; if (!root.classList.contains('is-ready')) lineEl.textContent = LINES[line]; }, 2600);
  }

  function close(fade) {
    if (!root || closing) return;
    closing = true;
    clearInterval(ticker);
    const done = () => { if (root) root.remove(); root = null; closing = false; document.body.classList.remove('ks-open'); };
    if (fade) { root.classList.add('is-leaving'); setTimeout(done, 450); } else done();
  }

  function refresh() { paint(read()); }
  refresh();
  timer = setInterval(refresh, 1500);
  window.KioskSetup = { refresh, get isOpen() { return !!root; }, stop() { clearInterval(timer); close(false); } };
})();
