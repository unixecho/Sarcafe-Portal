# Sarcafe POS — Blueprint

Status: **design record, written before the build** (2026-10-02). Every section
that the build contradicts gets corrected in place, with the date, the same way
Ayeka's `PLAN_*.md` files carry a "what the code actually does" section. When
this file and the code disagree, the code is right and this file is stale — fix
it in the same session.

Source material: a full read of the Ayeka Bar order-management system
(`ayeka-staff`, the `waiter_*` schema in migrations 019–050 of the Ayeka portal,
and the owner dashboard that observes it) plus its design records and its live
bug history. The research notes behind this document cite `path:line` for every claim and
are the place to look when a rule here seems arbitrary. They are kept OUTSIDE this
repository on purpose (they quote Ayeka internals): `C:UsersJohnathanClaudeProjectsSarcafe-POS-research`.

---

## 0. What this is

A point-of-sale system for Sarcafe when it trades at an **event** (or any day it
wants one), built into the existing Sarcafe app so it shares the Google sign-in,
the `staff` allow-list, the menu editor and the owner dashboard.

**There is no payment in this system.** Customers pay on the HYP card terminal
that is physically on site and walk away with its printed receipt. A cashier then
**types the order into the POS from that receipt**. The POS therefore does not
take money; it takes *knowledge of what was bought, by whom, for whom* and routes
it to whoever has to make it. The one place money appears is a **total**, shown
large, so the cashier can see at a glance that what they typed matches the slip.

The product is four things:

1. **A cashier screen** — type a customer's name (required), phone (optional but
   encouraged), tap items, check the total against the slip, send.
2. **Selling-point screens** — each point (pizza tablet, coffee bar, shakes…)
   sees a live queue containing *only its own items*, labelled with the
   customer's name, and walks each through *accept → ready → handed over*.
3. **A ready board** — a screen anyone can open on a TV/tablet showing first
   names and order numbers as items become ready.
4. **An owner/manager side** — an easy wizard that creates selling points and
   says what each one sells; a live dashboard; every order ever, searchable; a
   complete audit log; statistics.

---

## 1. Decisions

### 1.1 Made by the owner (2026-09-30)

| Question | Answer |
|---|---|
| Order flow vs the HYP terminal | **Charge on HYP first, then type the order from the slip.** Items route automatically to the points that make them. |
| Event menu | **A dedicated event menu** with its own items and prices, built in the existing menu editor; the Maor and Givat Haviva menus are untouched. |
| Telling a customer it is ready | **Both** — staff call the name, *and* a Ready board shows it. |
| Deadline | **None.** The first event has passed; this is built properly as a permanent capability. |

### 1.2 Made in this blueprint (veto any of them)

| Decision | Why |
|---|---|
| **Built inside the Sarcafe app**, not a separate app like Ayeka's `ayeka-staff` | Ayeka had to split because the OMS was a Vite prototype with its own auth. Sarcafe already has one Next.js app, one Supabase project and one `staff` table; a second app would only duplicate the sign-in and the menu. |
| **An event is a `branches` row** with `kind = 'event'` | The menu editor, menu versioning, availability tablet, audit scoping and staff scoping are all keyed on a branch. Reusing that gives an event its own menu for free. `kind = 'event'` hides it from the public portal's branch picker. |
| **The staff POS is a single-page app under `/pos`**, not many routes | Ayeka's OMS is a state-machine SPA and feels instant; a cashier flips between *Register* and *Orders* hundreds of times a shift and must not pay a server round trip each time. Owner pages stay normal server-rendered routes. |
| **Writes go through the API; live reads come straight from Supabase** | No client role holds a write grant on any POS table (the Sarcafe/Ayeka rule). Reads over RLS are one hop instead of two and are what Realtime already needs. |
| **Every multi-row write is one Postgres function** | Ayeka's order creation was several separate calls and could leave a half-registered order. Check + write + audit happen in one transaction. |
| **An orders "outbox"** on the cashier device | The person has *already paid* when the cashier types. Losing an order to a Wi-Fi drop is the worst failure this system can have. Intents are queued with a client UUID and retried; the server is idempotent on it. |
| **Any active staff with a nickname can work any point**; only management configures | Over-restricting stalls a busy event when someone covers another point. The audit log records who did what, which is the protection that matters. |
| **Training sessions** | Non-technical staff need a safe place to practise. A session has `kind = 'live' | 'training'`; training orders never reach analytics and can be wiped. |
| **Hebrew + English UI**; Arabic later | Same as Ayeka's OMS. The menu *content* stays trilingual. |

---

## 1a. Employee-workflow refinements (2026-10-02) — these supersede §9.1 / §9.2 where they differ

The owner's second brief tightened the *employee experience* without touching the
backend foundation. What it changed, and what it deliberately did not:

**The governing rule.** An employee never thinks about how the POS is built. The
cashier thinks *who is the customer → what do they want → any tweak → send*. The
preparer thinks *what appears on my screen → claim → ready → hand over*. Routing,
point ids, session ids, UUIDs, technical state names, permissions and
synchronisation are all invisible. The backend stays authoritative and does the
complicated work so the employee does not have to.

**Unchanged on purpose** (020 is the foundation; nothing here is replaced):
`staff.handle` as the only identity shown; `pos_points` / `pos_point_routes` /
`pos_point_staff` (assignment ≠ authorization — a person can cover any point and
the audit says who actually did what); the per-line `point_id` / `point_name`
snapshot (re-routing never moves an existing order); the per-line lifecycle
`sent → preparing → ready → delivered` through `pos_advance_items`'
compare-and-swap; `pos_recompute_order`; `pos_sessions` (live/training, one
active — no second "shift" concept); `ticket_no` + `client_key`; `pos_events` as
the one audit log; server-authoritative pricing; phone never in an audit payload
and never on the board.

### 1a.1 The order-start sheet (replaces the customer block of §9.1)

Tapping **הזמנה חדשה** opens a *focused sheet over a receded, blurred register*:
**customer name** (required, autofocused, `Enter` continues) and, beneath it,
**phone** (optional, "מומלץ" — plumbing for a future notification feature; **no SMS
is built**). One primary button. The moment the name is valid the sheet closes and
the item grid is live. The name remains editable from the ticket header. The draft
(name, phone, lines, notes) persists locally per branch + person.

### 1a.2 As-is vs Customize — the speed rule

**One tap on a tile adds the item as-is.** *As-is* means exactly: no modifiers,
except the **defaults** of required groups. A tile whose item has a *required*
group with **no default**, or required `types`, opens the customize sheet
immediately (only the necessary choices are shown). Otherwise a small
**התאמה** affordance on the tile / on the added line opens **Customize**:
choices, extras, removals, substitutions, preparation requests, a free-text line
note, *for whom*, quantity — then **Add**. Nothing forces a modifier screen when
no customisation is needed.

### 1a.3 The structured modifier model

Reuse first: the menu already has **`types`** — an item's own required single
choice, with its own availability and live stock (pastry flavour, toast filling).
That stays exactly as it is. What the menu could *not* express — optional or
multi-select extras, removals, substitutions, preparation requests, price
adjustments — is the one genuine schema extension, kept as small as possible:

**Definitions live in the menu document** (`MenuDoc.modifierGroups`, referenced
from `MenuCategory.modifierGroupUids` and `MenuItem.modifierGroupUids`; an item's
list replaces its category's, `[]` means none). Like `types`, this is a *content*
change, so draft → publish, menu versions, variants and the menu audit all cover it
for free. A group has a **kind**:

| kind | meaning | example | on the card |
|---|---|---|---|
| `choice` | a pick that defines the item | size S/M/L | plain |
| `add` | something extra (may carry `qty`) | extra shot ×2 | green `+` |
| `remove` | an ingredient taken out | no onion | red `בלי` |
| `substitute` | one ingredient replaced | oat milk *instead of* milk | `במקום X ← Y` |
| `prep` | a preparation request | very hot, sauce on the side | italic |

…plus `required`, `multiple`, `min`/`max`, `source` (substitute: what is replaced)
and `options[]` each with `priceDelta`, `default`, `available`, `maxQty`.

**The order line snapshots the selections** (migration `021_pos_modifiers.sql`):
`pos_order_items.modifiers` is an array of
`{group_uid, group, kind, option_uid, label, price_delta_agorot, qty, source}` with
**labels and prices copied in at order time**, plus `base_agorot` (price before
modifiers) alongside `unit_agorot` (the final per-unit price — so every total,
report and `pos_recompute_order` keeps working untouched). The database enforces
`unit_agorot = base_agorot + Σ(price_delta_agorot × qty)` and makes the whole
snapshot immutable. A later menu edit — a renamed option, a new price, a removed
choice — can never change how a past order reads or what it cost.

**Pricing stays server-side.** The browser sends `{itemUid, typeUid, priceChoice,
modifiers: [{groupUid, optionUid, qty}], qty, note, forName}`. The server looks the
item up in the *published, variant-resolved* menu, validates every selection
against the group definitions (known option, `available`, required groups
satisfied, `min`/`max`, `maxQty`, defaults applied for as-is), computes
`base + Σ deltas`, resolves the destination point, and passes fully-resolved lines
to the RPC. The client runs the *same pure functions* only to show a live total.

**Structured vs free text.** Structured changes are structured; the line **note**
(≤ 120) is for the genuinely free-form ("not too much foam"); the **order note**
(≤ 200, on the ticket) is for the whole order ("they'll collect together").

**For whom vs created by** are different things and both stay visible without
clutter: *for whom* is per line (`for_name`, optional); *created by* is the order's
`created_by_handle`; the card shows both when they matter ("#231 · דניאל — נוצרה ע״י
מאיה — ל: שרה").

### 1a.4 The receiver (preparation) card

A dedicated tablet screen, not the register squeezed smaller. One **card per order
at this point**, large and legible from a distance:

```
#231 · דניאל                         ⏱ 1:42          ← aging colour, ticks every 5 s
נוצרה ע״י מאיה                       ↗ גם ב: עגלה חיצונית (בהכנה)   ← cross-station context
2× הפוך          ל: שרה
   + שוט נוסף ×2 · במקום חלב ← שיבולת שועל · חם מאוד
1× שייק          ל: דניאל · בלי קרח
                [  קבלה  ]                              ← ONE big button
```

- **Internally one line = one lifecycle.** The card groups the order's lines *for
  this point*; each line keeps its own status. The big button advances **all lines
  at the card's least-advanced status** by one step — *Accept* (`sent→preparing`),
  then *Ready* (`preparing→ready`), then *Handed over* (`ready→delivered`) —
  through one `pos_advance_items` call; a single line can still be advanced on its
  own. Mixed cards are normal (a burger that is ready beside a toast not started).
- **Cross-station orders work without duplicating anything**: the same order, the
  same lines, filtered to *this* point. The card shows who created it, and a muted
  line for the order's other points with their progress ("עגלה חיצונית · 1 מוכן, 1
  בהכנה") so the person understands the whole order. Completion is global: the order
  becomes `completed` only when every line at every point is delivered.
- **Stable, never jumpy.** A card is keyed by order id, is never re-sorted by a
  status change or a realtime refresh, and animates in only when newly arrived.
  Realtime synchronises *state*; it does not create visual churn.
- **Aging** (60 / 120 / 300 s, unaccepted lines only; quiet still first stage; ticks
  every 5 s; reduced-motion safe) — Ayeka's thresholds, per §7.3.
- **Done tray.** A fully delivered card collapses to a slim chip and, after ~5 s,
  leaves the active area (owner decision 2026-10-02: shorter than the 8 s first
  proposed). A subtle **Done** tray lives on the physical **left** edge, hidden;
  it can be revealed **two ways, either at any time**: *tap the small edge tab*
  ("הושלמו · N" — always there, so it works with no touch gesture and for anyone
  who never discovers the drag) *or* hold a card and drag toward the left edge,
  where dropping a completed card files it immediately. It holds this point's recently
  completed cards (and is where the 30-second **undo delivered** lives for the
  person who delivered it). It is never permanent screen furniture.
- **History gesture.** A deliberate left swipe on the screen background (not on a
  card — card interactions can never trigger it) asks **עבור לציר הזמן?**; confirming
  performs the iPhone-style horizontal slide into the **timeline**: completed orders
  for this point with ticket, customer, creator, items + modifiers, point, *who
  accepted / readied / handed over* and when — all read from `pos_events` and the
  stamped line columns. (Left and the tray are **physical**, like every pinned
  widget, so they do not flip with RTL.)
- Large touch targets (≥ 56 px on this screen), minimal text entry, no browser
  dialogs, keyboard shortcuts for a connected keyboard (`1`/`2`/`3` advance the
  focused card, arrows move focus).

### 1a.5 One station, one or two employees — signing in (owner decision 2026-10-02)

A device is **not** permanently one person. Assignment (`pos_point_staff`) only
chooses where someone *lands*; anyone can cover any point; every action is
attributed to whoever actually performed it.

**Two ways in, both real sessions as the person themselves:**

1. **Default — their own Google account**, on their own phone (or any device). The
   email is the identity; nothing to remember.
2. **Quick login — employee number + a 6-digit passcode**, an *option* for a shared
   station tablet: an employee taps **החלפת משתמש**, types their number and code on a
   big keypad, and the tablet is theirs; the next person does the same. Each
   action on that tablet is attributed to the person actually at it.

How quick login works (migration `022_pos_quick_login.sql`): the employee number
is a short auto-assigned, owner-editable integer (`staff.employee_no`); the
passcode is stored only as a bcrypt hash (`staff.pin_hash`) and appears in no log,
audit row or payload. `POST /api/auth/quick-login` verifies it with
`pos_verify_pin` (ONE generic failure for every reason — no such number, wrong code,
inactive, never signed in — and comparable bcrypt work on every path, so it cannot
be used to find out who works here), rate-limited per employee number AND per IP,
then mints a genuine Supabase session for that person (admin-generated one-time
link verified on the server, so the cookies are set exactly as a Google sign-in
sets them and RLS, realtime and every guard work unchanged — the browser still
never chooses its identity). Quick login needs the person to have signed in with
Google once (there must be an account to open a session for); the owner can issue
or reset a code, a person can change their own, and changing or clearing a code
ends that person's quick sessions at once.

**A passcode is a weaker secret than a Google account, so a quick session is
second-class by construction.** The session minted this way is recorded
(`pos_quick_sessions`, keyed by the JWT's own `session_id`) and the guards refuse it
for everything except floor work: **register, station, orders, the Ready board** —
never `/owner/*`, never a manager-only action (voiding a delivered line, closing
the event, configuration), never changing its own passcode. The distinction is
made server-side from the session id; nothing the client holds can lift it.

### 1a.6 The owner dashboard is realtime

The hub subscribes to the **same realtime signal** the stations use (debounced,
throttled to at most one refetch per 2 s) and keeps the 30 s poll only as the
backup, so numbers move without a refresh. It adds, to §13.3: *who is processing
what* (accepted-by handles on in-flight lines), per-point queue / oldest wait /
median prep, and bottleneck flags.

---

## 2. Scope

**In scope (this build):** everything in §0 and §4–§16.

**Deliberately out of scope**, each with the reason:

- *Payments, receipts, Z/X reports.* No payment API exists and the owner has no
  HYP access. The slip total and receipt number are *recorded for
  reconciliation*, never processed.
- *Inventory authority.* Item/type `quantity` already exists on the menu and is
  edited from `/owner/tablet`. Auto-decrementing it from orders is a Phase 2
  option (§16) because it makes the POS a second writer of the menu document.
- *Customer-facing ordering or accounts.* The customer never touches this.
- *VAPID push to customers.* The owner's push-notification side project is
  separate; the Ready board covers the same need without any customer opt-in.
- *Floor plans, tables, table combining, snooker queue, loyalty.* Ayeka-specific.
  Their underlying mechanisms have Sarcafe analogues and those are kept (§3).

---

## 3. Ayeka → Sarcafe parity map

"Functionality verbatim" is satisfied by carrying the **mechanisms and rules**,
not the file contents — Ayeka's OMS is a Vite app with its own CSS; Sarcafe is a
Next.js app with its own tokens. Class **A** = carried over unchanged,
**B** = carried over with the stated adaptation, **C** = Ayeka-specific.

| Ayeka mechanism | Sarcafe | Class |
|---|---|---|
| Item lifecycle `registered → sent → preparing → ready → delivered \| voided` | `sent → preparing → ready → delivered \| voided` (`registered` is dropped — an order is composed on the device and arrives whole, so there is no registered-but-unsent state) | A/B |
| "Picked up" as **columns** (`picked_up_at/by`), not a status | Same | A |
| Serve implies pickup — stamp, don't block | `pos_advance_items` stamps pickup before `delivered` | A |
| Compare-and-swap transitions returning ok / conflict | `pos_advance_items(from, to)` returns per-id `ok` / `conflict` | A |
| Identity stamped by the database, never sent by the client | Actor is resolved server-side from the session and passed to the RPC; the RPC is callable by `service_role` only | A/B |
| Snapshot name / price / options / routing onto the line | Same; plus `point_name`, `category_title` | A |
| Integer agorot, unit in the variable name | Same | A |
| Append-only audit table, written in the same transaction as the change | `pos_events`, written *by the RPCs* (Ayeka wrote it client-side, lossy) | A/B |
| Single-active-session partial unique index | `pos_sessions`, one active per branch | A |
| Shift gate: gate only *new* work, never cleanup | An open session is required to *create* orders; advancing/voiding/handing over is never gated | A |
| Station → routing by **category** hard-coded map | **Owner-configured** category → point, with per-item override, edited in the wizard | B |
| Station screen: FIFO queue, per-order tickets expanded by default, claim → ready → deliver, "mine" highlight | Selling-point screen, one component parameterised by point | A/B |
| 4-stage aging of *unclaimed* lines: <60 s fresh, 60–120 s warming (still), 120–300 s late (flash), ≥300 s critical (glow + strip) | Same constants, same rules | A |
| Overdue strip counts exactly the lines glowing red | Same | A |
| Ready alert: global, focus-locked, "continue later" always enabled | Ready → *call the name*; the point shows the name large, the Ready board shows it | B |
| Event feed (`יומן פעילות`): kinds whitelist, grouping, unread badge | Live feed on the manager hub + full log page | A/B |
| Abandon ghosts: voided-but-sent lines stay visible, struck through, so a station does not cook cancelled food | Same | A |
| Realtime: "signal, don't reconcile", one channel, 150 ms debounce, gap-close on subscribe, 5 s/15 s watchdog, rebuild on `online`, 8 s backup poll that drives the same signal, `visibilitychange` catch-up, status pill when not live | Same, as a module-level singleton | A |
| Menu degradation ladder: live → cache → bundled snapshot; 30 s publish-stamp poll | Live → `localStorage` cache (no bundle: the event menu is not known at build time) | A/B |
| Fail-open vs fail-closed table (chosen per cost of being wrong) | Same table, §10.5 | A |
| Quick purchase (table-less order, payment first, then lines to the bar) | **This is the whole Sarcafe flow**, made atomic | B |
| Table / diner | Customer-named order; optional per-line "for whom" name | B |
| `waiter_staff_directory` narrow view + deterministic round-robin colours | `pos_staff_directory`; handle-first | A |
| Per-station clock-in/out, append-only | Per-point check-in/out | A/B |
| Overall view (three panes side by side) | Manager hub with a pane per point (Phase 2) | B |
| Owner dashboard: four numbers with `known` flag, silence-by-default signal stack, drill-downs sharing the count's own filter constants, 30 s poll + visibility catch-up | Same mechanism, new signals/stats | A |
| Skeleton loading | **Net-new.** Ayeka's `.ds-skel` never loaded in production (its stylesheet was never imported). Sarcafe's `.sk` works; content-shaped skeletons with a 300 ms delay | new |
| Sound / vibration / push | **Net-new.** Ayeka has none anywhere. Web Audio chime + vibration at points | new |
| Statistics / analytics | **Net-new.** Ayeka's reports page computes no metrics at all | new |
| Floor plan, table holds, combining, rounds/batches, snooker queue, hookah, chasers, loyalty | — | C |

---

## 4. Architecture

```
                         ┌────────────────────────── browser ──────────────────────────┐
 staff signs in (Google) │  /pos  (one client tree, mounted once)                      │
        │                │   PosApp ── PosProvider (identity, branch, points, menu,    │
        ▼                │             session, refreshKey, connection state)          │
  middleware: isStaff    │      ├─ Register   ── cart ── outbox ──┐                    │
  server re-check        │      ├─ Station(point)                 │ POST /api/pos/…    │
        │                │      ├─ Orders / OrderDetail           │ (writes)           │
        ▼                │      └─ Me (nickname, language, sound) │                    │
 /pos/page.tsx (server)  │   realtime singleton ◄── Supabase Realtime (signals)        │
  bootstrap → props      │   direct reads (RLS select) ◄── Supabase REST               │
                         └──────────────────────────────┬──────────────────────────────┘
                                                        │
              ┌───────────────── Next.js route handlers (service role) ─────────────────┐
              │ requirePosStaff() → resolve actor from session (never from the body)    │
              │ zod-validate → price & route lines SERVER-SIDE from the published menu  │
              │ → rpc('pos_*', { p_staff: actor.id, … })   (one transaction each)       │
              └──────────────────────────────────┬───────────────────────────────────────┘
                                                 ▼
              Postgres: pos_* tables (RLS on, select for staff, NO client write grants),
              SECURITY DEFINER functions (execute: service_role only), triggers that make
              audit rows append-only and identity columns immutable, Realtime publication.

 /owner/pos/*   server-rendered pages + /api/owner/pos/*  (manager = OP, or GM scoped to the branch)
 /board/[token] public Ready board  +  GET /api/board/[token]  (first names only, rate-limited)
```

### 4.1 Route map

| Route | Who | What |
|---|---|---|
| `/pos` | any active staff with a nickname | The staff app (client SPA). Views are state, mirrored to `?v=` with `history.pushState` so Back works and a reload lands in the same place. |
| `/board/[token]` | anyone holding the link | Ready board. |
| `/owner/pos` | manager | Event hub: open/close the event, live stats, signals, per-point cards, feed. |
| `/owner/pos/setup` | manager | Event creation + selling-point wizard + readiness checklist. |
| `/owner/pos/orders` | manager | Every order, searchable; detail with the full timeline. |
| `/owner/pos/stats` | manager | Analytics. |
| `/owner/pos/log` | manager | The audit log. |
| `/api/pos/*` | staff | bootstrap, menu, orders (create / add / edit / void), items/advance, checkin, handle. |
| `/api/owner/pos/*` | manager | points, session, settings, readiness, dashboard, orders, stats, log, export. |
| `/api/board/[token]` | public | Ready board data. |

Staff reach `/pos` from a tile on `/staff`; managers from a tile on
`/owner/dashboard`. `/pos` is added to the middleware's staff-only prefixes and
each page and route re-checks server-side (middleware is a convenience, not the
security boundary — Sarcafe's own rule).

### 4.2 Trust boundaries

1. **The browser is not believed about anything that matters**: not prices, not
   which point makes an item, not who it is. The client sends *which item, which
   option, how many*; the server looks up the rest in the published menu.
2. **The actor comes from the session**, resolved by `requirePosStaff()`, and is
   passed to the RPC as `p_staff`. The RPCs are executable by `service_role`
   only, so no browser can call one with someone else's id.
3. **The service-role client never reaches the browser.** The browser holds the
   anon key plus the user's session; its reach is `select` on `pos_*` tables and
   the narrow directory view.
4. **The public board endpoint reveals the least that works**: first name,
   order number, point name, state. Never a phone, never a surname, never an
   item name.

---

## 5. Data model

Full DDL, constraints, triggers, grants and a verify block live in
`supabase/migrations/020_pos_core.sql`. This section is the spec it implements.
All tables: RLS on; `select` for authenticated staff via `is_staff_client()`;
**no insert/update/delete grant for any client role**; `service_role` has all.
Every `SECURITY DEFINER` function pins `search_path = public, pg_temp` and does
`revoke execute … from public` *then* grants `service_role` — Postgres grants
`EXECUTE` to `PUBLIC` on creation and revoking `anon` alone is cosmetic (Ayeka
migrations 043/044).

### 5.1 Changes to existing tables

**`staff`** gains:

- `handle text not null` — the nickname. 2–16 characters from
  `[A-Za-z0-9א-תء-ي_.-]`, **unique case-insensitively** (`lower(handle)` unique
  index). A `BEFORE INSERT` trigger fills a generated placeholder when an insert
  supplies none, so no existing path (the first-owner snippet in
  `DEPLOYMENT.md`, the invite route) can break; existing rows are back-filled
  from first name / display name / the email's local part and de-duplicated.
- `handle_set_at timestamptz null` — `null` means *the system picked this*.
  `/pos` makes the person confirm or change it before they can work; the owner's
  staff page requires it on invite. "Required" is therefore real without a
  NOT-NULL column ever blocking a legacy insert.
- `colour text null` — optional hex; if null the client assigns one by
  deterministic round-robin over the id-sorted roster (Ayeka measured a hash
  collide on 3 of 5 people).

**`branches`** gains `kind text not null default 'permanent' check (kind in
('permanent','event'))`. The public branches endpoint and the portal picker
exclude `event`; owner pages include it. (`/menu/[slug]` keeps working for an
event slug, which is useful at the event itself.)

### 5.2 New tables

| Table | Purpose |
|---|---|
| `pos_branch_settings` | `branch_id` pk, `enabled`, `board_token`, `updated_*`. **Separate from `branches` on purpose** — `branches` is publicly readable, and the board token must never be. No client select at all. |
| `pos_sessions` | One row per service period. `kind` `live`/`training`, `status` `active`/`closed`, started/ended by. Partial unique index: **one active per branch**. |
| `pos_points` | A selling point: `name`, `icon` (from a fixed list), `colour`, `hands_over` (does *this* point give the item to the customer, or does a runner/cashier?), `prep_minutes` (drives the stuck threshold), `sort_order`, `active`. Unique active name per branch. Deactivate, never delete. |
| `pos_point_routes` | `(branch_id, kind 'category'\|'item', ref)` → `point_id`. **`unique (branch_id, kind, ref)`** — an item or category belongs to at most one point, enforced by the database, not the UI. |
| `pos_point_staff` | Optional "who usually works here" links; used only to choose where a person lands. Not a permission. |
| `pos_orders` | One per customer. `ticket_no` (per session, atomic), `client_key uuid` (idempotency, `unique (branch_id, client_key)`), `customer_name` (1–40), `customer_phone` (nullable, format-checked), `receipt_ref`, `slip_total_agorot`, `slip_mismatch`, `status` `open`/`completed`/`void`, `total_agorot` (recomputed), `created_by` + `created_by_handle` (snapshot). |
| `pos_order_items` | One per line. Snapshots (`name`, `type_label`, `category_title`, `point_name`, `unit_agorot`, and — from migration 021 — `base_agorot` + the structured `modifiers` array, §1a.3) and the whole stamped lifecycle: `claimed_*`, `ready_at`, `picked_up_*`, `delivered_*`, `voided_*`, `voided_from`, `void_reason`; `batch_no` (1 = original, 2+ = added later); `is_custom`; `for_name`; `note`. |
| `pos_events` | **The audit log.** Append-only (a trigger rejects update/delete). One table for everything: order/line events *and* configuration events (point created, routes changed, session opened…), each with `actor_id`, `actor_handle` snapshot and a `payload` that carries the display data readers need. Real foreign keys. In the Realtime publication from day one. |
| `pos_point_checkins` | Append-only presence log: who was on which point, when. |
| `pos_ticket_counters` | `session_id` → `last_no`, advanced by `insert … on conflict do update … returning` so two cashiers can never draw the same number. |

### 5.3 Views

`pos_staff_directory (id, handle, colour)` — a narrow definer view so every
device can render "who" without the `staff` table (which, by design, has *no*
select policy for authenticated users). Not filtered by `active`: history must
keep resolving names for people who were later removed. Grants: select for
authenticated only; **explicitly revoke insert/update/delete/truncate** (a
simple definer view is auto-updatable, and a write through it bypasses the base
table's RLS — Ayeka migration 042 found exactly this live).

### 5.4 Realtime

`alter publication supabase_realtime add table` (guarded, idempotent) for
`pos_orders`, `pos_order_items`, `pos_events`, `pos_points`, `pos_sessions`,
`pos_point_checkins`; `replica identity full` on all of them.

---

## 6. RPC contract

All `security definer`, `set search_path = public, pg_temp`, execute granted to
`service_role` only. Each does *check + write + audit event* in a single
transaction. `p_staff` is the already-authenticated actor's `staff.id`.

Line object (`p_lines` elements — fully **server-resolved**, never client-sent):

```json
{ "point_id": "uuid", "item_uid": "text|null", "category_id": "text|null",
  "category_title": {"he":"","en":"","ar":""}, "name": {"he":"","en":"","ar":""},
  "type_uid": "text|null", "type_label": {"he":"","en":"","ar":""}|null,
  "variant_label": "text|null", "unit_agorot": 2300, "base_agorot": 1500,
  "modifiers": [ { "group_uid":"", "group":{}, "kind":"add", "option_uid":"", "label":{}, "price_delta_agorot":300, "qty":2, "source":null } ],
  "qty": 1,
  "for_name": "text|null", "note": "text|null", "is_custom": false }
```

| Function | Returns |
|---|---|
| `pos_open_session(p_staff, p_branch, p_kind text default 'live')` | `{ok:true, session_id}` \| `{ok:false, reason:'already_open'\|'not_enabled'}` |
| `pos_close_session(p_staff, p_branch, p_void_uncollected boolean default false)` | `{ok:true}` \| `{ok:false, reason:'no_session'\|'in_flight'\|'uncollected', in_flight, uncollected}` |
| `pos_wipe_training(p_staff, p_branch)` | `{ok:true, orders}` — hard-deletes a **training** session's rows; refuses for `live` |
| `pos_create_order(p_staff, p_branch, p_client_key, p_customer_name, p_customer_phone, p_receipt_ref, p_slip_total_agorot, p_note, p_lines)` | `{ok:true, deduped, order_id, ticket_no, total_agorot}` \| `{ok:false, reason:'no_session'\|'bad_customer'\|'bad_point'\|'bad_line'}` |
| `pos_add_items(p_staff, p_order, p_lines)` | `{ok:true, added, total_agorot}` \| `{ok:false, reason:'not_found'\|'order_void'\|'bad_point'\|'bad_line'}` — reopens a `completed` order |
| `pos_edit_order(p_staff, p_order, p_customer_name, p_customer_phone, p_note, p_receipt_ref)` | `{ok}` — fixes typos; old→new recorded in the event |
| `pos_advance_items(p_staff, p_ids uuid[], p_from, p_to, p_manager boolean default false)` | `{ok:[…], conflict:[…], missing:[…]}` — **the compare-and-swap** |
| `pos_void_items(p_staff, p_order, p_item_ids uuid[]\|null, p_reason, p_manager boolean default false)` | `{ok, voided:[…], skipped:[…], order_status}` — `null` ids = every non-delivered line |
| `pos_save_point(p_staff, p_branch, p_point uuid\|null, p_cfg jsonb, p_move boolean default false)` | `{ok:true, point_id}` \| `{ok:false, reason:'name_taken'\|'conflicts', conflicts:[{kind,ref,point_id,point_name}]}` |
| `pos_deactivate_point(p_staff, p_branch, p_point)` | `{ok}` \| `{ok:false, reason:'live_items', n}` |
| `pos_checkin(p_staff, p_point, p_event 'check_in'\|'check_out')` | `{ok}` |
| `pos_set_handle(p_actor, p_target, p_handle)` | `{ok}` \| `{ok:false, reason:'invalid'\|'taken'\|'not_found'}` |
| `pos_log_event(p_branch, p_actor, p_event, p_payload, p_order, p_item, p_point)` | `void` — config events written by routes |
| `pos_clear_old_pii(p_phone_days int, p_name_days int)` | `{phones, names}` — retention (§14) |

**Allowed `pos_advance_items` transitions:** `sent→preparing`, `preparing→ready`,
`sent→ready` (a fast point may skip *accept*; `claimed_by` is stamped
implicitly), `ready→delivered` (stamps pickup first if empty). Reverts for
mis-taps: `ready→preparing`, `preparing→sent`. `delivered→ready` only with
`p_manager`. Anything else is `invalid`. A stale `p_from` is a **conflict**, not
an error — that is two tablets tapping at once and it is normal.

**Derived order status** (recomputed inside every function that touches lines):
`void` when no line remains un-voided and none was delivered; `completed` when
at least one line is delivered and every remaining un-voided line is delivered;
otherwise `open`. `total_agorot` = sum of un-voided `qty × unit_agorot`.

---

## 7. Rules

### 7.1 Pricing (`src/lib/pos/pricing.ts`, pure, used by server *and* client)

- Menu `price` is `number` (₪), a string like `"14/16"` (two prices), or text.
  A slash string becomes **N labelled choices** — Ayeka's `toVariants()`; the
  cashier picks the one matching the slip. A non-numeric string is **not
  sellable** (the cashier sees why).
- A chosen type adds its `priceDelta` (same parsing).
- Agorot = `Math.round(shekels × 100)` **per unit, before multiplying by qty**.
  (Ayeka showed ₪87 as ₪0.87 once, from a shekel value in an agorot slot.)
- A line's **price is part of its merge identity**: the same drink added at two
  different prices must not collapse into one line.
- Server re-prices every line from the *published, variant-resolved* menu and
  rejects `available === false` items/types (`sold_out`). The client's idea of
  the price is display-only.
- **Custom item** (`is_custom`): cashier types name + price (≥ 0 — free tap
  water needs a real line) and picks a point. Bounded (≤ ₪999.99), flagged in the
  audit, and routed to the chosen point.

### 7.2 Routing (`src/lib/pos/routing.ts`)

`point(item) = routeByItem[item.uid] ?? routeByCategory[category.id] ?? none`.
An item with **no point cannot be ordered** — the cashier sees it disabled with
the reason, and the server rejects it (`no_point`). The point is **snapshotted
onto the line** at order time: re-routing a category mid-event never moves a
ticket that is already on a screen. Routing and the cashier's browse order are
independent (who makes it ≠ where you find it).

### 7.3 Aging, stuck, uncollected

- *Aging* (station screen, per line, `sent` only — an accepted line stops aging):
  `fresh <60 s`, `warming 60–120 s` (quiet amber, **no animation** — Ayeka
  learned a still first stage makes escalation read as building rather than
  broken-then-panicking), `late 120–300 s` (flash), `critical ≥300 s` (steady
  glow + an overdue strip that counts exactly the lines glowing). Clock ticks
  every 5 s (10 s read as "the flashing is late"). Reduced-motion: no animation,
  but `late` keeps a still tint so it stays distinguishable.
- *Stuck* (dashboard): `sent`/`preparing` longer than `max(4, 2 × prep_minutes)`
  of its point, ignoring lines older than the session window. `preparing` is
  counted on purpose — it is the one a human picked up and then abandoned.
- *Uncollected*: `ready` with no delivery for > 5 min → warning signal that
  lists the customer's name and phone so someone can call.

### 7.4 Ready board rule

A board entry exists per **(order, point)** while that point has ≥ 1 `ready` line
**and** none still `sent`/`preparing` (everything *that point* owes this
customer is done). It disappears once its ready lines are delivered. Shown as
first name (first whitespace token, ≤ 14 chars) + `#ticket`. Two customers with
the same first name stay distinguishable by the number.

### 7.5 Sessions

Orders can only be *created* while a session is active (the RPC enforces it).
Everything else — advancing, handing over, voiding, editing — works whether or
not a session is open (Ayeka's rule: cleanup is never new work). Closing is
refused while any line is `sent`/`preparing`; leftover `ready` lines prompt
"void as uncollected?". An active session older than 16 h raises a signal
(Ayeka left one open for a week and the gate silently never mattered).

---

## 8. Customer, phone, nickname

- **Customer name** required, trimmed, internal whitespace collapsed, 1–40.
- **Phone** optional but the UI says *recommended*, with the reason ("so the
  barista knows whose coffee"). Digits and `+`, 7–15 digits after normalising;
  shown formatted; tap-to-call on any screen.
- **Per-line "for whom"** (optional): a group order for "Dana" can mark which
  coffee is Yossi's — Ayeka's seat/guest idea reduced to a text field.
- **Nickname (handle)**: see §5.1. Every screen that shows who did something
  shows the *handle*, never the email or full name, in the person's colour.
  Emails appear only in the owner's staff list and the audit detail.

---

## 9. Screens

Hebrew shown where the copy matters; every string lives in `src/lib/pos/i18n.ts`
(he required, en type-checked).

### 9.1 Register — typing the order from the HYP slip

The cashier is *transcribing a printed slip while a customer waits*. The screen
is built around two things: tapping must be faster than reading, and the
**total must be checkable against the slip at a glance**.

**Tablet (≥ 768):** a header, then two panes — the **menu** (flexible) and the
**ticket** (340 px; 400 px at ≥ 1280), each its own scroller, nothing else
scrolls. **Phone:** the menu fills the screen with a pinned bar
`[ 3 פריטים · ₪58 · המשך ← ]`; *המשך* opens the ticket as a bounded sheet.

**Header:** the person's handle chip, the *event is open/closed* pill, the
connection pill (silent when live), the outbox pill (only when non-zero), and
the navigation between **קופה / עמדות / הזמנות**.

**Menu pane**
- A sticky **category strip** (chips, the active one scrolled into view) over an
  **item grid**; a **search box** that matches Hebrew/English/Arabic names and
  forces all categories visible while it has text. Categories come from the
  *published, variant-resolved* menu; a mid-event publish arrives within 20 s.
- Each tile: name, price, and a small **count badge** once it is on the ticket
  (so repeated taps are visible without looking right). **One tap adds one.**
  Haptic tick.
- An item that needs a choice — it has **types** (toast filling, pastry flavour),
  or a **slash price** (`14/16`) — opens a small **choice sheet**: one radio list
  (each type with its remaining stock if tracked, each price as `₪14 / ₪16`),
  quantity, an optional note, an optional *for whom*. If exactly one valid choice
  exists there is no sheet.
- **Disabled tiles say why** (never hidden — the cashier is looking for the
  thing on the slip): *אזל* (sold out), *ללא עמדה* (no point makes it — with a
  manager hint to fix it), *ללא מחיר* (non-numeric price).
- A **פריט אחר** tile opens the custom-item sheet: name, price (accepts
  `12,5`; zero is valid — free water needs a real line), the point that makes it,
  quantity, note.

**Ticket pane (top to bottom)**
1. **Customer** — *שם הלקוח* (required, autofocused on a fresh ticket, `Enter`
   moves on) and *טלפון* (optional, with the placeholder "מומלץ — כדי שנדע למי
   הקפה" and the one-line privacy purpose). Inline validation; no blocking
   modal. **Same-name hint:** if an *open* order for the same name was created in
   the last 30 minutes, an inline chip offers *"להוסיף להזמנה #38 של דנה?"* — a
   hint, never a block (two Danas happen).
2. **Lines** — grouped by point (the colour dot tells the cashier where it goes),
   each `{qty}× name · type · price` with **− / +** (− at 1 removes), a tap to
   edit note / *for whom*. Lines merge on `(item, type, price-choice, note,
   for-whom)` — **price is part of identity.**
3. **The slip check** — optional *מס׳ קבלה* (the HYP receipt number) and *סכום
   בקבלה*. As soon as a slip total is typed, a green ✓ (equal) or an amber
   "הפרש ₪4" (different) appears next to the system total. A mismatch **does not
   block** sending (a discount at the terminal is legitimate) but asks one
   `ConfirmSheet` and is recorded as `slip_mismatch`.
4. **Total** — large, tabular, `.ltr-isolate`.
5. **שליחה** — disabled *with a visible reason* ("חסר שם לקוח", "האירוע סגור",
   "אין פריטים").

**After sending:** the form clears at once; the order joins the outbox and a
confirmation chip shows `#42 · דנה · נשלח ✓` as soon as the server answers
(usually < 400 ms), with **ביטול** for 30 s (voids every line with reason "טעות
הקלדה" — safe because nothing has been accepted yet) and **הוספה להזמנה**. The
cart draft persists in `localStorage` per branch + person, so a refresh or a
crashed tab loses nothing; *ניקוי* needs a confirm.

**Add-to-order mode:** opened from an order's detail, the same screen with a
banner "מוסיפים להזמנה #42 · דנה"; customer fields are locked; send calls
`pos_add_items`. Added lines arrive at points flagged **תוספת**.

**Never** on this screen: a browser `confirm`/`prompt`/`select`; a disabled button
with no reason; a price the cashier can edit on a catalogue item.

### 9.2 Selling-point screen — `Station`

One component, parameterised by `point`. **A queue of tickets one point owns,
not a filtered browse** — a genuinely different screen from the register
(Ayeka's `StationScreen`).

**Top to bottom**

1. *Event bar* (sticky): `פתוח` dot + "since 14:02", or an amber "the event is
   closed — new orders are paused" (existing tickets keep working).
2. *Overdue strip* (`role="alert"`), rendered only when ≥ 1 line is **critical**
   (unaccepted ≥ 5 min): "פריט ממתין מעל 5 דקות — לטפל עכשיו" / "{n} פריטים ממתינים
   מעל 5 דקות — לטפל עכשיו". **Singular and plural are separate strings** —
   "1 פריטים" reads as a typo and this is the one line that must be believed
   instantly. Counts exactly the lines glowing red; never a second opinion.
3. *Header*: point name + colour dot; **check-in pill** (tri-state — `null` while
   loading so it never flashes "check in" before the real state arrives); sound
   toggle; history button; the person's handle chip (display-only, inert).
4. *Body*: a **list of tickets**, oldest first (`sent_at` ascending). A ticket =
   one order's lines *at this point*: header `#42 · דנה` + phone (tap to call) +
   waiting time + "תוספת" badge if a line arrived after the first batch; then
   the lines.
   - **Expanded by default** (a live queue hides nothing); collapsible.
   - Each line: icon by status (hourglass / flame / bell), `{qty}× {name} · {type}
     · {variant}`, the note in accent colour, "for {name}" if set, price only for
     managers. **Guard `?? []` on any array that might be absent.**
   - Button per line, label from the *next* state: **קבלה / Accept** →
     **מוכן / Ready** → **מסרתי / Handed over** (only when `point.hands_over`;
     otherwise a "⌛ ממתין למסירה" pill and the card dims, "visibly done without
     inviting a tap that would do the wrong thing").
   - **Ticket-level buttons**: *Accept all* / *All ready* / *Hand over all* for
     the ticket's lines at this point — three pizzas on one ticket is one tap, not
     three (a speed win Ayeka never had).
   - The lines **the signed-in person accepted** carry an `is-mine` highlight so
     they can find theirs in a big queue. (Ayeka shipped the class with no CSS —
     verify the rule exists.)
   - A **ready** ticket shows the name large: *"קראו ל־דנה #42"*.
5. *Ghosts*: lines voided after being sent stay as grey, struck-through,
   dismissible rows for 10 minutes ("בוטל — אל תכינו"), so nobody cooks a
   cancelled order. Dismissal is per device. Only lines that were actually `sent`
   produce ghosts.
6. *Empty state*: "אין הזמנות פתוחות כרגע" — a calm, centred message.
7. *History sheet*: this point's last 60 delivered lines grouped by ticket, scoped
   **by point, not by person** (the record reads the same whoever was on shift),
   collapsed by default, with a time filter for the session. Money is hidden
   unless the person is a manager.

**Stable cards.** Keyed by line id, never re-sorted on a status change, no
per-index animation delay, entrance animation for *new* arrivals only. Test
rapid accepts on a real tablet — Ayeka's "whack-a-mole" bug was never explained.

**New-arrival alert**: a chime + vibration the moment a new line for this point
appears (diff of line ids across refetches; the *first* load never chimes).

### 9.3 Orders — `OrdersList` and `OrderDetail`

Available to every staff member: *"where is my order?"* is the question the
cashier gets most.

- **Live list**, newest first, for the active session: `#42 · דנה · 054…` · who
  entered it (handle chip) · per-point status chips in the point's colour
  (`☕ מוכן`, `🍕 בהכנה`) · total · age. Search by name, phone digits, `#`,
  receipt number. Filters: *open / ready for handover / all*.
- **Ready-for-handover** tab: lines that are `ready` at points where
  `hands_over = false`, each with a **מסרתי** button — how a runner/cashier works.
- **Order detail** (sheet): customer (tap-to-call), who entered it and when,
  every line with its status, its actor handles and timestamps, an **event
  timeline** (the `pos_events` rows for this order), the slip total and whether it
  matched. Actions: *Add items* (opens the register in "add to order #42"
  mode), *Edit customer* (name/phone/receipt — fixing typos), *Void line(s)* /
  *Cancel order* — reason required — and (managers) revert a delivered line.

### 9.4 Ready board — `/board/[token]`

Full-screen, dark, huge type, designed to be read from three metres.

- Two zones: **מוכן לאיסוף** (large cards: first name + `#42` + the point's name
  and colour) and a quiet count of how many are **בהכנה**.
- Optional `?point=<id>` to show one point; otherwise all, grouped by point.
- Polls `GET /api/board/[token]` every 3 s (visibility-aware), shows the last
  good list on error with a quiet "reconnecting".
- A new entry arrives with a single rise + (if the device allows it) a soft chime;
  entries leave when handed over. Wake Lock while visible; fullscreen button.
- Reveals first names + numbers only. No phone, no surname, no items. Rotating
  the token (manager) kills old links immediately.

### 9.5 Selling-point wizard — `/owner/pos/setup`

**Two layers: a readiness checklist (the home of the page) and a wizard that
creates or edits one point (a full-height sheet).** The owner is not technical, so
the page tells them what to do next in plain Hebrew rather than presenting a
settings form.

**Readiness checklist** — each row is *done / needs attention / blocked* with one
big button:

1. **Event** — pick or create the event (creates a `kind = 'event'` branch + empty
   menu through the existing `create_branch_with_menu`; offers *clone the Maor /
   Givat Haviva menu* as a starting point) and switch POS on for it.
2. **Menu** — "142 items in 9 categories, published ✓" — links to the editor;
   blocked while nothing is published.
3. **Selling points** — the list, each card showing its icon, colour and a
   one-line summary ("פיצה · מאפים · טוסטים — 7 פריטים"); **הוספת עמדה**.
4. **Everything routed** — "3 items are not made by any point" with the names and
   a one-tap *assign to…* per item. This row going green is the gate for opening.
5. **People** — every person has a confirmed nickname; optionally assign people to
   points ("who usually works here").
6. **Ready board** — the link, *copy*, *open*, *rotate*.
7. **Open the event** — one large button (and *start a training session*).

**The wizard (add / edit a point)** — five short steps, one decision each, a
progress dot row, *Back* always available, nothing committed until the last
step:

1. **Name it** — free text ("עמדת פיצה"), an icon from a fixed grid, a colour
   from a fixed palette (colours that avoid the semantic hues; the next unused
   one is pre-selected).
2. **What does it sell?** — **big tiles, one per menu category**, each showing its
   icon, name and item count; tap to include the whole category. A category
   already made by another point is marked *"נמכר ב־עמדת קפה"* and tapping it asks
   *"להעביר לכאן?"* (move) — **conflicts are explained, never silently stolen**.
3. **Fine-tune (optional)** — the chosen categories expand into item lists with
   checkboxes (untick "Soda" from the pizza point), and *other* categories'
   items can be added one by one ("vanilla slushie" lives in Cold Drinks but this
   point makes it). The same conflict handling applies per item.
4. **How does it work?** — *Does this point hand the order to the customer?* (yes
   = the person here calls the name; no = someone else does) and *how fast is it?*
   as three plain choices — **מהירה (~3 דק׳) / בינונית (~8) / איטית (~15)** — which
   set `prep_minutes` and therefore when the dashboard calls an item stuck. No
   numbers to type.
5. **Review** — "עמדת קפה מכינה: קפה חם, שתייה קרה (+ אייס וניל) — 16 פריטים.
   קוראים בשם הלקוח." and **שמירה**. A success sheet offers *add another point* or
   *back to the checklist*.

Editing reopens the wizard on the same data. Deactivating is refused while the
point has live lines. Every save writes a `point_created`/`point_updated`/
`routes_changed` event with the full before/after.

### 9.6 Manager hub — `/owner/pos`

A **signal surface** (§13.3), server-rendered first paint + a 30 s poll:

- Header: event name, the **session pill** (פתוח · since 14:02 / סגור / אימון) and
  its button (open · close · wipe training).
- `StatStrip` (four): open tickets · sales · stuck · staff on points — each a tap
  to a drill-down.
- `SignalStack` — renders nothing when nothing is true.
- **Per-point cards**: backlog by status, oldest wait, median prep (last 20), who
  is checked in, a tap to open that point's queue read-only.
- **Live feed** — last 20 `pos_events` with handle chips; newest at top; unread
  badge using the server timestamp of the newest row seen.
- Tiles: *Orders*, *Statistics*, *Audit log*, *Setup*, *Staff*, *Menu*.

### 9.7 Orders history, log, statistics

- **`/owner/pos/orders`** — every order, paginated, filter by session, status,
  point, staff **handle**, free text (name / phone / `#` / receipt number) and
  date range; each row expands to the same detail as §9.3 plus emails.
- **`/owner/pos/log`** — the audit log (§13.1).
- **`/owner/pos/stats`** — §13.2; the session picker defaults to the active (or
  most recent) live session; a toggle includes training sessions.

### 9.8 Staff nickname

- **`/pos` gate:** if `handle_set_at` is null the app shows a single sheet before
  anything else — "איך נקרא לך? זה מה שהצוות יראה" — pre-filled with the suggestion,
  live-validated (length, characters, taken), saved through `pos_set_handle`.
- **Owner's staff page:** a handle chip on every row; *invite* requires one;
  tap to edit via `PromptSheet`; a row with an unconfirmed handle shows a quiet
  badge (and raises the info signal).
- **Everywhere else:** the handle, in the person's colour, with the first letter
  as an avatar disc. The email appears only in the owner's staff list and in the
  expanded audit detail.

### 9.9 Me / device sheet

Language (he / en), sound on/off, "this device is working at: <point>" (the
landing choice), sign out, and — for managers — a link to the manager hub.

---

## 10. The freshness engine — "lightning fast" is mostly this

### 10.1 What is read how

| Data | Mechanism |
|---|---|
| Queue, orders list, order detail, points, session, check-ins, feed | **Direct Supabase reads over RLS**, refetched when the realtime signal says the table is dirty |
| Menu | `GET /api/pos/menu?since=<stamp>` every 20 s + on `visibilitychange`; returns `{unchanged:true}` when the stamp (`published_at \| updated_at \| active_variant_id`) has not moved. Cached in `localStorage`; the cashier always has a menu. |
| Identity, points, routes, session, first menu | **Server-rendered into `/pos`'s props** (first paint is already populated) and cached in `sessionStorage` so a tablet waking from sleep paints instantly and revalidates behind it. |
| Every write | `/api/pos/*` |

### 10.2 Realtime — a module-level singleton

Ayeka's rules, all of which came from a bug:

- **Signal, don't reconcile.** A realtime event only says *table X is dirty*; the
  UI refetches its own scope. Rebuilding state from row deltas is where ordering
  bugs, missed frames after a reconnect and RLS-filtered gaps live.
- **One channel, created once, with every table listener registered *before*
  `subscribe()`.** `supabase-js` dedupes channels by topic and `.on()` throws
  after `subscribe()`; calling it from a child under a mounted parent crashed
  Ayeka's whole app through the error boundary, indistinguishable from a real
  crash. Sarcafe makes the manager a **module singleton** (`lib/pos/realtime.ts`)
  with `subscribe(listener)`; components can never touch the channel, and a
  re-mount cannot tear it down.
- **150 ms debounce** — a batch touches a dozen rows; the UI wants one refetch.
- **Gap-close:** on every `SUBSCRIBED`, mark *everything* dirty.
- **Watchdog:** every 5 s, if not live for > 15 s, rebuild. Some disconnects (a
  phone radio dropping mid-sleep) fire no `CLOSED` at all. Rebuild on the window
  `online` event too.
- **The backup poll drives the same signal:** every **8 s** it bumps the same
  `refreshKey` the socket bumps (Ayeka's station screens had *no* fallback until
  this was fixed), plus an immediate bump on `visibilitychange`.
- **Status pill, silent when live** — shown only when not connected. A warning,
  not a status bar.

### 10.3 Optimistic UI, and the whack-a-mole rule

Accept cosmetic races; never put a round trip on the hot tap path.

- **Station taps are optimistic**: flip the line locally at once, send, and on
  `conflict`/error roll back with a toast ("someone already accepted this").
  (Ayeka's station was pessimistic and silent on conflict.)
- **Register submit goes through the outbox**: the form clears and a pending
  chip appears instantly.
- **A claim must never move, re-order or re-animate a card.** Ayeka's station
  queue had an unresolved "whack-a-mole on accept" bug. Cards are keyed by line
  id, never re-sorted on a status change, and entrance animation applies only to
  *newly arrived* lines.

### 10.4 The outbox (cashier device)

- Persisted in `localStorage` (`sarcafe.pos.outbox.v1.<branchId>`), FIFO.
- Each entry: `{clientKey, queuedAt, payload, attempts, state, lastError}`.
- A flush loop sends one at a time; exponential backoff 1 s → 15 s cap; wakes on
  `online`, `visibilitychange` and on enqueue.
- **Transient failure** (network, 5xx, 429) → keep retrying. **Permanent
  failure** (`sold_out`, `no_session`, `bad_line`, `bad_customer`, 4xx) → stop,
  move to *needs attention* with the reason, and offer *edit and resend* /
  *discard*. **Nothing is ever dropped silently**, and nothing is discarded
  without a confirm.
- The server is idempotent on `client_key`: a retry after a lost response returns
  the original order with `deduped:true`.
- The register shows a pill with the pending / needs-attention count whenever it
  is non-zero.

### 10.5 Fail-open vs fail-closed (chosen per cost of being wrong)

| Read | Fails | Reason |
|---|---|---|
| "Is a session open?" (UI) | **open** | A transient failure must not lock the floor; the database refuses new orders without a session anyway (the pair is the point: fail-open client + fail-closed DB, or neither). |
| Menu refresh | **keep the last good menu** | The cashier must always be able to take an order. |
| Outbox flush | **retry** | Never lose a paid-for order. |
| Board endpoint error | **show the last list + a quiet "reconnecting"** | A blank board reads as "nothing is ready". |
| Realtime | **degrade to the 8 s poll** | — |
| Training-mode flag | **assume live** | Guessing "training" during real service would hide real orders from stats. |

### 10.6 Alerts, wake lock, haptics

- **Chime + vibration** (Web Audio, unlocked by the first tap — iOS requires a
  gesture; `navigator.vibrate` where it exists) on: a *new line arriving at your
  point*; a line going *critical*. A per-device mute toggle, persisted.
  Ayeka has **no** sound anywhere; this is net-new.
- **Screen Wake Lock** while any `/pos` view is visible, re-acquired on
  `visibilitychange` (tablets must not dim mid-service).
- **Haptics:** `haptic()` from `src/lib/haptics.ts`, never a bespoke one, and it
  must stay **focus-neutral**. Use it where the finger is deciding (steppers,
  accept/ready/handed-over, send).

### 10.7 Honest status surfaces

"I click and nothing happens" was Ayeka's recurring complaint. Every control
either disables *with a visible reason* or shows state immediately. Surfaces:
connection pill, outbox pill, offline-menu pill, an "event is closed" banner on
the register, the feed's distinct *couldn't load* state (a failed read must
never look like an empty one).

---

## 11. Design system, motion, skeletons

- **Tokens:** the existing coffee palette in `globals.css`, plus three semantic
  tokens added once, with contrast checked on all three elevations:
  `--ok` (ready / success), `--warn` (warming / closed), `--danger`
  (late / critical / void). **Teal (`--neon-2`) is reserved** for "whole order /
  shared" the way Ayeka reserves it; staff colours come from a palette that
  avoids the semantic hues.
- **Touch:** 52 px minimum (`--tap-min`), 44 px absolute floor for secondary
  controls; visible focus; real `<label>`s; errors `role="alert"`; colour is
  never the only signal (icon + text on every status).
- **Layout:** width alone picks the device — phone < 768, tablet ≥ 768, desktop
  ≥ 1280 (a pointer-type query would push the primary device, a coarse-pointer
  tablet, onto the phone path). **Tablet: menu grid on one side, ticket panel
  fixed on the other (340 px, 400 px at ≥ 1280), each its own scroller** —
  exactly one scrolling region per pane, `overscroll-behavior: contain`. **Phone:
  one column; the ticket is a bounded sheet opened from a pinned total bar.**
  Spatial UIs become lists on a phone.
- **Skeletons** (Ayeka's never rendered — see §3): `.sk` shimmer blocks
  **shaped like what they replace** (ticket-card silhouettes: a header bar and two
  or three line rows; order rows; stat cells), shown only after **300 ms**
  (`.sk-late`) so a fast load never flashes one. Every owner route has a
  `loading.tsx` whose geometry matches the real page; the staff SPA paints
  server-rendered props and shows skeletons only for in-view refetches that have
  nothing cached.
- **Motion:** the one `--ease` curve for travel, `--spring` only for "decided"
  moments; transform/opacity only; **never animate an element that carries a
  `backdrop-filter`**; honour `prefers-reduced-motion` globally. Entrance
  staggers (`.rise`) apply to *arriving* things only (§10.3).
- **RTL-first**, logical properties everywhere (`ps-`/`pe-`/`ms-`/`me-`/
  `text-start`); wrap numeric runs in `.ltr-isolate` (a bare `3 / 5` renders
  reversed inside Hebrew — a different, wrong claim, not a cosmetic one).
- **Fixed chrome is portalled to `<body>`** (`ModalPortal`) — the root
  `template.tsx` leaves a transformed ancestor that becomes the containing block
  for `position: fixed`.
- **iOS-native controls, never browser ones:** `SheetShell`, `ConfirmSheet`,
  `PromptSheet`, `SelectSheet`, `Switch`, `WheelPicker`; never a native
  `select`/`confirm`/`prompt`.
- One typeface (Rubik), Lucide icons only, no emoji in UI chrome.

---

## 12. Security

1. **Grants:** `revoke all … from public, anon, authenticated` on every new
   table, then `grant select … to authenticated` where a browser reads, and
   `grant all … to service_role`. (Sarcafe's `DEPLOYMENT.md` records the
   "RLS is not a GRANT" failure that already happened here — *every new table
   needs explicit GRANTs*.)
2. **Functions:** pinned `search_path`, `revoke … from public` first, then
   `grant … to service_role`; verified with
   `has_function_privilege('anon', …)`/`('public', …)` after applying.
3. **Views:** `pos_staff_directory` — select only; explicit revoke of
   insert/update/delete/truncate.
4. **Immutability triggers** (defence in depth even against `service_role`):
   `pos_events` rejects UPDATE/DELETE (the training wipe sets a
   transaction-local flag to pass); `pos_order_items` rejects changes to
   `name`, `unit_agorot`, `qty`, `point_id`, `order_id`, `created_by`,
   `item_uid`; `pos_orders` rejects changes to `created_by`, `ticket_no`,
   `session_id`, `branch_id`, `client_key`.
5. **Routes:** `requirePosStaff()` (active row + nickname set + branch access +
   POS enabled) and `requirePosManager(branchId)` (OP, or GM scoped to the
   branch — `canEditMenu`). Never a bare `auth.getUser()`. Every body is
   narrowed field by field with zod; never spread into a write.
6. **Rate limits** via the existing `check_rate_limit` (fail-open, as that
   function documents): create order 60/min/staff, advance 300/min/staff,
   handle change 10/hour/staff, board 120/min/IP.
7. **The board token** lives in `pos_branch_settings` (no client select), is ≥ 128
   bits, compared in constant time, rotatable by a manager, and logged.
8. **Verification after applying the migration is a write-probe, not a read**
   (Ayeka's zero-row-probe lesson): an unauthenticated `insert {}` must fail with
   `42501` *at the GRANT layer*; an authenticated non-staff `insert` likewise;
   `rpc` of every `pos_*` function as `anon`/`authenticated` must be refused. A
   `select` returning `[]` proves nothing — RLS-hidden and empty look identical.

---

## 13. Audit and analytics

### 13.1 Audit — "everything logged, easy to see"

`pos_events` is the single log. Written by the RPCs in the same transaction as
the change — never client-side, never best-effort (Ayeka's client-written log
was lossy and a missing CHECK value silently dropped rows). **The CHECK
vocabulary is complete from day one:**

`order_created`, `items_added`, `order_edited`, `item_claimed`, `item_ready`,
`item_picked_up`, `item_delivered`, `item_reverted`, `item_voided`,
`order_voided`, `order_completed`, `session_opened`, `session_closed`,
`training_wiped`, `point_created`, `point_updated`, `point_deactivated`,
`routes_changed`, `checkin`, `checkout`, `handle_changed`, `board_token_rotated`,
`settings_changed`, `pii_cleared`.

Each carries **display data in its payload** (customer name, ticket number, item
names + qty, point name, old → new for edits), because a feed line that has to
join back to recover the name shows a blank the day the join breaks (Ayeka feed
bug). Surfaces: the live feed on the hub, the per-order timeline in order detail,
and `/owner/pos/log` (filter by event type, staff handle, point, date; every
row shows the actor's handle, with the email in the detail).

### 13.2 Statistics

All server-computed, service role behind `requirePosManager`, every number
carries `known` (a failed read is `—`, never a confident `0`), integer agorot,
times server-stamped, filters imported from one constants module shared with the
live signals so a drill-down can never disagree with the number above it.
Training sessions are excluded unless explicitly selected.

| # | Metric | From |
|---|---|---|
| 1 | Sales per item (qty, ₪, share) | un-voided lines grouped by `item_uid` + `name` |
| 2 | Sales per point | grouped by `point_id` |
| 3 | Throughput per point (items per 15 min) and live backlog | `sent_at` buckets; in-flight counts |
| 4 | Prep times — queue wait (`claimed_at − sent_at`), prep (`ready_at − claimed_at`), uncollected wait (`delivered_at − ready_at`), total — median and p90 per point and per item | the stamped columns |
| 5 | Peak hours (15-min buckets, event time zone) | `created_at` |
| 6 | Per-staff counts by **handle**: orders entered, ₪ entered, lines accepted / readied / handed over, voids | `created_by`, `claimed_by`, `picked_up_by`, `delivered_by`, `voided_by` |
| 7 | Void rate; voids by staff / item / reason | `voided_*` |
| 8 | Average ticket, items per ticket | orders |
| 9 | Customers served | tickets |
| 10 | Slip mismatches | `slip_mismatch` |
| 11 | Staff presence per point (minutes on point, items per staff-hour) | `pos_point_checkins` |
| 12 | Uncollected orders | `ready` and not delivered |
| 13 | Sold-out timeline | menu audit (`menu.availability`) |
| 14 | Category breakdown | `category_id` |

Hero number + stat tiles + simple bars (a hero revenue figure, a few tiles —
orders, average ticket, void rate, median prep — then per-point, per-item,
per-hour and per-staff lists). CSV export (UTF-8 **with BOM** so Hebrew opens
correctly in Excel).

### 13.3 The dashboard (a signal surface, not a settings page)

Same mechanism as Ayeka's: **four** numbers (open tickets · sales · stuck ·
staff on points), each with a `known` flag; a **signal stack that renders a row
only when it is true and renders nothing otherwise** (a panel that is always
present becomes furniture and the night it says something real nobody reads it);
a fixed `rank` per signal decided server-side so the stack cannot jitter; one
30 s poll plus `visibilitychange` catch-up; tap-to-expand drill-downs.

Signals (critical ≥ 80, warning 40–79, info < 40): *training mode on* (100),
*event not open* (90, only while POS is enabled and nobody has opened it),
*unrouted menu items* (88 — an item customers can buy that no point makes),
*stuck items* (70), *point backlog* (68), *sold out at a point* (60),
*uncollected orders* (55), *session open too long* (50), *slip mismatches* (45),
*staff missing a confirmed nickname* (25).

---

## 14. Privacy and retention

Customer name and phone are personal data. Ayeka's OMS stores none; Sarcafe's
does, so it carries a retention rule from day one:

- **Phone numbers are cleared 30 days after the session ends**; **names become a
  neutral placeholder after 365 days.** Both are constants in
  `src/lib/pos/vocab.ts` and arguments to `pos_clear_old_pii`, run nightly by a
  Vercel cron route (`/api/cron/cleanup-pos`, gated by `CRON_SECRET` like the
  existing cleanup routes), and logged as `pii_cleared`.
- The register states the purpose in one line next to the phone field.
- The public board shows first names only and is served from a rotatable
  unguessable link.
- No client IP is stored anywhere; the rate limiter keys on it and forgets it.
- Audit rows keep the *customer's first name* in their payload for readability;
  phones are never copied into events.

---

## 15. Testing and definition of done

- `scripts/check-pos.mjs` — pure-logic harness that **transpiles and runs the
  real `src/lib/pos/*` sources** (same technique as `check-a11y.mjs`): pricing
  (slash prices, type deltas, rounding, merge identity), routing precedence and
  the no-point refusal, the transition table and derived order status, aging
  stages and the overdue count, board-entry derivation, handle / phone / name
  validation, outbox decisions (transient vs permanent), colour assignment
  determinism, i18n completeness (every Hebrew key present, English
  type-checked), and TS↔SQL agreement on caps and vocabularies.
- `scripts/verify-pos-sql.mjs` — runs the migrations against an in-process
  Postgres (PGlite) with stubbed `auth` / roles and **exercises the functions**:
  idempotent create, two concurrent advances → exactly one `ok`, void/derive,
  immutability triggers, append-only events, route uniqueness, session guard,
  retention. This is how the SQL is tested before it ever touches a real
  database.
- **After applying to Supabase:** the write-probe of §12.8, then a live
  create → accept → ready → hand-over round trip, then cleanup of that test data.
- **Device matrix on every UI change** (Sarcafe inherits Ayeka's rule): 375×667,
  390×844, 430×932, 360×740, 280×653 (Fold, closed), **844×390** (landscape — the
  shortest viewport and the one that catches overflow first) *and* tablets
  1024×768 / 768×1024 / 1280×800. Check the primary action is inside the viewport
  **and** that a hit test at its centre lands on it. Hebrew RTL first, then
  English.
- `npx tsc --noEmit` and `npm run build` (never while a dev server is running in
  the same directory — both write `.next/`).
- Docs updated before the session ends: this file, `DEPLOYMENT.md`.

---

## 16. Phasing

**Phase 1 — this build.** Everything above except the Phase-2 list. Order of
work: schema → shared lib → server layer → app shell + realtime → register →
station + board → owner wizard / setup → hub, history, stats, log → handle UI →
review → live verification.

**Phase 2 — after the first real event.**

- *Auto stock decrement* (per-branch switch): consume `quantity` on order, restore
  on void, through the same locked-document write `set_availability` uses.
- *Arabic UI strings.*
- *HYP end-of-day reconciliation*: enter the terminal's own total per day and see
  the variance against the POS total (Ayeka's plan deliberately made its report
  "in addition to, not replacing" the register's Z report).
- *Manager "overall view"*: a pane per point on one screen, observe-only unless
  the session is `training`.
- *PWA manifest + install*, first-run coach marks.

**Phase 3 — only if wanted.** Customer pickup push (the VAPID side project) fed
from the same `ready` transition; ticket printing; multi-event comparison.

---

## 17. Rules inherited from Ayeka's bug history

Each of these cost Ayeka a live-testing round. Where Sarcafe applies it:

| Rule | Applied in |
|---|---|
| Send the user's identity, not the anon key — `apikey` is the project, `Authorization` is the person | Browser client carries the session; writes resolve the actor server-side |
| One source of truth: the server. A second local copy of *state* diverges | The outbox holds *intents*, never state |
| One realtime channel at the top; children react to a counter | §10.2 singleton |
| The fallback must drive the same signal the socket drives | 8 s poll bumps `refreshKey` |
| Distinguish *failed* from *empty* | `ok` flag on every read; feed "couldn't load" state |
| Never embed across a non-FK; real FKs on every event row | `pos_events` FKs |
| Write display data into the event payload at write time | §13.1 |
| CAS every status transition; surface the conflict | `pos_advance_items`, conflict toast |
| Serve implies pickup — stamp, don't block | `pos_advance_items` |
| A closed/void parent must not leave ghost lines on a screen | Derived order status; ghosts for voided-after-sent |
| Voiding an order must void its lines | `pos_void_items(null)` |
| Filter *never-sent* lines at the producer of a cancel alert | Ghosts only for lines that were sent |
| Never ship a dead button whose only explanation is a `title` (no hover on touch) | Disable-with-visible-reason |
| Escalation must read as building: the first stage is quiet and still | §7.3 |
| Tick ≤ 5 s when a threshold is being watched | §7.3 |
| SELECT strings and TS types drift — one shared column list, and `?? []` guards | `lib/pos/columns.ts` |
| Poll any owner switch that matters mid-session | Session/enabled state in the 8 s refresh |
| A mid-service menu publish must arrive | 20 s stamp poll |
| Routing is its own confirmed map, independent of the browse taxonomy; cap menus by the map itself | §7.2 |
| Closing side-effects belong in a trigger/function, not the client | Derived status inside the RPCs |
| Deterministic round-robin colours, not a hash | `colour.ts` |
| Unit in the variable name; round the unit price *before* × qty | §7.1 |
| High-water marks use server timestamps | Feed unread uses `pos_events.at` |
| Check-then-write is a race; use unique indexes | One active session; unique routes; unique `client_key` |
| Multi-row operations must be atomic | Every RPC |
| Prices are never client-supplied | §7.1 |
| `service_role` writes bypass identity stamping — stamp the actor yourself | `p_staff` from `requirePosStaff()` |
| Revoke from PUBLIC first | §12.2 |
| Verify with a write-probe, not a read | §12.8 |
| Test fixtures pollute live signals — wipe before real service | Training sessions + `pos_wipe_training` |
| A session left open for a week silently disabled its own gate | 16 h signal |

---

## 18. Open decisions (defaults are in force until the owner says otherwise)

1. **Who sees the manager side?** Default: owner + a general manager scoped to
   the branch — so the on-site manager can run the event without full owner
   rights. Staff management and branch creation stay owner-only.
2. **Retention windows** — 30 days phones / 365 days names (§14).
3. **`hands_over` default** — *true* (the point gives the item to the customer).
   Turn it off for a point whose output is carried by a runner.
4. **Event menu starting point** — the wizard offers *clone Maor / clone Givat
   Haviva / start empty*.
5. **Should events appear on the public portal?** Default: no (`kind = 'event'`
   is hidden from the branch picker); the `/menu/<slug>` link still works for a
   QR at the stall.
6. **Aging thresholds** are Ayeka's owner-chosen 60/120/300 s for *unaccepted*
   lines, global. Per-point override is a one-column change if coffee and pizza
   turn out to want different numbers after a real event.

---

## 19. File map (planned)

```
supabase/migrations/020_pos_core.sql        schema, functions, triggers, grants, realtime, verify block
scripts/check-pos.mjs                       pure-logic harness
scripts/verify-pos-sql.mjs                  PGlite SQL verification

src/lib/pos/                                pure domain (no React, no DOM)
  types.ts vocab.ts columns.ts pricing.ts routing.ts lifecycle.ts aging.ts board.ts
  validate.ts format.ts colour.ts outbox.ts i18n.ts alerts.ts device.ts
  realtime.ts client.ts                     (browser-only: singleton + fetch wrappers)
  server/                                   (server-only)
    guard.ts menu.ts resolve-lines.ts board.ts readiness.ts signals.ts
    details.ts stats.ts log.ts export.ts

src/app/pos/page.tsx loading.tsx            staff app entry
src/components/pos/                         PosApp, PosProvider, Register, Cart, ItemSheet,
                                            Station, Ticket, OrdersList, OrderDetail, Board,
                                            Me, ConnectionPill, skeletons, pos.css …
src/app/board/[token]/page.tsx              Ready board
src/app/owner/pos/{page,setup,orders,stats,log}/…   + loading.tsx each
src/components/owner/pos/                   Hub, Wizard, Readiness, History, Stats, LogView …
src/app/api/pos/…  src/app/api/owner/pos/…  src/app/api/board/[token]/route.ts
src/app/api/cron/cleanup-pos/route.ts
```

## 2026-10-08 — employee-code event access (local)

Number/code event access now resolves the same active `staff.id` through `resolveStaffIdentity`. Opaque employee sessions never require a fabricated Auth user/email and remain floor-only (`quick=true`, `codeOnly=true`); owner/manager operations still require a full Google session. Existing branch authorization is preserved: a branch-scoped employee is not automatically authorized for a separate event branch merely because they know its link.

`/api/pos/read` accepts a closed set of validated resource selectors (`live`, `orders`, `order`, `order_events`, `point_history`, `checkin`). The route authorizes the branch from the current actor; service reads validate session/point membership, bind audit rows to an authorized order, and restrict presence to the actor. No arbitrary table, column, SQL predicate, staff identity or database privilege comes from the browser. Responses are `no-store`; browser grants/RLS are unchanged.

Opaque sessions use this API for live/older orders, details, audit history, station history and presence, and refresh all configuration slices via bootstrap on the existing eight-second fallback. They do not open Realtime. Google and linked quick JWT sessions keep their existing authenticated browser reads/socket. The connection pill reports the fallback state honestly. Cached configuration restoration now requires the same staff identity and transport mode so a shared device cannot restore a different employee's last screen.

The owner may now explicitly assign any active employee to an event station. Active station membership permits floor access to that event without changing the employee's permanent branch; it never grants event management or access to an unrelated permanent branch. Removing/deactivating the station removes this access on the next resolved request. A station/timeline link without `branch` resolves its authorized event from its point ID. New PIN logins always use opaque cookies, including Google-linked employees. Google login without a specific destination opens the categorized `/staff` home; a full owner resolves to `/owner/dashboard`.

Verification: `node scripts/check-pos-access.mjs` exercises the real TypeScript guard/schema/read code with local query fixtures (37 assertions): no-Google identity, legacy/full session classification, floor manager denial, inactive/non-staff denial, branch/session/point/order isolation, self-only checkins, selector injection rejection, server paging bounds and explicit event membership/revocation. This does not replace an authenticated event device pilot. Deployment/migration state is recorded in `handoff.md`.
