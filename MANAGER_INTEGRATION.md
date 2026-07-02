# wiring gift cards into manager.js

> Demo note: `owner.html` in this folder is the standalone version of exactly the
> view described below — same pending/active lists, same approve/deny actions.
> The merge work is moving that page's logic into `manager.js` behind a nav
> toggle, so the owner has one login and one panel.

I have your real `manager.js` (fetched from the repo) but not `manager.html` or
`menu-store.js` — so this is real, drop-in-shaped code matching manager.js's exact
conventions (`STRINGS`, `ctrlButton`, `textField`, the `#id` query pattern, the
`ok/dirty/flash` status model), but the CSS class names for `menu-store.js`'s
Supabase calls are inferred from `SarcafeMenu`'s usage in manager.js, not copied
from the file itself. Send me those two files and I'll tighten this to a real
zero-edit patch.

## 1. new file: `giftcards-store.js` (mirrors `menu-store.js`)

```js
"use strict";
// Gift card data access. Talks to Supabase the same way menu-store.js does —
// same supabaseClient created in manager.js's boot().
const GiftCards = (function () {
  let client = null;

  function init(supabaseClient) { client = supabaseClient; }

  async function listPending() {
    const { data, error } = await client
      .from("gift_cards")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  }

  async function listActive() {
    const { data, error } = await client
      .from("gift_cards")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  async function getCard(id) {
    const { data, error } = await client.from("gift_cards").select("*").eq("id", id).single();
    if (error) throw error;
    return data;
  }

  async function approve(id) {
    const { error } = await client.from("gift_cards").update({ status: "active" }).eq("id", id);
    if (error) throw error;
  }

  async function deny(id) {
    const { error } = await client.from("gift_cards").update({ status: "denied" }).eq("id", id);
    if (error) throw error;
  }

  // charges a card: server-side would ideally be an RPC/transaction so the
  // balance check + insert can't race between two staff phones at once.
  async function charge(cardId, branchSlug, items) {
    const amount = items.reduce((s, i) => s + i.p, 0);
    const { data, error } = await client.rpc("charge_gift_card", {
      p_card_id: cardId,
      p_branch_slug: branchSlug,
      p_amount: amount,
      p_items_text: items.map((i) => i.n).join(", "),
    });
    if (error) throw error;
    return data; // { ok, new_balance } or similar from the RPC
  }

  async function listTransactions(cardId) {
    const { data, error } = await client
      .from("gift_card_transactions")
      .select("*")
      .eq("card_id", cardId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  return { init, listPending, listActive, getCard, approve, deny, charge, listTransactions };
})();
```

**Why an RPC for `charge`, not a plain update:** two staff phones could scan and
charge the same card within the same second at a busy stand. A Postgres function
that checks balance and inserts the transaction in one transaction avoids a race
where both charges succeed and the card goes negative. Worth having your DB
person (or me, once approved) write `charge_gift_card` as a `plpgsql` function
with `FOR UPDATE` row locking.

## 2. changes to `manager.js`

Add near the top, after `PREVIEW_PAGES`:

```js
const GC_STRINGS = {
  navMenu: "תפריטים",
  navGiftCards: "כרטיסי מתנה",
  pendingTitle: "בקשות ממתינות לאישור",
  pendingSub: "לפני אישור — לוודא שהתקבל תשלום ב-Bit",
  activeTitle: "כרטיסים פעילים",
  approve: "אישור",
  deny: "דחייה",
  noPending: "אין בקשות ממתינות",
  noActive: "אין עדיין כרטיסים פעילים",
  openCheckout: "פתיחת סריקה →",
};

const giftCardsSection = document.querySelector("#giftCardsSection");
const navMenuBtn = document.querySelector("#navMenuBtn");
const navGiftCardsBtn = document.querySelector("#navGiftCardsBtn");
```

Add to `boot()`, right after `supabaseClient` is created (so `GiftCards` shares
the same authenticated client as `SarcafeMenu`):

```js
GiftCards.init(supabaseClient);
```

Add a top-level nav toggle so the owner can switch between menu editing and
gift cards without a page reload — this is the "manager gets their own panel"
piece:

```js
function showMenuView() {
  navMenuBtn.classList.add("is-active");
  navGiftCardsBtn.classList.remove("is-active");
  giftCardsSection.classList.add("is-hidden");
  branchSelect.classList.remove("is-hidden");
}
async function showGiftCardsView() {
  navGiftCardsBtn.classList.add("is-active");
  navMenuBtn.classList.remove("is-active");
  branchSelect.classList.add("is-hidden");
  editor.classList.add("is-hidden");
  giftCardsSection.classList.remove("is-hidden");
  await renderGiftCards();
}
navMenuBtn?.addEventListener("click", showMenuView);
navGiftCardsBtn?.addEventListener("click", showGiftCardsView);
```

Rendering (goes near `renderBranchSelect`):

```js
async function renderGiftCards() {
  const [pending, active] = await Promise.all([
    GiftCards.listPending(),
    GiftCards.listActive(),
  ]);
  renderPendingList(pending);
  renderActiveList(active);
}

function renderPendingList(pending) {
  const el = document.querySelector("#gcPendingList");
  if (!pending.length) {
    el.innerHTML = `<div class="m-empty">${GC_STRINGS.noPending}</div>`;
    return;
  }
  el.replaceChildren(...pending.map((c) => {
    const row = document.createElement("div");
    row.className = "m-giftcard-row";
    row.innerHTML = `
      <div>
        <div class="m-giftcard-name">${c.first_name} ${c.last_name} — <span class="mono">${c.balance} ₪</span></div>
        <div class="m-giftcard-meta">${c.phone} · ${c.email}</div>
      </div>`;
    const actions = document.createElement("div");
    actions.className = "m-controls";
    actions.append(
      ctrlButton("✓", GC_STRINGS.approve, () => approveCard(c.id), false, "ok"),
      ctrlButton("✕", GC_STRINGS.deny, () => denyCard(c.id), false, "danger")
    );
    row.append(actions);
    return row;
  }));
}

function renderActiveList(active) {
  const el = document.querySelector("#gcActiveList");
  if (!active.length) {
    el.innerHTML = `<div class="m-empty">${GC_STRINGS.noActive}</div>`;
    return;
  }
  el.replaceChildren(...active.map((c) => {
    const row = document.createElement("div");
    row.className = "m-giftcard-row";
    row.innerHTML = `
      <div>
        <div class="m-giftcard-name">${c.first_name} ${c.last_name}</div>
        <div class="m-giftcard-meta">#${c.id} · יתרה <span class="mono">${c.balance} ₪</span></div>
      </div>`;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "m-link";
    open.textContent = GC_STRINGS.openCheckout;
    // reuses the exact same checkout screen as staff-checkout.html —
    // once approved, that page's logic moves in here almost unchanged.
    open.addEventListener("click", () => {
      window.location.href = `staff-checkout.html?id=${c.id}`;
    });
    row.append(open);
    return row;
  }));
}

async function approveCard(id) {
  try { await GiftCards.approve(id); flash(STRINGS.saved); }
  catch (e) { flash("שגיאה באישור: " + e.message, true); }
  renderGiftCards();
}
async function denyCard(id) {
  try { await GiftCards.deny(id); flash(STRINGS.saved); }
  catch (e) { flash("שגיאה בדחייה: " + e.message, true); }
  renderGiftCards();
}
```

## 3. changes to `manager.html`

- `<link rel="stylesheet" href="assets/giftcards.css">` next to the existing manager stylesheet link.
- `<script src="giftcards-store.js"></script>` before `manager.js`'s script tag.
- A nav toggle near the top of the authed view (sits above `#branchSelect`):

```html
<div class="m-nav-toggle">
  <button id="navMenuBtn" class="m-nav-btn is-active" type="button">תפריטים</button>
  <button id="navGiftCardsBtn" class="m-nav-btn" type="button">כרטיסי מתנה</button>
</div>
```

- A new hidden section, sibling to `#branchSelect` and `#editor`:

```html
<section id="giftCardsSection" class="is-hidden">
  <h2>בקשות ממתינות לאישור</h2>
  <div id="gcPendingList"></div>
  <h2>כרטיסים פעילים</h2>
  <div id="gcActiveList"></div>
</section>
```

Add matching `.m-nav-toggle`, `.m-nav-btn`, `.m-giftcard-row`, `.m-giftcard-name`,
`.m-giftcard-meta`, `.m-empty` rules to `manager.css` — they can just borrow the
spacing/border values already used for `.m-category`/`.m-item` so it doesn't look
bolted on.

## what's still demo-only after this patch

- `giftcards-store.js` above assumes tables `gift_cards` / `gift_card_transactions`
  and an RPC `charge_gift_card` that don't exist yet — needs the Supabase schema +
  RLS (customer read-only on their own row, staff read/write all) before this runs.
- `portal.html`'s staff-session detection needs to actually check
  `supabaseClient.auth.getSession()` like `manager.js`'s `boot()` does, instead of
  the demo checkbox.
- Resend email sending on approval isn't wired anywhere yet.
