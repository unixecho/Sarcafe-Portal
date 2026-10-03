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
supabase/migrations/014_pos_core.sql        schema, functions, triggers, grants, realtime, verify block
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
