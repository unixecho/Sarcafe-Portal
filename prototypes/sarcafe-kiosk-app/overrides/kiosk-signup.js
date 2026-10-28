/*
 * Sarcafe kiosk app: the sign-up really goes to the system.
 *
 * The prototype's sign-up only pretended (it cleared the form and showed "you're on the list"). Here the form is
 * sent to the portal (POST .../api/kiosk/waitlist), which stores it, records the dated consent and tells the owner
 * and the developer. Rules:
 *  - the person sees "success" only after the server said yes
 *  - nothing is queued or kept on the tablet if the network or the server fails: a generic message, form cleared by
 *    the idle timer, and the person can try again
 *  - one request id per form fill, reused for a retry, so a retry can never create a second sign-up
 *  - the idle reset is held back (window.__kioskBusy) while a request is in flight
 * Where to send it and the kiosk's key are set over adb (see MainActivity); with nothing configured the kiosk
 * says it cannot register right now instead of pretending.
 */
(() => {
  const form = document.querySelector('.consent-form');
  const phoneInput = document.getElementById('quick-phone');
  if (!form || !phoneInput) return;

  let cfg = {};
  try { cfg = JSON.parse((window.SarcafeKiosk && window.SarcafeKiosk.config()) || '{}') || {}; } catch (_) { cfg = {}; }

  const message = form.querySelector('.consent-message');
  const submit = form.querySelector('.submit-consent');
  const go = (name) => document.querySelector(`.screen-picker [data-screen="${name}"]`)?.click();
  const clearAll = () => document.querySelector('.idle-dialog [data-clear]')?.click();
  // the message sits under the button, below the fold on a tablet: bring it into view so the person always sees why
  const say = (text) => {
    if (!message) return;
    message.textContent = text;
    if (text) message.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const endpoint = cfg.api ? cfg.api.replace(/\/menu(\?.*)?$/, '/waitlist') : '';
  const newId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  let requestId = newId();
  let sending = false;

  // a fresh form means a fresh request id
  document.addEventListener('click', (event) => { if (event.target.closest('[data-clear]')) requestId = newId(); }, true);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation(); // the prototype's own handler would fake a success
    if (sending) return;

    const firstName = form.elements.firstName.value.trim();
    const email = (form.elements.email.value || '').trim();
    const acknowledged = form.elements.privacy.checked;
    if (!firstName || !acknowledged) {
      say('כדי להמשיך צריך שם פרטי ואישור הודעת הפרטיות ותנאי השימוש.');
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      say('כתובת הדוא״ל לא נראית תקינה. אפשר גם להשאיר אותה ריקה.');
      form.elements.email.focus();
      return;
    }
    const phone = phoneInput.value.replace(/\D/g, '');
    if (!/^05\d{8}$/.test(phone)) { go('join'); return; }
    if (!endpoint || !cfg.signupKey) { go('error'); return; }

    const versions = window.SARCAFE_LEGAL_VERSIONS || {};
    const body = {
      firstName, phone, email, acknowledged: true, marketing: !!form.elements.marketing.checked,
      requestId, privacyVersion: versions.privacy, consentVersion: versions.consent, termsVersion: versions.terms, website: '',
    };

    sending = true;
    window.__kioskBusy = true;
    if (submit) submit.disabled = true;
    say('');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kiosk-Key': cfg.signupKey },
        body: JSON.stringify(body),
        signal: abort.signal,
        cache: 'no-store',
      });
      if (res.ok) {
        clearAll();           // clears every field and returns to the welcome screen...
        go('success');        // ...then shows the confirmation
        return;
      }
      if (res.status === 409) {
        // already on the list: nothing was changed. Say so plainly, keep the person on this screen, and let them change the number.
        say('המספר הזה כבר רשום ברשימה, ואין צורך להירשם שוב. אם הקלדתם מספר אחר בטעות, אפשר לשנות אותו.');
      } else if (res.status === 400) say('משהו בפרטים לא נקלט. בדקו את השם, המספר והדוא״ל ונסו שוב.');
      else go('error');
    } catch (_) {
      go('error');
    } finally {
      clearTimeout(timer);
      sending = false;
      window.__kioskBusy = false;
      if (submit) submit.disabled = false;
    }
  }, true);
})();
