"use strict";

// Shared menu store used by both the public menu pages and the manager.
//
// Menu content now lives in Supabase (table: public.menus, one row per
// branch, keyed by `slug`). Reads are public (anyone can view the menu);
// writes require an authenticated session (the Sarcafe admin, signed in via
// login.html). See config.js for the Supabase project connection details.

// Branch keys used throughout the app (camelCase, matches the old
// MENUS object) mapped to the `slug` column in the menus table.
const BRANCH_SLUGS = {
  maor: "maor",
  givatHaviva: "givat-haviva",
};

function cloneMenu(menu) {
  return JSON.parse(JSON.stringify(menu));
}

function getSupabaseClient() {
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    throw new Error(
      "config.js is missing — SUPABASE_URL / SUPABASE_ANON_KEY not set."
    );
  }

  if (!window.__sarcafeSupabase) {
    window.__sarcafeSupabase = window.supabase.createClient(
      window.SUPABASE_URL,
      window.SUPABASE_ANON_KEY
    );
  }

  return window.__sarcafeSupabase;
}

// In-memory cache of rows fetched this page-load, keyed by slug. Avoids a
// refetch every time getMenu() is called for a branch already loaded, while
// still being simple to invalidate after a save.
const rowCache = {};

async function fetchRow(slug) {
  const supabase = getSupabaseClient();

  const { data: rows, error } = await supabase
    .from("menus")
    .select("*")
    .eq("slug", slug)
    .limit(1);

  if (error) throw error;
  if (!rows || !rows.length) return null;

  rowCache[slug] = rows[0];
  return rows[0];
}

const SarcafeMenu = {
  // [{ key, name: { he, en, ar } }] in definition order.
  // Synchronous by design (existing callers don't await it), so it returns
  // names from cache/branch-key fallback. Call primeBranches() during boot
  // to populate names before this is used for display.
  listBranches() {
    return Object.keys(BRANCH_SLUGS).map((key) => {
      const cached = rowCache[BRANCH_SLUGS[key]];
      return {
        key,
        name: cached ? { ...cached.name } : { he: key, en: key, ar: key },
      };
    });
  },

  // Fetches every branch row up front so listBranches()/getMenu() have real
  // names and data cached. Call this once after the auth gate passes.
  async primeBranches() {
    await Promise.all(
      Object.values(BRANCH_SLUGS).map((slug) => fetchRow(slug))
    );
  },

  hasOverride() {
    // No meaningful concept of a "local override" with Supabase as the
    // single source of truth — every read/write is the live record.
    return true;
  },

  // Always fetches fresh from Supabase so edits from other sessions/devices
  // are reflected. Returns a fresh object safe to mutate, or null if the
  // branch/row doesn't exist.
  async getMenu(branchKey) {
    const slug = BRANCH_SLUGS[branchKey];
    if (!slug) return null;

    const row = await fetchRow(slug);
    if (!row) return null;

    const menu = {
      name: { ...row.name },
      categories: (row.data && row.data.categories) || [],
    };

    return cloneMenu(menu);
  },

  // Same as getMenu, but synchronous-looking callers should prefer this
  // after primeBranches() has already populated the cache (e.g. for the
  // public, read-only menu pages that don't need a live admin session).
  getMenuFromCache(branchKey) {
    const slug = BRANCH_SLUGS[branchKey];
    const row = slug && rowCache[slug];
    if (!row) return null;

    return cloneMenu({
      name: { ...row.name },
      categories: (row.data && row.data.categories) || [],
    });
  },

  async saveMenu(branchKey, menu) {
    const slug = BRANCH_SLUGS[branchKey];
    if (!slug) throw new Error(`Unknown branch: ${branchKey}`);

    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from("menus")
      .update({
        data: { categories: menu.categories },
        updated_at: new Date().toISOString(),
      })
      .eq("slug", slug);

    if (error) throw error;

    // Invalidate cache so the next getMenu() call reflects the save.
    delete rowCache[slug];
    await fetchRow(slug);
  },

  // Re-fetches the branch from Supabase, discarding any unsaved local
  // edits. (There's no separate "factory default" anymore now that
  // Supabase is the single source of truth.)
  async resetMenu(branchKey) {
    const slug = BRANCH_SLUGS[branchKey];
    if (!slug) return null;

    delete rowCache[slug];
    return this.getMenu(branchKey);
  },

  // Kept for API compatibility with old callers; same as getMenu/resetMenu
  // now that there's no bundled default separate from the DB row.
  async getDefaultMenu(branchKey) {
    return this.getMenu(branchKey);
  },
};

window.SarcafeMenu = SarcafeMenu;
