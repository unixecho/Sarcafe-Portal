# SARCafe — Architecture Audit

Audit date: 2026-09-11
Repo audited: [unixecho/Sarcafe-Portal](https://github.com/unixecho/Sarcafe-Portal) @ `main` (b5dc969), plus branches `giftcard-demo` and `claude/coffee-truck-digital-menus-eoeqn2`.

## 1. Current architecture

There is no framework, build step, backend, or ORM. The entire product is:

- **20 static files** served as-is (no bundler — `package.json`'s only purpose is `serve` for local preview).
- **3 HTML entry points**: `index.html` (branch-picker portal), `login.html` + `manager.html` (menu CMS), `menu-givat-haviva.html` / `menu-maor.html` (read-only digital menus).
- **Vanilla JS, no modules**: `script.js` (portal), `menu.js` (menu display), `menu-store.js` (data access), `manager.js` (CMS), `menu-data.js` (legacy hardcoded fallback, superseded by Supabase).
- **Supabase** used only as a thin data store + auth provider, called directly from the browser with the anon key (`config.js`, committed to git — expected for an anon key, but it's the *only* config mechanism that exists):
  - `public.menus` table: one row per branch (`slug`, `name` jsonb, `data` jsonb containing `categories[]`). Read by anyone; written by whoever holds a Supabase Auth session.
  - Supabase Auth: single email-magic-link flow (`login.html`) — no roles, no RBAC, just "authenticated or not."
- **No API layer** — every read/write is a direct `supabase-js` call from the client. No validation, no server-side authorization, no rate limiting, no structured errors.
- **No routing/state library** — `data-branch`/`data-*` attributes and manual `URLSearchParams`.
- **No tests, no CI, no linter config, no TypeScript.**
- **Deployment**: unclear from the repo (likely static hosting pointed at `main`; no `vercel.json`, no CI workflow file found).

There is **no order system, no POS, no inventory, no payment processing, no QR flow, no push notifications, no realtime, and no RBAC** anywhere in this repo or its branches. The digital menu explicitly says "for display only — order and pay at the truck." This is a link-tree + menu CMS, not a POS — the master rebuild prompt's assumption that a "newer FoodTruck architecture" already exists in-repo does not hold; per your call, it will be designed from scratch (see §7).

## 2. Current data model

```
menus (Supabase table)
 ├─ slug        text (pk-ish, e.g. "maor", "givat-haviva")
 ├─ name        jsonb  { he, en, ar }
 ├─ data        jsonb  { categories: [{ id, icon, title:{he,en,ar}, items:[...] }] }
 │                items: { he, en, ar, price, note?:{he,en,ar}, image? }
 └─ updated_at  timestamp
```

Everything about a branch's menu lives in one denormalized JSON blob per row. There's no `menu_items` table, no relational structure, no inventory concept, no ordering sequence field beyond array order, and no per-item availability flag.

Two unmerged branches worth noting (not currently live):
- **`giftcard-demo`**: a labeled "demo"/"mock" exploration of prepaid gift cards + a staff checkout screen (`staff-checkout.html`, banner literally reads "🔧 demo mode"). Not wired to real Supabase (`giftcards-mock.js`). One idea worth keeping: it proposes charging a card balance via a Postgres RPC (`charge_gift_card`) specifically to avoid a race when two staff phones charge the same card at once. That row-locking-RPC pattern is exactly what inventory deduction and payment recording need in the new system — reuse the *pattern*, not the code.
- **`claude/coffee-truck-digital-menus-eoeqn2`**: an older/parallel take on the Supabase migration, superseded by `main`. Nothing to carry forward.

## 3. Current application flow

1. Customer/staff opens `index.html` → picks a branch (Givat Haviva or Maor).
2. Portal reveals branch actions: navigation links (Maps/Waze/Apple Maps), a link to the read-only digital menu, Instagram, Google review link, and a "payment" accordion showing a Bit deep link and a manually-typed PayBox number (marked "paused/unavailable" in the UI).
3. Customer looks at the menu for reference, then **orders and pays entirely outside the software**, at the truck.
4. Separately, the manager signs in via magic link (`login.html` → `manager.html`), picks a branch, and edits categories/items/prices directly against the live Supabase row. Saves are immediate and global — no draft/publish separation, no history, no undo beyond "reload last saved."

There is no concept of an order, a session, a receipt, or a notification anywhere in this flow today.

## 4. What is good (keep the intent, not necessarily the code)

- **Accessibility groundwork is genuinely above average for a hand-rolled site**: `aria-live` regions, `aria-expanded`/`aria-controls` on all disclosure UI, `sr-only` labels, Escape-to-close on menus, a `--tap-min: 52px` design-token *already enforcing* a touch-target minimum, and `prefers-reduced-motion`-aware navigation (native View Transitions with a JS fallback). This is a real foundation to build the WCAG 2.2 AA work on top of, not start from zero.
- **Trilingual RTL-first i18n done correctly**: Hebrew (default, RTL), English, Arabic (RTL), with `dir`/`lang` flipped at the document level and a clean `data-i18n` substitution pattern. Keep this *concept* (small, dependency-free i18n) rather than reaching for a heavy i18n framework.
- **Menu content itself** (real categories/items/prices/notes for both branches, in all 3 languages) is real production data worth migrating, not re-entering by hand.
- **Branch-as-data, not branch-as-code**: `branchConfig`/`BRANCH_SLUGS` already model branches as data rather than hardcoded pages. Good shape to carry into a `branches` table — and matters more given this may become a resellable package later, not just a Sarcafe-only build.
- **The RPC-with-row-locking idea from `giftcard-demo`** for anything involving a shared mutable balance/count under concurrent access.

## 5. What is obsolete

- Static multi-page HTML with copy-pasted `<head>`/i18n/language-menu boilerplate across every page.
- `menu-data.js` (hardcoded menu fallback) — dead weight now that Supabase is the source of truth.
- The entire "payment" UI (Bit link + disabled PayBox button) — informal, unreconciled with anything, not a real payment record.
- No-build vanilla JS for what is about to become a stateful, realtime, multi-role application — this genuinely needs a framework (see §7), not more vanilla JS.

## 6. What is dangerous

- **All authorization is client-side.** Any write today is "does this browser hold a Supabase session," enforced (at best) by RLS policies that live only in the Supabase dashboard — **not visible in this repo, so unverified**. Do not assume they're correct; they must be re-authored and reviewed for the new project rather than trusted or copied blind.
- **No RBAC.** The single "manager" login can edit both branches. There is no concept of a kitchen-only or owner-only permission, which the new system requires (kitchen must never get cancellation authority).
- **No server-side validation anywhere.** Every mutation is a raw `supabase.from(...).update(...)` from the browser — the exact pattern Phase 22 of your prompt explicitly forbids for the new system ("client cannot simply send `{status:"COMPLETED"}`").
- **Secrets/config strategy doesn't scale.** `config.js` hardcoding the anon key is fine (anon keys are public by design), but there is no pattern here at all for *server-only* secrets (service-role key, VAPID private key, payment webhook secrets) — those must never follow the same "just commit a config.js" habit.
- **Old Supabase project is Singapore-based** (confirmed: URL is `gdoxoetrrfnensbahclc.supabase.co`) — high latency from Israel, and slated for deletion per your instruction. Nothing in the new build should depend on it surviving.

## 7. Recommended target architecture

Since no prior "FoodTruck" reference implementation exists, this is designed fresh, applying the accumulated practices from your other projects (ayekabar, the 3D-prints store, foundly) at the level of principle — TypeScript everywhere, explicit validated DTOs, server-owned state transitions, accessibility-as-architecture, no client-trusted authorization — combined with the specific rules your prompt already locks in (InventoryPool authority, no `MenuItem.availableQty`, pagination 50/200 default/max, explicit state machine, snapshots for order history).

| Layer | Choice | Why |
|---|---|---|
| App framework | **Next.js (App Router), TypeScript, Vercel Fluid Compute (Node runtime)** | SSR for fast tablet wake-from-sleep loads, file routing, Route Handlers as the API layer, first-class Vercel deploy, streaming/SSE work fine on Node — no need for edge runtime anywhere in this app. |
| Validation | **Zod** DTOs at every Route Handler boundary | Matches "DTOs must be validated," gives typed request/response contracts for free. |
| Database | **Supabase Postgres**, new project, region **EU-Central (Frankfurt)** recommended (closest to Israel of Supabase's regions) | You're creating this project; I'll hand you the schema to run once it exists. |
| Auth (staff) | Supabase Auth (keep magic-link), **+ a `staff` table carrying `role` (`owner` \| `manager` \| `kitchen`)** | RBAC doesn't exist today; this is the minimal addition that unlocks it. All role checks happen server-side in Route Handlers, never trusted from the client. |
| Customer sessions | No accounts. Opaque per-order token + hashed, rate-limited 6-digit recovery code, both with real expiry. | Matches Phase 6/7 exactly; nothing here is new risk beyond what's specified. |
| Realtime | **Supabase Realtime** (Postgres change feed) for the POS order board and inventory-availability pushes | One realtime system, not two; server remains authoritative — clients only receive, never assert, state. |
| Push notifications | **Web Push (VAPID)** via the `web-push` package from a Node Route Handler, minimal hand-rolled service worker (no heavy PWA framework needed) | Triggered server-side on the READY transition only; iOS Safari's real (limited) PWA push support gets called out explicitly in the customer-facing UX rather than overpromised. |
| Payments | `PaymentProvider` interface with **one implementation for now: manual staff confirmation** (matches reality: payment happens on Sarcafe's Hyp terminal, which the owner has no API access to) | Order and payment status are tracked as separate fields/lifecycles from day one, so swapping in a real Hyp/other API later is additive, not a rewrite. |
| Inventory | `InventoryPool` (raw stock) + `MenuItemInventoryRequirement` (join: item → pool + qty) + `MenuItem` (never carries a quantity) | Exactly the rule your prompt states; deduction happens via a Postgres function with row locking (the one good idea worth keeping from `giftcard-demo`). |
| Order state machine | `NEW → PREPARING → READY → COMPLETED`, plus `CANCELLED` reachable only by `owner`/`manager` | Server-enforced transitions only; kitchen role can advance but never cancel. |
| Testing | Vitest (unit) + Playwright (integration/E2E) + `@axe-core/playwright` (accessibility) | Matches Phase 27 without adding tooling sprawl. |
| Design system | Small token set (extending the existing `--radius`/`--tap-min`/`--ease` convention) + Tailwind, built with the accessibility skill during the actual design pass | Real brand assets are needed — `logo-placeholder.png`, `background-placeholder.png`, and `favicon-placeholder.ico` are literally placeholders today; flag before final visual polish. |
| Repo/deploy | New GitHub repo, deployed to the new Vercel account; old `Sarcafe-Portal` kept as a read-only archive/rollback reference | Matches "new Vercel account ready to import the new updated repo." |

Kept deliberately *out* of scope per "do not overengineer" and your own phasing: multi-tenant SaaS infrastructure, customer accounts/loyalty, analytics/reporting, and any actual payment-processor API integration (no access exists to build against yet). The data model will still avoid hardcoding "Sarcafe" assumptions where it costs nothing extra, since you've said this may become a resellable package later — but no speculative multi-tenant machinery gets built now.

## 8. Migration risks

- **The current menu URLs are presumably live and in customer use** (QR/links at the truck point at this site). The new site must be built and fully verified on a preview URL first; cut over via domain change only after sign-off, with the old repo/deployment kept as an instant rollback.
- **Menu content migration**: the existing `menus.data.categories` JSON must be transformed into the new relational `menu_items`/`categories` tables without silently dropping notes, images, or language variants — do this with a scripted, reviewable migration, not manual re-entry.
- **RLS policies are unverified** — they exist only in the old (soon-deleted) Supabase project's dashboard, not in this repo. They cannot be "migrated" since they were never version-controlled; they must be re-authored for the new schema and reviewed, not assumed correct.
- **Old Supabase project deletion is irreversible** — do not delete it until the new project has the menu data migrated, verified, and the new site is confirmed working end-to-end.

## 9. Implementation phases (as agreed)

1. **Phase 1 — Portal & menu rebuild**: new Next.js app, new Supabase project/schema, new accessible design system, migrated menu content, staff auth + basic RBAC scaffolding, deployed to the new Vercel project. Ships something real that replaces the current static site.
2. **Phase 2 + 3 (combined)** — Full POS: order creation/builder, live order board, kitchen view, inventory pools, order state machine, QR flow, six-digit recovery codes, customer notification page, Web Push, payment-abstraction with manual-confirm provider, realtime wiring, security/rate-limiting, and the full test suite.

Blockers before Phase 1 code can touch the database: the new Supabase project needs to exist and be connected (you're creating it and will add the MCP connection). Everything not database-dependent (repo scaffold, design system tokens, static shell) can start in parallel once you confirm the repo strategy.
