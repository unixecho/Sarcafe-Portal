/*
 * Sarcafe kiosk app: the battery reading, for the staff who look after the tablet (customers are not meant to see it).
 *
 * It no longer sits on the screen: a pill in a corner covered the footer and other parts of the display. Now:
 *   - pulled down: a swipe DOWN that starts at the very top edge of the screen drops a small tray with the charge (and
 *     whether it is charging) for a few seconds, then it goes back up by itself. The system's own status bar cannot be
 *     pulled down on this tablet (the app is the device owner and switches it off), so the page has its own.
 *   - the control panel shows it large (kiosk-admin.js), and the owner's page shows the last report
 *   - settings (KioskConfig battery.display): 'tray' (the default), 'corner' (a small badge, always there, for a tablet that is
 *     being tested on a desk) or 'hidden' (nothing; the panel still shows it)
 *
 * Where the number comes from: the app's own reading when the app has one (KioskNative.battery(), the Android battery
 * service), else the page's Battery Status API. Where neither can answer nothing is drawn: a frozen number would be
 * worse than none. window.KioskBattery gives the reading to the others (the report to the portal in kiosk-device.js).
 * Nothing here is stored or sent by itself, and it holds no visitor data.
 */
(() => {
  const C = window.KioskConfig;
  const native = window.KioskNative;
  const reading = { level: null, charging: null, at: 0, source: 'none' };
  const listeners = [];
  let battery = null;

  const fromNative = () => {
    try {
      if (native && typeof native.battery === 'function') {
        const o = JSON.parse(native.battery() || 'null');
        if (o && Number.isFinite(o.level) && o.level >= 0 && o.level <= 100) {
          return { level: Math.round(o.level), charging: typeof o.charging === 'boolean' ? o.charging : null, source: 'app' };
        }
      }
    } catch (_) { /* the page's own reading is next */ }
    return null;
  };
  const fromWeb = () => {
    if (!battery || typeof battery.level !== 'number' || !Number.isFinite(battery.level)) return null;
    return { level: Math.round(battery.level * 100), charging: typeof battery.charging === 'boolean' ? battery.charging : null, source: 'page' };
  };

  const SVG_BOLT = '<svg class="kb-bolt" viewBox="0 0 10 14" aria-hidden="true"><path d="M6.2 0 0 8h4l-1 6L10 5.5H5.8z"/></svg>';
  const widget = (cls) => {
    const node = document.createElement('div');
    node.className = cls;
    node.setAttribute('dir', 'rtl');
    node.hidden = true;
    node.innerHTML = '<span class="kb-cell" dir="ltr"><i class="kb-fill"></i></span><b class="kb-text" dir="ltr"></b>' + SVG_BOLT + '<span class="kb-state"></span>';
    return node;
  };
  const tray = widget('kiosk-tray');
  tray.setAttribute('role', 'status');
  const badge = widget('kiosk-battery');
  badge.setAttribute('aria-hidden', 'true');

  const LOW = 30;
  const CRITICAL = 15;
  function paintOne(node) {
    const known = reading.level !== null;
    const text = node.querySelector('.kb-text');
    const fill = node.querySelector('.kb-fill');
    const state = node.querySelector('.kb-state');
    text.textContent = known ? `${reading.level}%` : '—';
    fill.style.width = known ? `${reading.level}%` : '0%';
    const charging = reading.charging === true;
    node.classList.toggle('is-charging', known && charging);
    node.classList.toggle('is-low', known && !charging && reading.level <= LOW && reading.level > CRITICAL);
    node.classList.toggle('is-critical', known && !charging && reading.level <= CRITICAL);
    state.textContent = !known ? 'אין נתון מהמכשיר' : charging ? 'בטעינה' : reading.charging === false ? 'לא בטעינה' : '';
  }
  function paint() {
    paintOne(tray);
    paintOne(badge);
    const mode = document.documentElement.dataset.kxBattery || 'tray';
    badge.hidden = mode !== 'corner' || reading.level === null;
  }

  function read() {
    const next = fromNative() || fromWeb();
    const prev = { level: reading.level, charging: reading.charging };
    if (next) Object.assign(reading, next, { at: Date.now() });
    else { reading.level = null; reading.charging = null; reading.source = 'none'; }
    paint();
    if (prev.level !== reading.level || prev.charging !== reading.charging) listeners.slice().forEach((fn) => { try { fn(reading, prev); } catch (_) { /* one listener must not stop the others */ } });
    return reading;
  }

  document.body.append(tray, badge);

  if (typeof navigator.getBattery === 'function') {
    navigator.getBattery().then((b) => {
      battery = b;
      ['levelchange', 'chargingchange'].forEach((name) => b.addEventListener(name, read));
      read();
    }).catch(() => { /* no reading from the page */ });
  }
  // some WebViews fire the events late or not at all on a tablet that sits on a charger for days
  setInterval(read, 30000);
  read();

  // ---- the tray -----------------------------------------------------------------------------------------------
  let hideTimer;
  function openTray() {
    if ((document.documentElement.dataset.kxBattery || 'tray') === 'hidden') return;
    read();
    clearTimeout(hideTimer);
    tray.hidden = false;
    void tray.offsetWidth;
    tray.classList.add('is-open');
    hideTimer = setTimeout(closeTray, 6000);
  }
  function closeTray() {
    clearTimeout(hideTimer);
    tray.classList.remove('is-open');
    hideTimer = setTimeout(() => { tray.hidden = true; }, 320);
  }
  tray.addEventListener('click', closeTray);

  // a swipe down from the very top edge (the first 30 px) of the screen, at least 40 px down and mostly vertical
  const EDGE = 30;
  const NEEDED = 40;
  let start = null;
  document.addEventListener('pointerdown', (event) => {
    start = event.isPrimary && event.clientY <= EDGE ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
  }, { capture: true, passive: true });
  document.addEventListener('pointermove', (event) => {
    if (!start || event.pointerId !== start.id) return;
    const dy = event.clientY - start.y;
    const dx = Math.abs(event.clientX - start.x);
    if (dy >= NEEDED && dy > dx * 1.5) { start = null; openTray(); }
  }, { capture: true, passive: true });
  ['pointerup', 'pointercancel'].forEach((type) => document.addEventListener(type, () => { start = null; }, { capture: true, passive: true }));

  if (C) C.onChange(paint);
  paint();

  window.KioskBattery = {
    read,
    get level() { return reading.level; },
    get charging() { return reading.charging; },
    get source() { return reading.source; },
    onChange(fn) { listeners.push(fn); return () => { const at = listeners.indexOf(fn); if (at >= 0) listeners.splice(at, 1); }; },
    openTray,
  };
})();
