/*
 * Sarcafe kiosk app: use the last menu the dashboard pushed, if there is one.
 * Loaded between the prototype's menu-data.js (the menu shipped inside the app) and app.js. The pushed copy
 * lives in localStorage, so it survives restarts; it is validated before use and ignored if it looks wrong.
 */
(() => {
  const KEY = 'sarcafe.menu.v1';

  const validMenu = (m) => !!m && Array.isArray(m.categories) && m.categories.length > 0
    && m.categories.every((c) => c && typeof c.id === 'string' && typeof c.title === 'string'
      && Array.isArray(c.items) && c.items.every((i) => i && typeof i.name === 'string'
        && (typeof i.price === 'number' || typeof i.price === 'string')));

  window.SARCAFE_VALID_MENU = validMenu;
  window.SARCAFE_MENU_KEY = KEY;

  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (validMenu(stored)) window.SARCAFE_MENU = stored;
  } catch (_) { /* no usable cached menu: the one shipped in the app stays */ }
})();
