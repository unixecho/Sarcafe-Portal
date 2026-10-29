# Kiosk over-the-air updates

Served at `/kiosk-ota/` and read by the Sarcafe kiosk tablet. See `docs/SARCAFE_KIOSK_OTA.md`.

- `web/` is GENERATED at build time by `scripts/publish-kiosk-ota.mjs` (git-ignored). Do not edit.
- `web-signature.json` is written by `node scripts/sign-kiosk-ota.mjs` on the owner's PC and committed. The tablet
  applies a web bundle only when this signature matches it.
- `apk/latest.json` + `apk/sarcafe-kiosk-<versionCode>.apk` are written by
  `node scripts/publish-kiosk-ota.mjs apk` after a local `build.ps1`, and committed.
