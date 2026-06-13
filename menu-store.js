"use strict";

// Shared menu store used by both the public menu pages and the manager.
//
// Default content lives in menu-data.js (the global MENUS). Edits made in the
// manager are saved per-branch in localStorage and override the defaults on
// THIS device — both in the manager's preview and on the public menu pages
// opened on the same device. To publish changes to every customer, export the
// data from the manager and commit it into menu-data.js.

const MENU_STORAGE_PREFIX = "sarcafe-menu:";

function cloneMenu(menu) {
  return JSON.parse(JSON.stringify(menu));
}

const SarcafeMenu = {
  // [{ key, name: { he, en, ar } }] in definition order.
  listBranches() {
    return Object.keys(MENUS).map((key) => ({
      key,
      name: { ...MENUS[key].name },
    }));
  },

  // A fresh, mutable copy of the bundled default for a branch.
  getDefaultMenu(branchKey) {
    return MENUS[branchKey] ? cloneMenu(MENUS[branchKey]) : null;
  },

  hasOverride(branchKey) {
    try {
      return localStorage.getItem(MENU_STORAGE_PREFIX + branchKey) !== null;
    } catch (error) {
      return false;
    }
  },

  // The saved override if one exists and is well-formed, otherwise the
  // default. Always returns a fresh object safe to mutate.
  getMenu(branchKey) {
    try {
      const raw = localStorage.getItem(MENU_STORAGE_PREFIX + branchKey);

      if (raw) {
        const parsed = JSON.parse(raw);

        if (parsed && Array.isArray(parsed.categories)) {
          return parsed;
        }
      }
    } catch (error) {
      // Ignore malformed storage and fall back to the bundled default.
    }

    return this.getDefaultMenu(branchKey);
  },

  saveMenu(branchKey, menu) {
    localStorage.setItem(
      MENU_STORAGE_PREFIX + branchKey,
      JSON.stringify(menu)
    );
  },

  resetMenu(branchKey) {
    localStorage.removeItem(MENU_STORAGE_PREFIX + branchKey);
  },
};

window.SarcafeMenu = SarcafeMenu;
