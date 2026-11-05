/*
 * Sarcafe kiosk app: what this tablet tells the portal about itself, every few minutes.
 *
 *   POST <portal>/api/kiosk/device   { device, battery: { level, charging }, app, web }   (the kiosk's shared key)
 *
 * The portal records it (when the tablet was last seen, its charge, its versions) and decides about the alerts: while the
 * tablet is NOT charging, the developer is told at the alert level (battery.alertPercent, 50 % unless changed in the control
 * panel) and then at every 5 % below it (45, 40 ... 5), each rung once per fall; the ladder starts again after the tablet has
 * been charged or has risen 5 points above its start (all in the database function kiosk_device_report; the owners are not
 * told, and nothing is sent when the alerts are switched off in the panel). The tablet only reports; it never decides.
 *
 * The answer carries the time the tablet's settings last changed on the portal. A newer time than the one this tablet
 * knows (the owner changed something on their page) makes it fetch the content again, so the change arrives within one
 * report. Changes made in the control panel that could not be sent yet are sent here too (KioskConfig.flush).
 *
 * Sends nothing about customers. Reports only while the screen is on (a page that is hidden is asleep). A report that
 * fails is simply the next one's job. Before the portal's database knows this tablet the answer is 503 and nothing happens.
 */
(() => {
  const C = window.KioskConfig;
  const B = window.KioskBattery;
  if (!C) return;

  const FIRST_MS = 15000;
  const EVERY_MS = 5 * 60000;
  const MIN_GAP_MS = 30000;
  const state = { at: 0, ok: false, status: '', alerted: false, error: '' };
  let sending = false;
  let timer;
  let soon;

  const appVersion = () => {
    try {
      const n = window.KioskNative;
      if (n && typeof n.appVersion === 'function') { const v = Number(n.appVersion()); return Number.isInteger(v) && v >= 0 ? v : null; }
    } catch (_) { /* an older app: not reported */ }
    return null;
  };
  const webVersion = () => {
    try {
      const n = window.KioskNative;
      if (n && typeof n.webVersion === 'function') { const v = String(n.webVersion() || '').slice(0, 40); return v || null; }
    } catch (_) { /* an older app: not reported */ }
    return typeof window.SARCAFE_BUNDLE_VERSION === 'string' && window.SARCAFE_BUNDLE_VERSION ? window.SARCAFE_BUNDLE_VERSION.slice(0, 40) : null;
  };

  async function report(reason) {
    const url = C.apiBase ? `${C.apiBase}/device` : '';
    const headers = C.headers();
    if (sending || !url || !headers) return { ok: false, error: 'not_configured' };
    sending = true;
    clearTimeout(soon);
    const reading = B ? B.read() : { level: null, charging: null };
    const body = { device: C.device || undefined };
    if (reading.level !== null) body.battery = { level: reading.level, charging: reading.charging };
    const app = appVersion();
    if (app !== null) body.app = app;
    const web = webVersion();
    if (web) body.web = web;
    const abort = new AbortController();
    const cut = setTimeout(() => abort.abort(), 10000);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), cache: 'no-store', signal: abort.signal });
      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      state.at = Date.now();
      state.status = reason || '';
      if (res.ok && data && data.ok) {
        state.ok = true; state.error = '';
        if (data.settingsUpdatedAt && !C.knowsSettingsAt(data.settingsUpdatedAt)) window.dispatchEvent(new Event('kiosk:settings-stale'));
        if (C.sync.pending) C.flush();
        return { ok: true };
      }
      state.ok = false;
      state.error = res.status === 503 ? 'not_ready' : `http_${res.status}`;
      return { ok: false, error: state.error };
    } catch (_) {
      state.ok = false; state.error = 'offline';
      return { ok: false, error: 'offline' };
    } finally {
      clearTimeout(cut);
      sending = false;
    }
  }

  // the control panel's "send a test alert": one alert, marked as a test, to the developer, whatever the charge is
  async function test() {
    const url = C.apiBase ? `${C.apiBase}/device` : '';
    const headers = C.headers();
    if (!url || !headers) return { ok: false, error: 'not_configured' };
    const abort = new AbortController();
    const cut = setTimeout(() => abort.abort(), 10000);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ device: C.device || undefined, test: true }), cache: 'no-store', signal: abort.signal });
      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      if (res.ok && data && data.ok) return { ok: true };
      return { ok: false, error: res.status === 503 ? 'not_ready' : `http_${res.status}` };
    } catch (_) {
      return { ok: false, error: 'offline' };
    } finally {
      clearTimeout(cut);
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!document.hidden) report('timer'); schedule(); }, EVERY_MS);
  }

  // a change that matters to the alert (charging started or stopped, the charge moved a whole 5 points) is reported soon,
  // never more often than every 30 s
  if (B) {
    let lastLevel = null;
    B.onChange((now, prev) => {
      const crossed = prev.charging !== now.charging || (now.level !== null && (lastLevel === null || Math.abs(now.level - lastLevel) >= 5));
      if (!crossed || document.hidden) return;
      lastLevel = now.level;
      clearTimeout(soon);
      const scale = window.KioskSession ? window.KioskSession.scale : 1; // the test hook ?kioskTestScale shortens every wait
      soon = setTimeout(() => report('change'), Math.max(2000, MIN_GAP_MS - (Date.now() - state.at)) * scale);
    });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - state.at > EVERY_MS) report('wake'); });

  setTimeout(() => report('start'), FIRST_MS);
  schedule();
  window.KioskDevice = { report, test, get lastAt() { return state.at; }, get ok() { return state.ok; }, get error() { return state.error; } };
})();
