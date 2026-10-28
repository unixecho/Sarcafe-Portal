/*
 * Sarcafe kiosk app: the real inactivity timer (the prototype only has a static "still with us?" screen).
 *  - screens where someone types or reads personal details (phone, sign-up, privacy): after a short pause the
 *    "still with us?" dialog counts down 15 s, then the form is cleared and the kiosk returns to the welcome screen
 *  - browsing screens (choice, menu): after a longer pause the kiosk quietly returns to the welcome screen
 *  - success / error screens return by themselves after a few seconds
 *  - every return to the welcome screen by the timer fades out, resets while dark, and fades back in
 */
(() => {
  const body = document.body;
  const LIMIT_SECONDS = { choice: 90, menu: 90, join: 45, consent: 45, privacy: 120, terms: 120, success: 12, error: 30 };
  const COUNTDOWN_SECONDS = 15;
  const ENTRY_SCREENS = new Set(['join', 'consent', 'privacy', 'terms']);
  const FADE_OUT_MS = 650; // matches .kiosk-screen.is-fading in kiosk-app.css

  const secondsEl = document.querySelector('.idle-dialog .seconds');
  const kioskScreen = document.querySelector('.kiosk-screen');
  let idleTimer;
  let countTimer;
  let returnTo = 'consent';

  const screen = () => body.dataset.screen;
  // the hidden screen picker / dialog buttons are the prototype's own switches; clicking them is what the app does too
  const go = (name) => document.querySelector(`.screen-picker [data-screen="${name}"]`)?.click();
  const clearNow = () => document.querySelector('.idle-dialog [data-clear]')?.click();
  // When the timer ends the screen fades out, the form is wiped and the welcome screen is shown while it is dark,
  // then it fades back in. (A person pressing "clear and finish" themselves is not delayed: that click is theirs.)
  function clearAndHome() {
    if (!kioskScreen) { clearNow(); return; }
    kioskScreen.classList.add('is-fading');
    setTimeout(() => {
      clearNow();
      // a timer, not requestAnimationFrame: a screen that is off or hidden pauses frames, and the page must not stay dark
      setTimeout(() => kioskScreen.classList.remove('is-fading'), 80);
    }, FADE_OUT_MS);
  }

  const stopCountdown = () => { clearInterval(countTimer); countTimer = undefined; };

  function arm() {
    clearTimeout(idleTimer);
    const limit = LIMIT_SECONDS[screen()];
    if (limit) idleTimer = setTimeout(onIdle, limit * 1000);
  }

  function onIdle() {
    if (window.__kioskBusy) { arm(); return; } // a sign-up is being sent: never wipe it mid-air
    const name = screen();
    if (ENTRY_SCREENS.has(name)) {
      returnTo = name;
      go('inactivity');
    } else {
      clearAndHome();
    }
  }

  function startCountdown() {
    stopCountdown();
    let left = COUNTDOWN_SECONDS;
    if (secondsEl) secondsEl.textContent = String(left);
    countTimer = setInterval(() => {
      left -= 1;
      if (secondsEl) secondsEl.textContent = String(Math.max(left, 0));
      if (left <= 0) {
        stopCountdown();
        if (window.__kioskBusy) { go(returnTo); return; }
        clearAndHome();
      }
    }, 1000);
  }

  new MutationObserver(() => {
    if (screen() === 'inactivity') { clearTimeout(idleTimer); startCountdown(); }
    else { stopCountdown(); arm(); }
  }).observe(body, { attributes: true, attributeFilter: ['data-screen'] });

  // any touch or key on a normal screen restarts the clock; while the dialog is up only its buttons count
  const touched = () => { if (screen() !== 'inactivity') arm(); };
  ['pointerdown', 'touchstart', 'keydown', 'input'].forEach((type) =>
    document.addEventListener(type, touched, { capture: true, passive: true }));

  // "yes, continue" returns to where the person was (the prototype's own button always jumps to the sign-up screen)
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.idle-dialog .dialog-primary')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stopCountdown();
    go(returnTo);
  }, true);

  arm();
})();
