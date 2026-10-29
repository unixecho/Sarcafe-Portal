/*
 * Sarcafe kiosk app: the ONE session controller (privacy reset). Replaces the old per-screen kiosk-idle.js.
 *
 * The kiosk is a shared device, so every visit ends with a clean screen. One state machine owns that:
 *
 *   ATTRACT    the welcome screen with the rotating announcements; public, nothing typed, no timers running
 *   ACTIVE     a customer is using the kiosk (any screen other than welcome); ONE inactivity timer runs
 *   WARNING    no interaction for idleSeconds (default 60): a modal counts graceSeconds (default 10) down;
 *              "אני עדיין כאן" closes it and keeps the same screen and data, "סיום ואיפוס" resets at once
 *   RESETTING  the screen fades out, any sign-up still being sent is waited for (capped), every clearer runs,
 *              the welcome screen is shown while dark
 *   CLEAN      the reset finished; only from here does the kiosk go back to ATTRACT (the ads never start over a
 *              populated form)
 *
 * Deadlines are wall-clock (Date.now()), checked again when the page becomes visible: a screen that was off past
 * its deadline is reset immediately on return, never trusted to a paused timer. A late response from a sign-up
 * that started before a reset can never touch the screen: every reset bumps `generation`, and kiosk-signup.js only
 * acts on a response whose generation is still current.
 *
 * What a reset clears: every input, checkbox and validation/error message, the phone summary, the chosen menu
 * category, every scroll position, the focused element, the keyboard layout state, sessionStorage (the kiosk keeps
 * nothing there), and what the other layers registered (sign-up request id, legal "back" target). What it keeps:
 * localStorage (sarcafe.menu.v1 the pushed menu, sarcafe.kiosk.content.v1 the announcements, sarcafe.perf.* the speed
 * setting) and everything the Android app stores (endpoint, keys, orientation, staff PIN). Nothing is deleted on the
 * server; the kiosk has no delete call.
 *
 * Other layers use window.KioskSession:
 *   state, generation, onChange(fn), registerClearer(fn), interacting(), resetNow(reason), hold(promise, capMs),
 *   isCurrent(generation), configure({ idleSeconds, graceSeconds }), clearCustomerData(reason), scale
 *
 * Test hook: ?kioskTestScale=0.05 multiplies every duration (the kiosk has no address bar; ignored unless set).
 */
(() => {
  const body = document.body;
  const kioskScreen = document.querySelector('.kiosk-screen');
  if (!kioskScreen) return;

  const scale = (() => {
    const match = /[?&]kioskTestScale=([0-9.]+)/.exec(location.search);
    const value = match ? Number(match[1]) : 1;
    return value > 0 && value <= 1 ? value : 1;
  })();

  const settings = { idleSeconds: 60, graceSeconds: 10 };
  const SUCCESS_SECONDS = 10;  // the confirmation holds no personal data: it goes home quietly, no warning needed
  const FADE_MS = 650;         // matches .kiosk-screen.is-fading in kiosk-app.css
  const LATE_MS = 2000;        // a timer this late means the device slept or the page was hidden
  const HOLD_CAP_MS = 16000;   // the sign-up request aborts itself at 15 s

  let state = 'CLEAN';
  let generation = 0;
  let idleDeadline = 0;
  let graceDeadline = 0;
  let idleTimer;
  let graceTimer;
  let tickTimer;
  let resetting = null;
  const listeners = [];
  const clearers = [];
  const holds = new Set();

  const now = () => Date.now();
  const screen = () => body.dataset.screen;
  const go = (name) => document.querySelector(`.screen-picker [data-screen="${name}"]`)?.click();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const instant = () => document.documentElement.dataset.perf === 'lite'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setState(next, info) {
    if (state === next) return;
    const prev = state;
    state = next;
    body.dataset.session = next.toLowerCase();
    listeners.slice().forEach((fn) => { try { fn(next, prev, info || {}); } catch (_) { /* one layer must not stop the others */ } });
  }

  // ---- the warning modal ---------------------------------------------------------------------------------------
  const modal = document.createElement('div');
  modal.className = 'kiosk-warning';
  modal.hidden = true;
  modal.setAttribute('role', 'alertdialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'kiosk-warning-title');
  modal.setAttribute('aria-describedby', 'kiosk-warning-text');
  modal.innerHTML = `
    <div class="kiosk-warning-card">
      <strong class="kiosk-warning-count" dir="ltr" aria-hidden="true">10</strong>
      <h2 id="kiosk-warning-title">עדיין כאן?</h2>
      <p id="kiosk-warning-text">לא זיהינו פעילות כבר זמן מה. המסך יתאפס כדי לשמור על פרטיותכם.</p>
      <p class="kiosk-warning-left" aria-live="polite">האיפוס בעוד <b dir="ltr">10</b> שניות</p>
      <span class="kiosk-warning-bar" aria-hidden="true"><i></i></span>
      <button type="button" class="dialog-primary" data-session="stay">אני עדיין כאן</button>
      <button type="button" class="dialog-secondary" data-session="reset">סיום ואיפוס</button>
    </div>`;
  kioskScreen.appendChild(modal);
  const countEl = modal.querySelector('.kiosk-warning-count');
  const leftEl = modal.querySelector('.kiosk-warning-left b');
  const barEl = modal.querySelector('.kiosk-warning-bar i');
  const stayButton = modal.querySelector('[data-session="stay"]');

  function showCount() {
    const left = Math.max(0, Math.ceil((graceDeadline - now()) / (1000 * scale)));
    countEl.textContent = String(left);
    leftEl.textContent = String(left);
  }

  function openModal() {
    modal.hidden = false;
    showCount();
    const graceMs = settings.graceSeconds * 1000 * scale;
    barEl.style.transition = 'none';
    barEl.style.transform = 'scaleX(1)';
    void modal.offsetWidth; // start both transitions from their first frame
    modal.classList.add('is-open');
    if (!instant()) {
      barEl.style.transition = `transform ${graceMs}ms linear`;
      barEl.style.transform = 'scaleX(0)';
    }
    stayButton.focus({ preventScroll: true }); // also closes the system keyboard, so the modal is never hidden behind it
  }

  function closeModal() {
    modal.classList.remove('is-open');
    modal.hidden = true;
    barEl.style.transition = 'none';
  }

  modal.addEventListener('click', (event) => {
    const button = event.target.closest('[data-session]');
    if (!button) return;
    if (button.dataset.session === 'stay') stay();
    else resetNow('customer');
  });
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); stay(); return; }
    if (event.key !== 'Tab') return;
    const buttons = [...modal.querySelectorAll('button')];
    const at = buttons.indexOf(document.activeElement);
    event.preventDefault();
    buttons[(at + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
  });

  // ---- timers: exactly one inactivity timer and one grace timer ------------------------------------------------
  function stopTimers() {
    clearTimeout(idleTimer); idleTimer = undefined;
    clearTimeout(graceTimer); graceTimer = undefined;
    clearInterval(tickTimer); tickTimer = undefined;
  }

  const quietScreen = () => screen() === 'success';

  function arm() {
    if (state !== 'ACTIVE') return;
    const seconds = quietScreen() ? Math.min(SUCCESS_SECONDS, settings.idleSeconds) : settings.idleSeconds;
    idleDeadline = now() + seconds * 1000 * scale;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => check(true), idleDeadline - now());
  }

  function warn() {
    stopTimers();
    setState('WARNING');
    graceDeadline = now() + settings.graceSeconds * 1000 * scale;
    openModal();
    graceTimer = setTimeout(() => check(true), graceDeadline - now());
    tickTimer = setInterval(showCount, Math.max(50, 250 * scale));
  }

  // Compares the wall clock with the deadlines; called by the timers and whenever the page comes back.
  function check(fromTimer) {
    const t = now();
    if (state === 'ACTIVE') {
      if (t < idleDeadline) { clearTimeout(idleTimer); idleTimer = setTimeout(() => check(true), idleDeadline - t); return; }
      if (!fromTimer || t - idleDeadline > LATE_MS || quietScreen()) { resetNow(quietScreen() ? 'done' : 'timeout-away'); return; }
      warn();
    } else if (state === 'WARNING') {
      if (t >= graceDeadline) { resetNow('timeout'); return; }
      clearTimeout(graceTimer);
      graceTimer = setTimeout(() => check(true), graceDeadline - t);
      showCount();
    }
  }

  function stay() {
    if (state !== 'WARNING') return;
    stopTimers();
    closeModal();
    setState('ACTIVE');
    arm();
  }

  // ---- what a reset clears -------------------------------------------------------------------------------------
  function clearScreen() {
    kioskScreen.querySelectorAll('form').forEach((form) => form.reset());
    kioskScreen.querySelectorAll('input, textarea, select').forEach((el) => {
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
      else if (!/^(button|submit|reset|hidden)$/.test(el.type)) el.value = '';
      if (el.setCustomValidity) el.setCustomValidity('');
    });
    kioskScreen.querySelectorAll('.quick-message, .consent-message').forEach((el) => { el.textContent = ''; });
    kioskScreen.querySelectorAll('[data-phone-summary]').forEach((el) => { el.textContent = '—'; });
    kioskScreen.querySelectorAll('.submit-consent, .quick-submit').forEach((el) => { el.disabled = false; });
    // the menu goes back to its first category (app.js keeps the choice, so ask it through its own tab)
    const firstTab = kioskScreen.querySelector('.category-tabs [data-category]');
    if (firstTab && firstTab.getAttribute('aria-selected') !== 'true') firstTab.click();
    kioskScreen.querySelectorAll('.panel, .category-tabs, .menu-content, .privacy-copy').forEach((el) => {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    });
    window.scrollTo(0, 0);
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    body.classList.remove('kb-open');
    try { sessionStorage.clear(); } catch (_) { /* not available: nothing was kept there either */ }
  }

  function runClearers(reason) {
    clearScreen();
    clearers.forEach((fn) => { try { fn(reason); } catch (_) { /* a failing layer must not stop the reset */ } });
  }

  function waitForHolds() {
    if (!holds.size) return Promise.resolve();
    return Promise.race([Promise.allSettled([...holds]), wait(HOLD_CAP_MS)]); // real network time: never scaled
  }

  // The whole reset. A person tapping home is not slowed down by the fade (that tap is theirs).
  function resetNow(reason, options) {
    if (resetting) return resetting;
    const fade = !(options && options.fade === false) && !instant();
    stopTimers();
    closeModal();
    generation += 1; // from here on, any answer to an earlier request is ignored
    setState('RESETTING', { reason });
    resetting = (async () => {
      if (fade) {
        kioskScreen.classList.add('is-fading');
        await wait(FADE_MS * scale);
      }
      await waitForHolds(); // a sign-up being sent is never cut off mid-air; its outcome is simply not shown
      runClearers(reason);
      if (screen() !== 'welcome') go('welcome');
      setState('CLEAN', { reason });
      // a timer, not requestAnimationFrame: a screen that is off pauses frames and the page must not stay dark
      if (fade) setTimeout(() => kioskScreen.classList.remove('is-fading'), 80);
      resetting = null;
      setState('ATTRACT', { reason });
    })();
    return resetting;
  }

  // ---- what counts as a customer interaction -------------------------------------------------------------------
  function interacting() {
    if (state === 'ACTIVE') arm();
  }
  const onInput = (event) => {
    if (state === 'WARNING' || state === 'RESETTING') return; // while warned, only the modal's buttons count
    if (event.type === 'keydown' && !event.isTrusted) return;
    interacting();
  };
  ['pointerdown', 'touchstart', 'touchmove', 'keydown', 'input', 'wheel'].forEach((type) =>
    document.addEventListener(type, onInput, { capture: true, passive: true }));

  // ---- the screen tells the state ------------------------------------------------------------------------------
  new MutationObserver(() => {
    const name = screen();
    if (state === 'RESETTING') return;
    if (name === 'welcome') {
      // the customer went home themselves (the header's home button): their data goes with them
      if (state === 'ACTIVE' || state === 'WARNING') resetNow('home', { fade: false });
      return;
    }
    if (name === 'inactivity') return; // the prototype's static mock of this dialog; the app never opens it
    if (state === 'ATTRACT' || state === 'CLEAN') setState('ACTIVE');
    if (state === 'ACTIVE') arm(); // a new screen (also one a sign-up answer opened) restarts the clock
  }).observe(body, { attributes: true, attributeFilter: ['data-screen'] });

  // ---- screen off / app in the background ----------------------------------------------------------------------
  const back = () => { if (!document.hidden) check(false); };
  document.addEventListener('visibilitychange', back);
  window.addEventListener('pageshow', back);
  window.addEventListener('focus', back);

  // ---- public API ----------------------------------------------------------------------------------------------
  const clampSeconds = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };

  window.KioskSession = {
    get state() { return state; },
    get generation() { return generation; },
    get settings() { return { idleSeconds: settings.idleSeconds, graceSeconds: settings.graceSeconds }; },
    scale,
    onChange(fn) {
      listeners.push(fn);
      return () => { const at = listeners.indexOf(fn); if (at >= 0) listeners.splice(at, 1); };
    },
    registerClearer(fn) { if (typeof fn === 'function') clearers.push(fn); },
    interacting,
    resetNow: (reason) => resetNow(reason || 'api'),
    // keeps a reset waiting until the promise settles (never longer than the cap)
    hold(promise, capMs) {
      const capped = Promise.race([Promise.resolve(promise).catch(() => {}), wait(Math.min(capMs || HOLD_CAP_MS, HOLD_CAP_MS))]);
      const entry = capped.then(() => { holds.delete(entry); });
      holds.add(entry);
      return promise;
    },
    isCurrent: (gen) => gen === generation && !resetting,
    // a finished sign-up: wipe what was typed without leaving the screen flow (the confirmation comes next)
    clearCustomerData(reason) { generation += 1; runClearers(reason || 'submitted'); },
    configure(next) {
      if (!next) return;
      settings.idleSeconds = clampSeconds(next.idleSeconds, 30, 300, settings.idleSeconds);
      settings.graceSeconds = clampSeconds(next.graceSeconds, 5, 30, settings.graceSeconds);
      if (state === 'ACTIVE') arm();
    },
  };

  // the app always opens on the welcome screen, which is clean
  if (screen() === 'welcome') setState('ATTRACT', { reason: 'start' });
  else { setState('ACTIVE'); arm(); }
})();
