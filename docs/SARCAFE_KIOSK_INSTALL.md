# Installing the kiosk on a tablet — the QR wizard

**Owner, 2026-11-06:** "I want an install wizard and a private internal link I can use to install the kiosk on any tablet." No computer,
no cable: the private link is **`/owner/kiosk/install`** (owners only; also from the kiosk dashboard → "התקנת קיוסק על טאבלט").
Later: a suite that prepares any tablet for the kiosk, until an approved APK is published in a store.

## How it works
1. **The wizard** (`src/components/kiosk-admin/KioskInstall.tsx`, API `src/app/api/owner/kiosk/install`): the owner picks the
   branch, the tablet's name and id (an existing id = a complete reinstall of that tablet), the staff PIN (twice, the dashboard's
   PIN rules) and optionally the Wi-Fi. The portal registers the tablet (`kiosk_devices`), stores a one-time install code — only its
   SHA-256, 24 hours, one use (`kiosk_enrollments`, migration `20261106140000`) — and the PIN only as the app's PBKDF2 record. It
   answers the QR's contents once; the Wi-Fi password exists only inside the QR.
2. **The QR** is Android's own device-owner setup (`src/lib/kiosk/enroll.ts provisioningPayload`): the admin component
   `il.co.sarcafe.kiosk/.KioskAdminReceiver`, the published APK's address, the SHA-256 of its signing certificate (Android refuses
   any other APK), and the extras `{enroll: <code>, portal: <origin>}`.
3. **On the tablet:** factory reset → on the welcome screen tap 6 times → (Wi-Fi) → scan. Android downloads the kiosk, makes it
   the device owner (kiosk mode locks; updates install silently), and hands it the extras (`ProvisioningModeActivity`,
   `PolicyComplianceActivity`, `KioskAdminReceiver.onProfileProvisioningComplete`).
4. **First start** (`Enrollment.java`): the app trades the code ONCE at `POST /api/kiosk/enroll` — only with a portal on
   `EnrollRules.PORTAL_HOSTS`, no redirects — for the settings the adb setup used to give: menu address, update address, realtime
   address + public key + channel (`menu:<branch>`), the kiosk key, its name, the PIN record. Stored exactly as
   `KioskConfigReceiver` would; the code is forgotten. A used/expired/wrong code: 404 (the app stops trying); offline: tried again
   at the next start.

## Rules
- Owner only (middleware + `requireOwner`), same-origin JSON, 10 installs per owner per hour, fail closed.
- `/api/kiosk/enroll`: public by design (the code is the credential), on `PUBLIC_ROUTES`; 10 tries per address per hour (the
  address is only kept as a keyed fingerprint), claimed atomically before anything is answered, never cached.
- The QR needs an app whose signing-certificate digest is in `public/kiosk-ota/apk/latest.json` (`certSha256`), written by the
  GitHub release (`.github/workflows/kiosk-release.yml`, `apksigner --print-certs`). Before that the wizard says so.
- Tested: `kiosk-api.install-roundtrip|install-rules`, `unit.kiosk-install-rules`, the Java rules (`kiosk-static.java-pin`),
  the wiring (`kiosk-static.java-wiring`), the screen (`kiosk-ui.install-wizard`).

## Limits (said plainly)
- Not tried on a real factory-reset tablet from this session (no tablet here); the first real install is the proof.
- Some tablets' welcome screens need the 6 taps on the very first screen only; a few Android builds have no QR setup at all
  (then: adb, `docs/SARCAFE_KIOSK_OTA.md`).
