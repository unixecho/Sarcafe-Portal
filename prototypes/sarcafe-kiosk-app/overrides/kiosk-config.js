/*
 * Sarcafe kiosk app: this tablet's settings. Every layer that has something staff can tune asks here (window.KioskConfig),
 * and the control panel (kiosk-admin.js) changes them here.
 *
 * Three sources, strongest first:
 *   pending   what the panel changed and the portal has not confirmed yet (kept on the tablet, sent again later)
 *   server    the portal's answer for this tablet (GET /api/kiosk/content?device=..., the "kiosk" part), cached here
 *   DEFAULTS  below; the same table as src/lib/kiosk/device-settings.ts (scripts/check-kiosk-device.mjs fails if they drift)
 * A value changed in the panel applies at once, then is saved with PUT /api/kiosk/device (the kiosk's shared key, only this
 * tablet's own settings). Offline, or before the portal's database has the tablet registered, the change simply stays on the
 * tablet (pending) and is retried every few minutes; nothing the staff did is ever lost or refused silently.
 * `null` in a change means "back to the default" (for the three timings: follow the branch's times).
 *
 * Which tablet this is: localStorage "sarcafe.kiosk.device.v1" (set in the panel); none means the tablet that already
 * existed (Givat Haviva). More tablets and branches are more names, never another build.
 *
 * Effects that are only a look (hiding a line, a button) are classes on <html>: kx-hide-credit, kx-no-club,
 * kx-hide-branch, kx-hide-count, and html[data-kx-battery]. Behaviour belongs to the layer that owns it, which reads
 * KioskConfig.get('section.key') and listens with onChange.
 */
(() => {
  const DEFAULTS = {
    display: { showEmployees: true, showClosing: true, closingSource: 'shift_then_hours', showBranch: true, showItemCount: true, showCredit: true, clubEnabled: true },
    ads: { arrows: true, swipe: true, autoPlay: true, loop: true, transition: 'slide', tapAction: 'ad', slideSeconds: null, hiddenIds: [] },
    timing: { idleSeconds: null, graceSeconds: null, successSeconds: 10, contentRefreshMinutes: 15 },
    language: { default: 'he', enabled: ['he', 'en', 'ar'], showSwitch: true },
    battery: { display: 'tray', alertEnabled: true, alertPercent: 50, criticalEnabled: false, criticalPercent: 15 },
  };
  const BOOL = ['bool'];
  const SPEC = {
    display: { showEmployees: BOOL, showClosing: BOOL, closingSource: ['enum', 'shift', 'hours', 'shift_then_hours'], showBranch: BOOL, showItemCount: BOOL, showCredit: BOOL, clubEnabled: BOOL },
    ads: { arrows: BOOL, swipe: BOOL, autoPlay: BOOL, loop: BOOL, transition: ['enum', 'slide', 'fade'], tapAction: ['enum', 'ad', 'main'], slideSeconds: ['int', 3, 60], hiddenIds: ['ids', 20] },
    timing: { idleSeconds: ['int', 30, 300], graceSeconds: ['int', 5, 30], successSeconds: ['int', 5, 60], contentRefreshMinutes: ['int', 5, 120] },
    language: { default: ['enum', 'he', 'en', 'ar'], enabled: ['langs'], showSwitch: BOOL },
    battery: { display: ['enum', 'tray', 'corner', 'hidden'], alertEnabled: BOOL, alertPercent: ['int', 10, 90], criticalEnabled: BOOL, criticalPercent: ['int', 5, 40] },
  };
  const LANGS = ['he', 'en', 'ar'];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const KEY_SERVER = 'sarcafe.kiosk.cfg.v1';
  const KEY_PENDING = 'sarcafe.kiosk.cfg.pending.v1';
  const KEY_DEVICE = 'sarcafe.kiosk.device.v1';
  const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } },
    set(key, value) { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* full or blocked: it just stays in memory */ } },
    raw(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
  };

  function valid(spec, v) {
    switch (spec[0]) {
      case 'bool': return typeof v === 'boolean';
      case 'enum': return typeof v === 'string' && spec.indexOf(v, 1) > 0;
      case 'int': return typeof v === 'number' && Number.isInteger(v) && v >= spec[1] && v <= spec[2];
      case 'ids': return Array.isArray(v) && v.length <= spec[1] && v.every((x) => typeof x === 'string' && UUID.test(x)) && new Set(v).size === v.length;
      case 'langs': return Array.isArray(v) && v.length >= 1 && v.length <= LANGS.length && v.every((x) => LANGS.indexOf(x) >= 0) && new Set(v).size === v.length;
      default: return false;
    }
  }

  /** Keeps every known, valid value of a sparse or full settings object; anything else is dropped. */
  function sanitize(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(SPEC).forEach((section) => {
      const given = raw[section];
      if (!given || typeof given !== 'object') return;
      Object.keys(SPEC[section]).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(given, key) && valid(SPEC[section][key], given[key])) {
          (out[section] = out[section] || {})[key] = clone(given[key]);
        }
      });
    });
    return out;
  }

  /** A change (sparse; null = back to the default) in the same shape, validated. */
  function sanitizePatch(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(SPEC).forEach((section) => {
      const given = raw[section];
      if (!given || typeof given !== 'object') return;
      Object.keys(SPEC[section]).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(given, key)) return;
        if (given[key] === null || valid(SPEC[section][key], given[key])) (out[section] = out[section] || {})[key] = clone(given[key]);
      });
    });
    return out;
  }

  const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

  // ---- state -----------------------------------------------------------------------------------------------------------
  let cfg = {};
  try { cfg = JSON.parse((window.SarcafeKiosk && window.SarcafeKiosk.config()) || '{}') || {}; } catch (_) { cfg = {}; }
  const apiBase = typeof cfg.api === 'string' && /\/menu(\?.*)?$/.test(cfg.api) ? cfg.api.replace(/\/menu(\?.*)?$/, '') : '';

  let server = null;   // { device, name, registered, branch:{slug,name:{he,en,ar}}, branchTiming, settings (full), settingsUpdatedAt }
  let pending = {};    // sparse change not yet confirmed by the portal
  const cachedServer = store.get(KEY_SERVER);
  if (cachedServer && typeof cachedServer === 'object') server = sanitizeKiosk(cachedServer);
  const cachedPending = store.get(KEY_PENDING);
  if (cachedPending) pending = sanitizePatch(cachedPending);

  const savedDevice = store.raw(KEY_DEVICE);
  let device = typeof cfg.device === 'string' && SLUG.test(cfg.device) ? cfg.device : (savedDevice && SLUG.test(savedDevice) ? savedDevice : null);

  /** The portal's "kiosk" part of the content answer, checked. null when it is not usable. */
  function sanitizeKiosk(k) {
    if (!isObject(k) || typeof k.device !== 'string' || !SLUG.test(k.device)) return null;
    const branch = isObject(k.branch) && isObject(k.branch.name) ? k.branch : null;
    const t = isObject(k.branchTiming) ? k.branchTiming : {};
    const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
    return {
      device: k.device,
      name: text(k.name, 60) || k.device,
      registered: k.registered === true,
      branch: branch ? { slug: text(branch.slug, 60) || '', name: { he: text(branch.name.he, 60), en: text(branch.name.en, 60), ar: text(branch.name.ar, 60) } } : null,
      branchTiming: { idleSeconds: num(t.idleSeconds, 30, 300, 60), graceSeconds: num(t.graceSeconds, 5, 30, 10), slideSeconds: num(t.slideSeconds, 3, 60, 7) },
      settings: sanitize(k.settings),
      settingsUpdatedAt: text(k.settingsUpdatedAt, 40),
    };
  }

  // ---- the effective settings ------------------------------------------------------------------------------------------
  function build() {
    const out = clone(DEFAULTS);
    const layer = (source) => Object.keys(source).forEach((section) => Object.keys(source[section]).forEach((key) => {
      out[section][key] = source[section][key] === null ? clone(DEFAULTS[section][key]) : clone(source[section][key]);
    }));
    if (server) layer(server.settings);
    layer(pending);
    // two rules between settings (the portal enforces them too): the default language is an enabled one, the urgent alert is lower
    if (out.language.enabled.indexOf(out.language.default) < 0) out.language.enabled = LANGS.slice();
    if (out.battery.criticalPercent >= out.battery.alertPercent) out.battery.criticalPercent = Math.max(5, out.battery.alertPercent - 5);
    return out;
  }
  let eff = build();
  const listeners = [];

  function applyLook() {
    const root = document.documentElement;
    root.classList.toggle('kx-hide-credit', !eff.display.showCredit);
    root.classList.toggle('kx-no-club', !eff.display.clubEnabled);
    root.classList.toggle('kx-hide-branch', !eff.display.showBranch);
    root.classList.toggle('kx-hide-count', !eff.display.showItemCount);
    root.dataset.kxBattery = eff.battery.display;
  }

  function emit(prev) {
    applyLook();
    listeners.slice().forEach((fn) => { try { fn(eff, prev); } catch (_) { /* one layer must not stop the others */ } });
  }

  function recompute() {
    const prev = eff;
    eff = build();
    if (JSON.stringify(prev) !== JSON.stringify(eff)) emit(prev); else applyLook();
  }

  // ---- saving to the portal --------------------------------------------------------------------------------------------
  const sync = { saving: false, lastOkAt: 0, lastError: '', timer: undefined, backoff: 0 };
  const hasPending = () => Object.keys(pending).length > 0;
  const keyHeader = () => (cfg.signupKey ? { 'X-Kiosk-Key': cfg.signupKey } : null);

  function url(path, query) {
    if (!apiBase) return '';
    const parts = [];
    if (device) parts.push(`device=${encodeURIComponent(device)}`);
    if (query) parts.push(query);
    return `${apiBase}/${path}${parts.length ? `?${parts.join('&')}` : ''}`;
  }

  function mergePending(patch) {
    Object.keys(patch).forEach((section) => {
      pending[section] = pending[section] || {};
      Object.keys(patch[section]).forEach((key) => { pending[section][key] = patch[section][key]; });
    });
    // a value equal to what the portal already has needs no sending
    Object.keys(pending).forEach((section) => {
      Object.keys(pending[section]).forEach((key) => {
        const base = server && server.settings[section] && Object.prototype.hasOwnProperty.call(server.settings[section], key) ? server.settings[section][key] : DEFAULTS[section][key];
        const want = pending[section][key] === null ? DEFAULTS[section][key] : pending[section][key];
        if (server && JSON.stringify(base) === JSON.stringify(want)) delete pending[section][key];
      });
      if (!Object.keys(pending[section]).length) delete pending[section];
    });
  }

  function scheduleSave(delay) {
    clearTimeout(sync.timer);
    if (!hasPending()) return;
    sync.timer = setTimeout(flush, delay === undefined ? 900 : delay);
  }

  async function flush() {
    clearTimeout(sync.timer);
    if (sync.saving || !hasPending()) return hasPending() ? { ok: false, error: 'busy' } : { ok: true };
    const headers = keyHeader();
    const target = apiBase ? `${apiBase}/device` : '';
    if (!headers || !target) { sync.lastError = 'no_connection_settings'; return { ok: false, error: sync.lastError }; }
    sync.saving = true;
    const sent = clone(pending);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 12000);
    try {
      const res = await fetch(target, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ device: device || undefined, patch: sent }),
        cache: 'no-store',
        signal: abort.signal,
      });
      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      if (res.ok && data && data.ok) {
        // what was sent is now the portal's; anything changed while it was in the air stays pending
        server = Object.assign(server || { device: device || 'givat-haviva-1', name: device || '', registered: true, branch: null, branchTiming: { idleSeconds: 60, graceSeconds: 10, slideSeconds: 7 } }, {
          settings: mergeFull(data.settings),
          settingsUpdatedAt: text(data.settingsUpdatedAt, 40),
          registered: true,
        });
        Object.keys(sent).forEach((section) => Object.keys(sent[section]).forEach((key) => {
          if (pending[section] && JSON.stringify(pending[section][key]) === JSON.stringify(sent[section][key])) delete pending[section][key];
          if (pending[section] && !Object.keys(pending[section]).length) delete pending[section];
        }));
        sync.lastOkAt = Date.now(); sync.lastError = ''; sync.backoff = 0;
        persist();
        recompute();
        return { ok: true };
      }
      if (res.status === 400) {
        // the portal refuses this change (a rule between settings): drop it, say why, keep the tablet on the portal's values
        sync.lastError = (data && data.message) || 'rejected';
        Object.keys(sent).forEach((section) => Object.keys(sent[section]).forEach((key) => { if (pending[section]) delete pending[section][key]; }));
        Object.keys(pending).forEach((section) => { if (!Object.keys(pending[section]).length) delete pending[section]; });
        persist();
        recompute();
        return { ok: false, error: 'rejected', message: sync.lastError };
      }
      sync.lastError = res.status === 503 ? 'not_ready' : `http_${res.status}`;
      return { ok: false, error: sync.lastError };
    } catch (_) {
      sync.lastError = 'offline';
      return { ok: false, error: 'offline' };
    } finally {
      clearTimeout(timer);
      sync.saving = false;
      if (hasPending()) {
        // retry later: soon after a change, then every few minutes (the report in kiosk-device.js also calls flush)
        sync.backoff = Math.min(300000, (sync.backoff || 15000) * 2);
        scheduleSave(sync.backoff);
      }
    }
  }

  // the portal answers a save with the whole effective settings: keep it as the new full server copy
  function mergeFull(settings) {
    const out = clone(DEFAULTS);
    const clean = sanitize(settings);
    Object.keys(clean).forEach((section) => Object.keys(clean[section]).forEach((key) => { out[section][key] = clean[section][key]; }));
    return out;
  }

  function persist() {
    store.set(KEY_SERVER, server);
    store.set(KEY_PENDING, hasPending() ? pending : null);
  }

  // ---- public API ------------------------------------------------------------------------------------------------------
  function getPath(path) {
    const [section, key] = path.split('.');
    return eff[section] ? clone(eff[section][key]) : undefined;
  }

  window.KioskConfig = {
    DEFAULTS: clone(DEFAULTS),
    SPEC,
    get: getPath,
    all: () => clone(eff),
    get device() { return device; },
    get deviceName() { return (server && server.name) || device || 'givat-haviva-1'; },
    /** The registry's name for this tablet (what the portal calls it), whether or not the tablet was told one. */
    get deviceSlug() { return device || (server && server.device) || 'givat-haviva-1'; },
    get registered() { return !!(server && server.registered); },
    get branchSlug() { return (server && server.branch && server.branch.slug) || ''; },
    /** The branch's names as the portal has them ({ he, en, ar }, any may be null), or null when it has not said. */
    get branchNames() { return server && server.branch ? clone(server.branch.name) : null; },
    /** The branch's name in a language; null when the portal has not said (the fixed words of the kiosk stay). */
    branchName(lang) {
      const n = server && server.branch && server.branch.name;
      return n ? (n[lang] || n.he || null) : null;
    },
    /** The branch's own timings from /owner/kiosk, for "follows the branch (60 s)". */
    get branchTiming() { return clone((server && server.branchTiming) || { idleSeconds: 60, graceSeconds: 10, slideSeconds: 7 }); },
    get settingsUpdatedAt() { return (server && server.settingsUpdatedAt) || null; },
    get key() { return cfg.signupKey || ''; },
    get apiBase() { return apiBase; },
    url,
    headers: keyHeader,
    sanitizeKiosk,
    /** The portal's answer for this tablet (from the content fetch). Changes made on the tablet that are not sent yet stay on top. */
    ingest(kiosk) {
      const clean = sanitizeKiosk(kiosk);
      if (!clean) return false;
      server = Object.assign({}, clean, { settings: mergeFull(clean.settings) });
      persist();
      recompute();
      return true;
    },
    /** A change from the panel: { section: { key: value | null } }. Applies now, saves in a moment. */
    patch(change) {
      const clean = sanitizePatch(change);
      if (!Object.keys(clean).length) return false;
      mergePending(clean);
      persist();
      recompute();
      scheduleSave();
      return true;
    },
    /** Everything back to the defaults (a change for every setting). */
    resetAll() {
      const change = {};
      Object.keys(SPEC).forEach((section) => { change[section] = {}; Object.keys(SPEC[section]).forEach((key) => { change[section][key] = null; }); });
      return this.patch(change);
    },
    setDevice(slug) {
      const next = slug ? String(slug).trim().toLowerCase() : '';
      if (next && !SLUG.test(next)) return false;
      device = next || null;
      try { if (device) localStorage.setItem(KEY_DEVICE, device); else localStorage.removeItem(KEY_DEVICE); } catch (_) { /* kept in memory */ }
      // everything below belonged to the previous name
      server = null;
      pending = {};
      persist();
      recompute();
      return true;
    },
    onChange(fn) {
      listeners.push(fn);
      return () => { const at = listeners.indexOf(fn); if (at >= 0) listeners.splice(at, 1); };
    },
    get sync() { return { pending: hasPending(), saving: sync.saving, lastOkAt: sync.lastOkAt, lastError: sync.lastError, registered: !!(server && server.registered) }; },
    flush,
    /** What the last report said the portal's settings time is (kiosk-device.js): a newer one means "fetch the content again". */
    knowsSettingsAt(at) { return !at || at === (server && server.settingsUpdatedAt); },
  };

  applyLook();
})();
