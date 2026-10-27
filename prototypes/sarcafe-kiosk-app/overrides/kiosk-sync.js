/*
 * Sarcafe kiosk app: menu updates pushed from the dashboard.
 *
 * The kiosk keeps showing the menu it has (shipped in the app, or the last one pushed) and never polls. When the
 * owner dashboard changes the menu, the portal already broadcasts a short "menu-updated" message on the branch's
 * realtime channel (lib/menu/realtime.ts, "menu:givat-haviva"); this page listens to that same channel. The message carries no data: the page then fetches the real snapshot from the
 * portal's snapshot endpoint, validates it, stores it, and reloads itself once the kiosk is back on the welcome
 * screen (never in the middle of someone's sign-up). A forged message can therefore only cause a re-fetch.
 * On every (re)connect the page also asks for the snapshot once, so a push missed while offline is caught up.
 *
 * Where to listen and fetch is set over adb (see MainActivity): nothing is configured by default, and then the
 * kiosk simply keeps the menu it has.
 */
(() => {
  const body = document.body;
  let cfg = {};
  try { cfg = JSON.parse((window.SarcafeKiosk && window.SarcafeKiosk.config()) || '{}') || {}; } catch (_) { cfg = {}; }

  const state = window.__kioskSync = {
    configured: !!cfg.api, push: 'off', lastCheck: null, lastResult: null,
    version: (window.SARCAFE_MENU || {}).version || null, pendingReload: false,
  };

  // say which menu is on screen: item count and the date it was published
  function decorate() {
    const menu = window.SARCAFE_MENU;
    if (!menu || !menu.version || !Array.isArray(menu.categories)) return; // the menu shipped in the app says its own numbers
    const count = menu.categories.reduce((sum, category) => sum + category.items.length, 0);
    document.querySelectorAll('.menu-source').forEach((el) => { el.textContent = `${count} פריטים בתפריט`; });
    document.querySelectorAll('.decision-menu small').forEach((el) => { el.textContent = el.textContent.replace(/\d+/, String(count)); });
    const published = menu.publishedAt ? new Date(menu.publishedAt) : null;
    if (published && !Number.isNaN(published.getTime())) {
      const two = (n) => String(n).padStart(2, '0');
      const text = `${two(published.getDate())}.${two(published.getMonth() + 1)}.${published.getFullYear()}`;
      document.querySelectorAll('.snapshot-note [dir="ltr"]').forEach((el) => { el.textContent = text; });
    }
  }
  decorate();

  if (!cfg.api) return;

  function applyWhenIdle() {
    if (state.pendingReload && body.dataset.screen === 'welcome') location.reload();
  }
  new MutationObserver(applyWhenIdle).observe(body, { attributes: true, attributeFilter: ['data-screen'] });

  async function refresh() {
    state.lastCheck = Date.now();
    try {
      const url = cfg.api + (cfg.api.includes('?') ? '&' : '?') + 'since=' + encodeURIComponent(state.version || '');
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) { state.lastResult = `http ${res.status}`; return; }
      const snap = await res.json();
      if (snap && snap.unchanged) { state.lastResult = 'unchanged'; return; }
      if (!window.SARCAFE_VALID_MENU(snap)) { state.lastResult = 'invalid'; return; }
      if (snap.version && snap.version === state.version) { state.lastResult = 'same'; return; }
      localStorage.setItem(window.SARCAFE_MENU_KEY, JSON.stringify(snap));
      state.lastResult = 'updated';
      state.version = snap.version || null;
      state.pendingReload = true;
      applyWhenIdle();
    } catch (error) {
      state.lastResult = `error ${error && error.message}`;
    }
  }

  // ---- realtime listener (Supabase Realtime / Phoenix channel protocol, broadcast only) ----
  if (!cfg.rt || !cfg.rtKey) { state.push = 'not configured'; refresh(); return; }

  const topic = `realtime:${cfg.rtChannel || 'menu:givat-haviva'}`;
  const wsUrl = `${cfg.rt.replace(/^http/, 'ws').replace(/\/$/, '')}/realtime/v1/websocket?apikey=${encodeURIComponent(cfg.rtKey)}&vsn=1.0.0`;
  let socket;
  let attempt = 0;
  let ref = 0;
  let heartbeat;
  let lastSeen = 0;

  function connect() {
    state.push = 'connecting';
    try { socket = new WebSocket(wsUrl); } catch (_) { return scheduleReconnect(); }

    socket.onopen = () => {
      lastSeen = Date.now();
      socket.send(JSON.stringify({
        topic, event: 'phx_join', ref: String(++ref), join_ref: '1',
        payload: { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, postgres_changes: [], private: false } },
      }));
      heartbeat = setInterval(() => {
        if (Date.now() - lastSeen > 70000) { socket.close(); return; } // silent for too long: reconnect
        socket.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }));
      }, 25000);
    };

    socket.onmessage = (event) => {
      lastSeen = Date.now();
      let message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      if (message.topic !== topic) return;
      if (message.event === 'phx_reply' && message.payload && message.ref !== null) {
        if (message.payload.status === 'ok') { state.push = 'joined'; attempt = 0; refresh(); }
        else { state.push = 'join refused'; }
      } else if (message.event === 'broadcast' && message.payload && message.payload.event === 'menu-updated') {
        refresh();
      } else if (message.event === 'phx_error' || message.event === 'phx_close') {
        socket.close();
      }
    };

    socket.onclose = () => { clearInterval(heartbeat); scheduleReconnect(); };
    socket.onerror = () => { try { socket.close(); } catch (_) { /* already closed */ } };
  }

  function scheduleReconnect() {
    state.push = 'reconnecting';
    attempt += 1;
    setTimeout(connect, Math.min(60000, 3000 * attempt));
  }

  connect();
})();
