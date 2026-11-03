/*
 * Sarcafe kiosk app: the battery reading. A small pill in the bottom corner of every screen (the ads, the menu, the
 * sign-up) with the charge in percent, a bolt while it charges, amber at 30 % and red at 15 % when it is not on charge,
 * so whoever walks past can see at a glance that the tablet needs the charger before it dies.
 *
 * It reads the page's own Battery Status API (the WebView answers for the tablet it runs on). Where a WebView cannot
 * answer, nothing is drawn: a wrong or frozen number would be worse than none. Nothing here is stored, sent or
 * reset by the privacy reset (it holds no visitor data), and it never takes a touch.
 */
(() => {
  if (typeof navigator.getBattery !== 'function' || document.querySelector('.kiosk-battery')) return;

  const SVG_BOLT = '<svg class="kb-bolt" viewBox="0 0 10 14" aria-hidden="true"><path d="M6.2 0 0 8h4l-1 6L10 5.5H5.8z"/></svg>';
  const el = document.createElement('div');
  el.className = 'kiosk-battery';
  el.setAttribute('dir', 'ltr'); // "72%" must not flip in the Hebrew and Arabic layouts
  el.setAttribute('aria-hidden', 'true');
  el.hidden = true;
  el.innerHTML = '<span class="kb-cell"><i class="kb-fill"></i></span><span class="kb-text"></span>' + SVG_BOLT;
  const fill = el.querySelector('.kb-fill');
  const text = el.querySelector('.kb-text');

  const LOW = 30;
  const CRITICAL = 15;
  let battery = null;
  let shown = null;

  function paint() {
    if (!battery || typeof battery.level !== 'number' || !isFinite(battery.level)) { el.hidden = true; return; }
    const percent = Math.max(0, Math.min(100, Math.round(battery.level * 100)));
    const charging = battery.charging === true;
    const key = percent + (charging ? 'c' : '');
    if (key !== shown) {
      shown = key;
      text.textContent = percent + '%';
      fill.style.width = percent + '%';
      el.classList.toggle('is-charging', charging);
      el.classList.toggle('is-low', !charging && percent <= LOW && percent > CRITICAL);
      el.classList.toggle('is-critical', !charging && percent <= CRITICAL);
    }
    el.hidden = false;
  }

  navigator.getBattery().then((b) => {
    battery = b;
    ['levelchange', 'chargingchange'].forEach((name) => b.addEventListener(name, paint));
    document.body.appendChild(el);
    paint();
    // some WebViews fire the events late or not at all on a tablet that sits on a charger for days
    setInterval(paint, 30000);
    window.KioskBattery = { get level() { return battery.level; }, get charging() { return battery.charging; } };
  }).catch(() => { /* no reading: no pill */ });
})();
