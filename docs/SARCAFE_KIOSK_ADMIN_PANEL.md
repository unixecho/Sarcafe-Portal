# Sarcafe kiosk: the control panel, the tablets and their settings

Written 2026-11-04. The control panel is how the owner tunes a kiosk tablet at work, by hand, without a developer or a cable.
This file is the reference for what it can change, where those settings live, how the alert to the developer works, and how a
second tablet (another branch) is added.

## Opening it

5 quick taps in the top-left corner of the tablet, then the staff PIN (the same PIN as before). The app then opens the page's
control panel. **This needs app version 0.3 or later** (`versionCode 3`): with the older app the same 5 taps and PIN show the old
plain menu (nothing is lost), and the panel's settings that are only a page (everything except the "device" and "updates" tabs)
can still be reached by updating the app. The older plain menu is still there, one button down in the panel's device tab
("תפריט מערכת מתקדם"), including "remove the kiosk completely".

The panel closes by itself after three minutes without a touch, and the app ends the staff session with it. "תצוגה מקדימה"
puts the panel away so the kiosk can be seen as a customer sees it; one tap on the pill at the top brings it back.

## What it changes

| Tab | Settings |
|---|---|
| סקירה | The charge, the connection to the portal, who is on shift now, which tablet and branch this is. Sync now, reload, preview. |
| מסכים | The header: show who is on shift, show the closing time, where the closing time comes from, the branch name, the item count. The welcome credit line. The customer club (button, card, ad). |
| מודעות | Arrows, dragging, auto-play, going round, slide or fade, what a tap on an ad does, the time on each ad, which ads this tablet shows. |
| זמנים | Time without a touch before the privacy-reset warning, the warning's length, how long the sign-up confirmation stays, how often the content refreshes. |
| שפות | Which of Hebrew / English / Arabic are offered, the default one (the kiosk starts in it and returns to it after every visit), the language switch. |
| סוללה | Where the charge shows (tray, corner, hidden), the alert to the developer (on/off, the level), an optional urgent alert, a test alert. |
| מכשיר | (app 0.3+) Rotation, speed mode, brightness, Wi-Fi, unlock for 5 minutes, restart the app, restart the tablet, a new PIN, leave kiosk mode. |
| עדכונים | (app 0.3+) The page and app versions, check now, undo the last page update. |
| אבחון | What the tablet knows about itself, clear the saved ads, rename the tablet in the portal, everything back to the defaults. |

Ranges are enforced on the tablet and again by the portal (`src/lib/kiosk/device-settings.ts`): idle 30-300 s, warning 5-30 s,
confirmation 5-60 s, content refresh 5-120 min, time on each ad 3-60 s, alert level 10-90 %, urgent level 5-40 % (and always
below the ordinary one), at most 20 hidden ads, at least one language and the default one always among them.

## Where the settings live

* **On the portal** (`kiosk_devices.settings`, one row per tablet): only what somebody changed. Everything else follows the
  built-in defaults, so an improved default reaches every tablet that never changed that setting.
* **On the tablet**: a copy of the portal's answer (so it starts right with no network) and a list of changes the portal has not
  confirmed yet. A change from the panel applies at once, is saved with `PUT /api/kiosk/device` (the kiosk's shared key, only
  this tablet's own settings), and if that fails (offline, or the database update not applied yet) it stays pending and is sent
  again every few minutes and with every report. The status chip in the panel says "הכול נשמר", "שומר…", "ממתין לשליחה" or
  "נשמר בטאבלט בלבד".
* **A change on the owner's page** (`/owner/kiosk`, the "הטאבלטים" card) reaches the tablet with its next report (every 5
  minutes): the report's answer carries the time the settings last changed, and a newer time makes the tablet fetch the content.
* The three timings can follow the branch (`/owner/kiosk`, the existing "זמנים"): "לפי הסניף". A tablet's own value wins.
* Default values are in `SETTINGS_DEFAULTS` (portal) and `DEFAULTS` in `overrides/kiosk-config.js` (tablet).
  `scripts/check-kiosk-device.mjs` fails if the two copies, their kinds or their bounds drift apart.

## The ads

* Two round arrow buttons on the sides of the ads, 60 px: the one on the right points right, the one on the left points left.
  In Hebrew and Arabic (right to left) the right arrow goes to the previous ad and the left arrow goes on; in English the right
  arrow goes on. Dragging the ads sideways does the same (a short, slow drag snaps back; a flick turns the page). Past the last ad
  it comes round to the first, and the other way round (switchable).
* The auto-play always comes round. A finger on the ads holds it.
* A tap on the ad itself (not on an arrow, not the end of a drag) does what it did before: the ad's own action (join, menu), else
  the main screen. The setting "תמיד המסך הראשי" makes every tap open the main screen.
* "Hidden on this tablet" hides an ad on this tablet only. Texts, pictures, order and the poll QR are still edited on
  `/owner/kiosk`.

## The header: who is on shift, and when we close

`GET /api/kiosk/shift` (the kiosk's key; never cached) answers first names and a closing time for **the branch the tablet is linked
to**: published weeks only, on the branch's own clock. It answers only what the tablet's settings ask to show.

* **Closing time = the end of the chain of shifts.** The end of the running shifts, moved later while another shift is already
  running at that minute or starts exactly then. So at 13:00 a 07:00-14:00 morning shift followed by a 14:00-22:00 evening one
  says 22:00, not 14:00. A break between two shifts ends the chain. A shift nobody is assigned to is not counted.
* "Closing at" can come from the opening hours instead (`display.closingSource`: shift / hours / shift then hours, the default),
  which the content answer already carries. With hours it only shows while the place is open.
* An answer older than five minutes is not shown. Names are plain text. In portrait the header gets a second row for the chips.

## The battery

* **No pill over the display any more.** Pull down from the very top edge of the screen (a swipe of at least 40 px that starts in
  the first 30 px): a small tray shows the charge and whether it is charging, for six seconds. The system's own status bar cannot
  be pulled down (the app, as device owner, switches it off), so the page has its own. "תג בפינה" brings a small badge back for a
  tablet being tested on a desk; "מוסתר" shows nothing (the panel still does).
* The reading comes from the app's battery service (app 0.3+), else from the page's Battery Status API, which the tablet's WebView
  156 supports (seen on the real tablet on 2026-11-04). With neither, nothing is claimed.
* **The alert to the developer.** The tablet reports every 5 minutes while its screen is on (and soon after plugging in or a
  5-point move). The database function `kiosk_device_report` writes ONE `dev.kiosk_battery` alert for each active developer
  (`staff.badge = 'developer'`, never an owner) when the level is below the tablet's alert level (default 50 %) **and it is not
  charging**. It is armed again by charging, or by the level rising 5 points above the level; at most 8 per person per day. An
  unknown charging state never alerts. Switchable and adjustable in the panel and on the owner's page. An optional urgent alert
  (default off, 15 %) replaces the ordinary one when the charge is that low. "שליחת התראת בדיקה" sends one alert marked "(בדיקה)".

## Several tablets, several branches

* `kiosk_devices` has a row per tablet: `slug` (what the tablet calls itself), `name`, `branch_id`, `active`, the settings and what
  it last reported. Migration `20261104120000_kiosk_devices.sql` creates it with the tablet that already exists
  (`givat-haviva-1`, linked to the Givat Haviva branch).
* A tablet names itself with `?device=<slug>` on `content`, `menu`, `shift` and in its reports and saves; the content, the hours,
  the menu and the shift are those of the branch the row links to. A request that names no tablet is `givat-haviva-1`, so every
  tablet in the field keeps working. **Until the migration is applied every request is served as that legacy tablet with the default
  settings** (the portal checks, so shipping the code first is safe).
* To add one: the owner's page, "הטאבלטים", "הוספת טאבלט" (slug, name, branch). On the new tablet: panel, "אבחון", "שינוי שם המכשיר
  במערכת". The tablet also needs its page/menu address, realtime key and the shared key over adb (as for the first one), and its
  menu-update channel (`rt_channel`) for that branch if it should update at once.
* The kiosk's key is one shared value (`KIOSK_SIGNUP_KEY`) for every tablet for now. A tablet can only change its own settings
  (never its branch, name or the key), the shift line needs the key, and everything is bounded and strict.
* **Still pinned to Givat Haviva** (so a second branch's tablet shows that branch's cards, hours, menu and shift, but): the
  dashboard's one Save (`kiosk_content_save`), the QR poll and its results (`kiosk_feedback_submit`) and the privacy / business
  texts are still the Givat Haviva ones. Generalising them is a follow-up (a branch parameter on those functions).

## The app side

`window.KioskStaff` (`StaffBridge.java`, app 0.3+): `info(token)`, `act(token, action, arg)`, `close(token)`. The page gets a random
one-time token only when the app opens the panel after a correct PIN; every call must carry it and arrive while the session is
alive (15 minutes after the last call), only from the kiosk's own page. Actions: reload, orient, perf, brightness, wifi, unlock,
restart_app, reboot, exit, native_menu, check_updates, undo_web, set_pin. Reboot and "exit kiosk mode" ask again in a native
dialog. A new PIN needs the current one and shares the PIN dialog's lockout. An update never reloads the page while the panel is
open. Read-only facts without the PIN are on `KioskNative`: `battery()`, `appVersion()`, `webVersion()` (no customer data).

## Shipping it

1. Apply `supabase/migrations/20261104120000_kiosk_devices.sql` in the Supabase SQL editor, then
   `insert into supabase_migrations.schema_migrations (version, name) values ('20261104120000','kiosk_devices') on conflict do nothing;`
2. The page (everything except the panel's entrance and the device/updates tabs) travels by the usual signed OTA.
3. The panel's entrance and the device tabs need the new app: `build.ps1 -VersionCode 3 -VersionName 0.3` (needs the keystore
   password in `SARCAFE_KIOSK_KS_PASS`), `node scripts/publish-kiosk-ota.mjs apk`, commit `public/kiosk-ota/apk/`, push. The tablet
   installs it itself at an idle moment. (`MIN_NATIVE_VERSION` stays 2: the page works without it.)

## Checks

`npm run check:kiosk-device` (settings, shift/closing, which kiosk, wiring, the app compiles), `npm run check:kiosk-ui` (the screens,
in a browser), `npm run verify:kiosk-content-sql` (the database, including the alert rules), and the existing kiosk suites.
