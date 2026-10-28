/*
 * Sarcafe kiosk app overrides (see kiosk-app.css). Runs after the prototype's app.js, inside the app only.
 *  - phone field: the tablet's system keyboard always offers symbols (+ - / ( ) * #) next to the digits, so the
 *    phone number is typed on a built-in 0-9 keypad instead and the system keyboard is kept away from that field
 *  - other fields (name, e-mail): the system keyboard is used; the page makes room and keeps the field in view
 *  - kiosk hygiene: no context menu, no drag, no text selection outside fields
 */
(() => {
  const body = document.body;
  const phone = document.getElementById('quick-phone');

  if (phone) {
    const set = (name, value) => phone.setAttribute(name, value);
    set('type', 'text');
    set('inputmode', 'none');          // never open the system keyboard for this field
    set('pattern', '[0-9]*');
    set('autocomplete', 'off');
    set('autocorrect', 'off');
    set('autocapitalize', 'off');
    set('spellcheck', 'false');
    set('maxlength', '11');            // 10 digits plus the dash
    set('aria-label', 'מספר נייד');

    const MAX_DIGITS = 10;
    const digitsOf = () => phone.value.replace(/\D/g, '');
    const show = (digits) => {
      const d = digits.slice(0, MAX_DIGITS);
      phone.value = d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
    };
    // anything that is not a digit (hardware keyboard, paste) is dropped
    phone.addEventListener('input', () => show(digitsOf()));
    phone.addEventListener('keypress', (event) => {
      if (event.key.length === 1 && /\D/.test(event.key)) event.preventDefault();
    });

    const pad = document.createElement('div');
    pad.className = 'numpad';
    pad.setAttribute('role', 'group');
    pad.setAttribute('aria-label', 'מקלדת ספרות');
    pad.dir = 'ltr';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
    const label = { clear: 'נקה', back: '⌫' };
    pad.append(...keys.map((key) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.key = key;
      button.textContent = label[key] || key;
      if (key === 'back') button.setAttribute('aria-label', 'מחיקת ספרה');
      if (key === 'clear' || key === 'back') button.classList.add('numpad-aux');
      return button;
    }));
    pad.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      const key = button.dataset.key;
      if (key === 'clear') show('');
      else if (key === 'back') show(digitsOf().slice(0, -1));
      else show(digitsOf() + key);
      const message = document.querySelector('.quick-message');
      if (message) message.textContent = '';
    });
    phone.insertAdjacentElement('afterend', pad);
  }

  // the phone field is typed on the keypad, so only fields that really open the system keyboard count here
  const isField = (el) => !!el && /^(INPUT|TEXTAREA)$/.test(el.tagName)
    && !/^(checkbox|radio|button|submit)$/.test(el.type) && el.inputMode !== 'none';
  const keepInView = (el) => {
    [120, 450, 900].forEach((ms) => setTimeout(() => {
      if (el.isConnected && el === document.activeElement) el.scrollIntoView({ block: 'center' });
    }, ms));
  };
  document.addEventListener('focusin', (event) => {
    if (!isField(event.target)) return;
    body.classList.add('kb-open');
    keepInView(event.target);
  });
  document.addEventListener('focusout', () => {
    setTimeout(() => { if (!isField(document.activeElement)) body.classList.remove('kb-open'); }, 150);
  });
  window.addEventListener('resize', () => { if (isField(document.activeElement)) keepInView(document.activeElement); });

  document.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('dragstart', (event) => event.preventDefault());

  // Credit (owner, 2026-10-28): the welcome screen says who made this and why. It is a caption under the footnote, NOT part of the
  // privacy notice or the terms (those are versioned texts; this line is not one of them, so no version id moves with it).
  const footnote = document.querySelector('.panel-welcome .welcome-footnote');
  if (footnote && !footnote.querySelector('.welcome-credit')) {
    const credit = document.createElement('span');
    credit.className = 'welcome-credit';
    credit.textContent = 'פרויקט שנוצר ביוזמת ג׳ון, אחד מעובדי הרשת, לטובת הרשת ובאישורה. המידע שמוסרים כאן ניתן מרצון ובהסכמה.';
    footnote.appendChild(credit);
  }
})();
