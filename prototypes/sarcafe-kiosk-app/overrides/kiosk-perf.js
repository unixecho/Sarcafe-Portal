/*
 * Sarcafe kiosk app: a lighter version for slow devices, with the same animations.
 *
 * Runs first, in <head>, so the right version is chosen before anything is painted. It sets
 * <html data-perf="full|lite">; kiosk-app.css then keeps every animation but makes the expensive parts cheaper
 * (no soft shadows, only the visible photo drifts, simpler panel entrance, photos decoded off the main thread).
 *
 * How it decides (mode comes from the staff menu on the tablet, or from localStorage "sarcafe.perf.mode" on the web):
 *   full  always the full version        lite  always the light one
 *   auto  (default) light when the device says it is weak, or when a short frame-rate test on this very page
 *         measures slow drawing; the test result is remembered so the next load starts right
 * On the web (not the kiosk app) a person on a weak device is ASKED, once, whether to load the light version; in the
 * kiosk app, which staff manage, it switches by itself and the staff menu can force full.
 */
(() => {
  const root = document.documentElement;
  const inApp = !!window.SarcafeKiosk;
  let cfg = {};
  try { cfg = JSON.parse((inApp && window.SarcafeKiosk.config()) || '{}') || {}; } catch (_) { cfg = {}; }

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* private mode: the choice just is not remembered */ } },
  };

  const mode = (inApp ? cfg.perf : store.get('sarcafe.perf.mode')) || 'auto';
  const epoch = String(cfg.perfEpoch || 0);

  // what the device says about itself
  function weakByProfile() {
    const reasons = [];
    const chrome = /Chrome\/(\d+)/.exec(navigator.userAgent);
    if (chrome && Number(chrome[1]) < 80) reasons.push('old browser engine');
    if (navigator.deviceMemory && navigator.deviceMemory <= 2) reasons.push('2 GB of memory or less');
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) reasons.push('2 processor cores or fewer');
    if (navigator.connection && navigator.connection.saveData) reasons.push('data saver is on');
    return reasons;
  }

  let remembered = null;
  try { remembered = JSON.parse(store.get('sarcafe.perf.probe') || 'null'); } catch (_) { remembered = null; }
  const probeValid = remembered && remembered.epoch === epoch;

  let decided = 'full';
  let why = 'default';
  if (mode === 'lite') { decided = 'lite'; why = 'forced'; }
  else if (mode === 'full') { decided = 'full'; why = 'forced'; }
  else {
    const reasons = weakByProfile();
    if (reasons.length) { decided = 'lite'; why = reasons.join(', '); }
    else if (probeValid) { decided = remembered.result; why = 'frame test (remembered)'; }
  }
  root.dataset.perf = decided;
  window.__kioskPerf = { mode, decided, why, fps: null };

  // ---- the frame-rate test: ~40 frames after the page has settled; only in auto mode and only once per setting ----
  function probe() {
    if (mode !== 'auto' || probeValid || weakByProfile().length) return;
    const gaps = [];
    let last = 0;
    const step = (now) => {
      if (last) gaps.push(now - last);
      last = now;
      if (gaps.length < 40) { requestAnimationFrame(step); return; }
      gaps.sort((a, b) => a - b);
      const p75 = gaps[Math.floor(gaps.length * 0.75)];   // the slow end, ignoring one-off hiccups
      const fps = Math.round(1000 / p75);
      window.__kioskPerf.fps = fps;
      const result = p75 > 33 ? 'lite' : 'full';          // under ~30 frames a second: light
      store.set('sarcafe.perf.probe', JSON.stringify({ result, epoch, fps, at: Date.now() }));
      if (result === 'lite' && decided !== 'lite') {
        decided = 'lite';
        window.__kioskPerf.decided = 'lite';
        window.__kioskPerf.why = `frame test: ${fps} fps`;
        root.dataset.perf = 'lite';
      }
    };
    requestAnimationFrame(step);
  }
  window.addEventListener('load', () => setTimeout(probe, 2500));

  // ---- the web visitor is asked once; the kiosk app is not ----
  if (!inApp && mode === 'auto' && decided === 'lite' && !store.get('sarcafe.perf.asked')) {
    root.dataset.perf = 'full'; // keep the full version until the person says yes
    window.addEventListener('DOMContentLoaded', () => {
      const bar = document.createElement('div');
      bar.className = 'perf-bar';
      bar.setAttribute('role', 'dialog');
      bar.setAttribute('aria-label', 'גרסה קלה');
      bar.innerHTML = '<span>נראה שהמכשיר שלך איטי. לטעון גרסה קלה יותר, עם אותן אנימציות?</span><button type="button" data-perf="lite">כן, גרסה קלה</button><button type="button" data-perf="full">לא, להשאיר</button>';
      bar.addEventListener('click', (event) => {
        const choice = event.target.closest('[data-perf]');
        if (!choice) return;
        store.set('sarcafe.perf.asked', '1');
        store.set('sarcafe.perf.mode', choice.dataset.perf);
        root.dataset.perf = choice.dataset.perf;
        bar.remove();
      });
      document.body.appendChild(bar);
    });
  }
})();
