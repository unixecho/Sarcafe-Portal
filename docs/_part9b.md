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
