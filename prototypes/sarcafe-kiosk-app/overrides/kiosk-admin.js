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
 *   סוללה      where the charge shows, the alert to the developer (on or off, the level), the urgent alert, a test alert
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
    ['overview', 'סקירה'], ['display', 'מסכים'], ['ads', 'מודעות'], ['timing', 'זמנים'], ['lang', 'שפות'],
    ['battery', 'סוללה'], ['device', 'מכשיר'], ['updates', 'עדכונים'], ['diag', 'אבחון'],
  ];

  // pieces that change by themselves (the charge, the connection) are redrawn on their own every two seconds, so a tap on a
  // control is never lost to a redraw of the whole tab
  const LIVE = {
    cards() {
      const B = window.KioskBattery;
      const shift = window.KioskShift;
      const D = window.KioskDevice;
      const level = B ? B.level : null;
      const charging = B ? B.charging : null;
      const tone = level === null ? '' : charging ? 'good' : level <= 15 ? 'bad' : level <= 30 ? 'warn' : '';
      return h('div', { class: 'kx-cards', 'data-live': 'cards' },
        h('div', { class: `kx-card kx-battery ${tone ? `is-${tone}` : ''}` },
          h('small', null, 'סוללה'),
          h('strong', { dir: 'ltr' }, level === null ? '—' : `${level}%`),
          h('div', { class: 'kx-bar' }, h('i', { style: `width:${level === null ? 0 : level}%` })),
          h('span', null, level === null ? 'אין נתון מהמכשיר' : charging ? 'בטעינה' : charging === false ? 'לא בטעינה' : '')),
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
      section('התראה למפתח', 'ההתראה נשלחת למפתח בלבד (לא לבעלים) ורק כשהטאבלט לא בטעינה. פעם אחת לכל ירידה, ושוב רק אחרי שנטען.'),
      toggle('להתריע כשהטעינה יורדת', null, 'battery.alertEnabled'),
      stepper('להתריע מתחת ל־', 'באחוזים.', 'battery.alertPercent', { min: 10, max: 90, step: 5, unit: '%', fallback: () => 50 }),
      toggle('התראה דחופה נוספת', 'הודעה שנייה, כשהסוללה כמעט נגמרת.', 'battery.criticalEnabled'),
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

  function render() {
    if (!root) return;
    const scroller = root.querySelector('.kx-body');
    const top = scroller ? scroller.scrollTop : 0;
    const rows = { overview, display, ads, timing, lang: langs, battery, device, updates, diag }[tab]();
    const tabs = h('nav', { class: 'kx-tabs', role: 'tablist' }, TABS.map(([id, label]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(id === tab), class: id === tab ? 'is-on' : '',
      onclick: () => { tab = id; if (id === 'device' || id === 'updates' || id === 'diag') loadInfo(); render(); const b = root.querySelector('.kx-body'); if (b) b.scrollTop = 0; },
    }, label)));
    const head = h('header', { class: 'kx-head' },
      h('div', { class: 'kx-title' }, h('strong', null, 'לוח בקרה'), h('small', null, `${C.deviceName}${C.branchName('he') ? ` · ${C.branchName('he')}` : ''}`)),
      (statusEl = h('span', { class: 'kx-status', role: 'status' })),
      h('button', { type: 'button', class: 'kx-btn', onclick: () => setPreview(true) }, 'תצוגה מקדימה'),
      h('button', { type: 'button', class: 'kx-close', 'aria-label': 'סגירה', onclick: () => close() }, svg('M6 6l12 12M18 6 6 18')));
    const bodyEl = h('main', { class: 'kx-body' }, h('div', { class: 'kx-col' }, rows));
    root.replaceChildren(head, tabs, bodyEl);
    bodyEl.scrollTop = top;
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
