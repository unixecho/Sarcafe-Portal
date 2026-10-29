/*
 * Sarcafe kiosk app: the last layer. Tells the Android app that the page booted, so an over-the-air update that
 * breaks the page can be rolled back. Only reached when every earlier layer ran; it reports only if the session
 * controller is up (without it the kiosk cannot keep visitors' details private, so that bundle is not "ready").
 * The bridge is absent in a desktop browser.
 */
(() => {
  if (!window.KioskSession || typeof window.KioskSession.state !== 'string') return;
  const version = typeof window.SARCAFE_BUNDLE_VERSION === 'string' ? window.SARCAFE_BUNDLE_VERSION : '';
  try {
    if (window.KioskNative && typeof window.KioskNative.ready === 'function') window.KioskNative.ready(version);
  } catch (_) { /* the native side decides what a missing answer means */ }
})();
