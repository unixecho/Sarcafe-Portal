# The menu editor on the kiosk tablet

**Owner, 2026-11-06:** the full menu editor on the tablet, behind the staff PIN: names, prices, adding and removing items and types,
through the same rules as the dashboard. (Live stock — in stock / sold out / counts — is the separate מלאי tab,
`docs/SARCAFE_KIOSK_REMOTE.md`.)

## On the tablet
Control panel (5 taps top-left + staff PIN) → **תפריט**. Every category of the branch's menu; tap one to open it. Per item: **עריכה**
(name, price), **+ סוג** (a new type, with an optional extra price), **מחיקה** (asks first). Per type: עריכה, מחיקה. Per category:
**הוספת פריט**. Prices are digits ("14", "14.5") or a range ("20/24"); empty = no price. Outside opening hours the tab says the
branch is closed and every button is off.

## The rules (the dashboard's, for anyone but the owner)
- `GET/POST /api/kiosk/menu-edit` (`src/app/api/kiosk/menu-edit/route.ts`, rules `src/lib/kiosk/menu-edit.ts`), with the kiosk key,
  on the tablet's OWN branch menu only.
- The same database writes as the dashboard's tablet tools: `add_menu_item`, `remove_menu_item`, `set_menu_item_container` (an
  item's first type), `add_menu_item_type`, `remove_menu_item_type`; plus **`menu_update_entry`** for a name or a price (migration
  `20261106180000_menu_update_entry`).
- Only during opening hours (else 403), and then the draft AND the published menu together: customers see it at once (realtime
  broadcast). Every change is in the menu audit log "(מהקיוסק)" with the tablet's name. 120 changes per tablet per 10 minutes.
- Strict input: names 1–80 characters without control or direction-override characters; prices digits or a range; ids
  `[A-Za-z0-9_-]`; no extra fields; unknown entries → 404.
- Images, translations, notes, reordering and the modifier library stay in the desktop editor.

## Tests
`kiosk-api.menu-list|menu-edit|menu-rules`, `unit.kiosk-menu-edit-rules`, `kiosk-static.menu-sql` (the SQL function in real Postgres,
PGlite), `check:kiosk-ui` (the tab in Chromium: open a category, edit with validation, add and delete types and items, closed state).
