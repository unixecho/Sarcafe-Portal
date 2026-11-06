# The kiosk dashboard — managing the tablet from the portal

**Owner, 2026-11-05:** "I want the kiosk to be manageable from the dashboard and I want to have access to the kiosk control panel as well
from the dashboard in a separate page … give me a way to bounce back from dashboard to dashboard. I want to be able to reset the kiosk pin
as well from the dashboard."

## Where it is
- **`/owner/kiosk/control`** — "לוח הקיוסק". Full owners only (the developer counts as an owner; branch managers and employees are sent
  away by the middleware and by the page itself, and every action checks again with `requireOwner`).
- **The switch at the top of both dashboards** (`DashboardSwitch`, `src/components/glass/DashboardSwitch.tsx`): "לוח הבקרה | הקיוסק". From
  the owner dashboard (or the developer's manager view) to the kiosk dashboard and back, inside the app (no page reload), with the same
  dock. The kiosk dashboard is a dock root (`src/lib/nav/dock.ts`), so the bottom bar stays put.
- It has its own `loading.tsx` (`GlassSkeleton kind="kiosk"`).

## What it shows and does (`src/components/kiosk-admin/KioskControl.tsx`)
| Part | What |
|---|---|
| The tablet | online (a report in the last 7 minutes) or not, the battery ring (percent, charging), app version, page bundle version, last report |
| Remote actions | **reload the page**, **check for updates now**, **reset the staff PIN**. A sent action shows "ממתין לטאבלט" until the tablet takes it, and can be cancelled until then |
| Settings | the same sections as the tablet's own glass control panel (`src/lib/kiosk/settings-ui.ts` mirrors its labels): what the header and the welcome screen show, ads, timing, languages, battery alerts to the developer. Changes collect in the save bar (save / cancel); saved settings reach the tablet with its next report (every few minutes) |
| Links | the kiosk content (`/owner/kiosk`), the vote results, the sign-ups |

The page refreshes the tablet's state every minute while open.

## How a remote action reaches the tablet (no new connection to the tablet; it always asks)
The tablet already reports every few minutes (`POST /api/kiosk/device`, `X-Kiosk-Key`). Remote actions ride on that:

1. **Command** (reload / check for updates): the dashboard stores one pending command on the tablet's row
   (`kiosk_devices.pending_command`, `{id, kind, at}`; at most one; a new one replaces it). The next report's answer carries it. The page
   (`overrides/kiosk-device.js`) writes the command's id to `localStorage` **before** carrying it out (a reload can never loop), and its next
   report says `commandDone: <id>`; the portal clears the command only when that id matches the one still pending.
2. **PIN reset**: the owner types the new PIN twice. The portal checks it (6–8 digits; not one repeated digit; not an ascending or
   descending run) and stores **only the record the tablet itself keeps**: `pbkdf2$15000$<salt>$<hash>` (PBKDF2-HMAC-SHA1, 16-byte random
   salt — exactly `StaffPin.java`'s format). The PIN itself is never stored, logged, or sent back to any screen. One pending reset per
   tablet (`kiosk_pin_resets`, a new one replaces it); five resets per owner per hour.
   The app (0.4+) asks for it on every update check (`OtaUpdater.checkPinReset`, `GET /api/kiosk/device/pin?device=<slug>` with the kiosk
   key, over the pinned host with no redirects), checks the record's shape (`PinReset.java`), keeps it where the PIN dialog reads it
   (`pin_v2`), clears the old hash and any lockout, and confirms (`POST`); the portal then deletes the row and stamps
   `kiosk_devices.pin_reset_applied_at`, which the dashboard shows.

## What works today and what waits for the owner's PC
- **Today**, once migration `20261105223000_kiosk_remote_control` is applied: the dashboard, the switch, all settings, and sending /
  cancelling commands and PIN resets.
- **The tablet carries out commands and PIN resets only after** the owner builds **app 0.4** (the Java changes: `OtaUpdater`, `PinReset`,
  `MainActivity`, `KioskConfigReceiver`) and signs a new **page bundle** (`kiosk-device.js`) on the PC — the signing keys never leave it
  (`docs/SARCAFE_KIOSK_OTA.md`). Until then the dashboard says so next to the actions ("needs app 0.4"), and a pending action simply waits.

## Endpoints
| Route | Who | What |
|---|---|---|
| `GET /api/owner/kiosk/devices/actions` | owner | the pending command / PIN reset per tablet (never the record) |
| `POST /api/owner/kiosk/devices/actions` | owner, same-origin JSON | `{action: 'command', slug, kind}` · `{action: 'cancel_command', slug}` · `{action: 'pin', slug, pin, confirm}` · `{action: 'cancel_pin', slug}` |
| `GET /api/kiosk/device/pin?device=` | the tablet (`X-Kiosk-Key`) | the pending record, once; marks it delivered |
| `POST /api/kiosk/device/pin` | the tablet (`X-Kiosk-Key`) | `{device, id}` confirms it was applied |
| `POST /api/kiosk/device` | the tablet (`X-Kiosk-Key`) | the report; its answer now also carries `command` |

Without migration `20261105223000` the owner routes answer 503 "not ready" and the tablet routes answer "nothing pending" — nothing breaks.

## Tests (the kiosk QA suite, `qa/kiosk/*`, its own daily report)
`kiosk-static`: the page's scripts parse, the bundle assembles, **a record made by the portal's code opens the panel in the app's own Java**
(`javac` + `java`), the wiring. `kiosk-checks`: every `check:kiosk-*` script. `kiosk-api`: the key, commands end to end, the PIN round trip,
the PIN rules and the rate limit, owner-only, outage. `kiosk-ui`: the dashboard in Chromium, the switch both ways (owner and developer),
saving settings, the remote actions, access, contrast in all five looks, iPhone and tablet widths.

## Live stock from the kiosk (owner, 2026-11-06)
"I want the kiosk to be able to handle the live stock like the dashboard does so I can update the menu quantities from the dashboard
and or the kiosk." The tablet's control panel has a **מלאי** tab (second): the SAME list as the dashboard's live-stock page
(`/owner/tablet`): the categories marked live in the menu editor (`liveOnTablet`: today כריכים וטוסטים, מאפים, שייק פירות טבעי,
עוגיות), every item and every type, each with in stock / sold out and, when counted, − / + on the count.
- **One write path for both:** `POST /api/kiosk/stock` calls the same `set_availability()` as the dashboard: draft and the published
  menu together, so customers see it at once (the menu realtime broadcast); a count of 0 is sold out; every change is in the menu
  audit log as "(מהקיוסק)" with the tablet's name.
- **The dashboard's rules for a non-owner hold:** only during opening hours (closed → 403; the tab says the branch is closed and the
  controls are off); only items of the live categories (anything else → 404); the tablet's own branch only (its row in
  `kiosk_devices`); the kiosk key; strict input; 240 changes per tablet per 10 minutes.
- `GET /api/kiosk/stock?device=` gives the list and whether the branch is open. No tablet name = the portal's default tablet.
- No migration. Reaches the tablet with the next signed page bundle (`kiosk-admin.js`, `kiosk-admin.css`).
- A type the menu does not have cannot be shown: today **כריכים has no types** (one counted item); add them in the menu editor
  and they appear in both lists.

## The staff PIN on the tablet (2026-11-06)
App 0.3 closes the PIN dialog **without a word on a wrong PIN** (a correct one always opens the panel or the fallback menu), so a
wrong PIN looked like "nothing happens". App 0.4 says "Wrong PIN" (and the lockout time). The PIN was replaced when the tablet was
re-provisioned on app 0.3 (2026-11-05, see handoff); the dashboard's reset reaches the tablet only from app 0.4. Until then, from the
PC with the tablet on USB: `adb shell am broadcast -n il.co.sarcafe.kiosk/.KioskConfigReceiver --es pin <6-8 digits>` (also clears
the lockout). **App 0.3 answers `nothing changed` even when the PIN WAS saved** (that word only means "no page reload"); a PIN that
is not 6–8 digits is ignored with the same answer. From app 0.4 the answer ends `; PIN set` or `; PIN NOT set`.
**adb on the owner's PC** is not on the PATH: `C:\Users\Johnathan\android-tools\platform-tools\adb.exe` (PowerShell: `.\adb.exe` from
that folder). `scripts/pc/kiosk-adb.ps1` finds it: `powershell -ExecutionPolicy Bypass -File scripts\pc\kiosk-adb.ps1 pin <6-8 digits>`.
