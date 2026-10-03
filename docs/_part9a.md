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

