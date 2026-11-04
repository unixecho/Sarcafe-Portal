/*
 * Sarcafe kiosk app: the header says who is on shift and when the place closes.
 *
 *   במשמרת: דנה, יוסי · סגירה ב־22:00
 *
 * Where it comes from: GET <portal>/api/kiosk/shift (the kiosk's shared key; the branch is the one THIS tablet is linked to,
 * see kiosk-config.js). The portal answers first names only, from the published schedule, and only what this tablet's
 * settings ask to show (display.showEmployees / showClosing); the closing time is the end of the running shifts, pushed
 * later while another shift takes over at that minute (lib/kiosk/shift-project.ts). "Closing at" can also come from the
 * branch's opening hours (display.closingSource), which the content answer already carries: when no shift is published,
 * or by choice.
 *
 * Quiet by design: asked once a minute while the screen is on, never over the privacy reset (nothing here is customer
 * data), shown only when there is something true to say. An answer older than five minutes (offline) is not shown: a
 * stale name would be worse than none. Every name goes in as text, never as HTML.
 */
(() => {
  const header = document.querySelector('.kiosk-header');
  const C = window.KioskConfig;
  if (!header || !C) return;
  const I = window.KioskI18n;
  const kioskScreen = document.querySelector('.kiosk-screen');

  const POLL_MS = 60000;
  const STALE_MS = 5 * 60000;
  const MAX_SHOWN = 3;

  // ---- the markup: the branch and the item count move into one container, the shift chips join them ------------------
  const info = document.createElement('div');
  info.className = 'kiosk-info';
  const branch = header.querySelector('.branch');
  const count = header.querySelector('.menu-source');
  const shift = document.createElement('div');
  shift.className = 'kiosk-shift';
  shift.hidden = true;
  const who = document.createElement('span');
  who.className = 'ks-chip ks-who';
  const close = document.createElement('span');
  close.className = 'ks-chip ks-close';
  shift.append(who, close);
  [branch, count, shift].forEach((node) => { if (node) info.append(node); });
  const sw = header.querySelector('.lang-switch');
  if (sw) header.insertBefore(info, sw); else header.append(info);

  const t = (key, fallback) => (I ? I.t(key) : fallback);
  const lang = () => (I ? I.lang : 'he');

  // ---- what the portal said ---------------------------------------------------------------------------------------------
  const state = { people: [], closesAt: null, at: 0 };
  let polling = false;
  let timer;

  async function poll() {
    if (polling || document.hidden) return;
    const url = C.url('shift');
    const headers = C.headers();
    const wants = C.get('display.showEmployees') || (C.get('display.showClosing') && C.get('display.closingSource') !== 'hours');
    if (!url || !headers || !wants) { render(); return; }
    polling = true;
    const abort = new AbortController();
    const cut = setTimeout(() => abort.abort(), 8000);
    try {
      const res = await fetch(url, { headers, cache: 'no-store', signal: abort.signal });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || data.ok !== true) return;
      state.people = Array.isArray(data.people) ? data.people.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim().slice(0, 16)).slice(0, 6) : [];
      state.closesAt = typeof data.closesAt === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(data.closesAt) ? data.closesAt : null;
      state.at = Date.now();
    } catch (_) {
      // offline or a bad answer: what is shown ages out by itself (STALE_MS)
    } finally {
      clearTimeout(cut);
      polling = false;
      render();
    }
  }

  // ---- the branch's opening hours (kiosk-attract.js carries them): today's closing time while the place is open --------------
  function closingFromHours() {
    const content = window.KioskContent;
    const hours = content && content.hours;
    if (!hours) return null;
    let parts;
    try {
      parts = new Intl.DateTimeFormat('en-CA', { timeZone: hours.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    } catch (_) { return null; }
    const get = (type) => (parts.find((p) => p.type === type) || {}).value || '00';
    const date = `${get('year')}-${get('month')}-${get('day')}`;
    const nowMin = Number(get('hour') === '24' ? '00' : get('hour')) * 60 + Number(get('minute'));
    const weekday = new Date(Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')))).getUTCDay();
    const exception = (hours.exceptions || []).find((e) => e.date === date);
    const today = exception ? (exception.closed ? null : { open: exception.open, close: exception.close }) : (hours.week || []).find((d) => d.day === weekday);
    if (!today || !today.open || !today.close) return null;
    const min = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
    const open = min(today.open);
    const closeAt = min(today.close);
    const openNow = closeAt > open ? nowMin >= open && nowMin < closeAt : nowMin >= open || nowMin < closeAt;
    return openNow ? today.close : null;
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------------
  const labelled = (node, label, valueText, ltr) => {
    node.replaceChildren();
    const small = document.createElement('span');
    small.className = 'ks-label';
    small.textContent = label;
    const value = document.createElement('b');
    value.textContent = valueText;
    if (ltr) value.dir = 'ltr';
    node.append(small, value);
  };

  function render() {
    const fresh = Date.now() - state.at < STALE_MS;
    const showWho = C.get('display.showEmployees') && fresh && state.people.length > 0;
    const source = C.get('display.closingSource');
    let closes = null;
    if (C.get('display.showClosing')) {
      const fromShift = fresh ? state.closesAt : null;
      closes = source === 'shift' ? fromShift : source === 'hours' ? closingFromHours() : (fromShift || closingFromHours());
    }

    if (showWho) {
      const names = state.people.length > MAX_SHOWN ? `${state.people.slice(0, MAX_SHOWN).join(', ')} +${state.people.length - MAX_SHOWN}` : state.people.join(', ');
      labelled(who, `${t('shiftOn', 'במשמרת')}:`, names, false);
    }
    if (closes) labelled(close, t('closingAt', 'סגירה ב־'), closes, true);
    who.hidden = !showWho;
    close.hidden = !closes;
    const any = showWho || !!closes;
    shift.hidden = !any;
    header.classList.toggle('has-shift', any);
    fit();
  }

  // the panels start under the header, whatever height it has (a second row in portrait when the chips show)
  function fit() {
    if (!kioskScreen) return;
    const h = Math.max(68, Math.round(header.getBoundingClientRect().height));
    kioskScreen.style.setProperty('--kx-top', `${h}px`);
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(header);
  window.addEventListener('resize', fit);

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { poll().finally(schedule); }, POLL_MS);
  }

  C.onChange(() => { poll(); render(); });
  if (I) I.onChange(render);
  window.addEventListener('kiosk:content', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll(); render(); } });

  render();
  setTimeout(() => { poll().finally(schedule); }, 1200);
  window.KioskShift = { get people() { return state.people.slice(); }, get closesAt() { return state.closesAt; }, get at() { return state.at; }, poll, render, closingFromHours };
})();
