# Sarcafe kiosk: over-the-air updates

The kiosk tablet updates itself over Wi-Fi. A change to the kiosk page reaches it after a push to `main` and one
local sign command. A change to the Android app itself reaches it after a local build and a commit. After the one
manual install described below, nobody needs the USB cable again for updates.

Code: `prototypes/sarcafe-kiosk-app/src/il/co/sarcafe/kiosk/` (`OtaUpdater`, `OtaRules`, `OtaReceiver`,
`KioskConfigReceiver`, `StaffPin`), `scripts/publish-kiosk-ota.mjs`, `scripts/sign-kiosk-ota.mjs`,
`scripts/check-kiosk-ota.mjs`.

## How it works

### The kiosk page (the normal path, no reinstall)

1. **On every Vercel build** (`prebuild`), `scripts/publish-kiosk-ota.mjs` runs `scripts/assemble-kiosk-bundle.mjs`.
   This is the same assembly `build.ps1` packs into the APK. The publisher turns CRLF into LF in text files, hashes
   every file, and writes:
   - `public/kiosk-ota/web/<version>/<files>` (flat names only)
   - `public/kiosk-ota/web/manifest.json`, with this shape:
     `{ schema, version, seq, createdFrom, minNativeVersion, totalBytes, files: [{ path, sha256, size }], signature? }`

   `version` is the first 16 hex characters of SHA-256 over every `path\nsha256\nsize\n`, sorted by path. The same
   sources always give the same version, on Windows and on Vercel alike. Only the current version is kept. The
   publisher **never fails the portal build**: if anything is wrong (no prototype folder, a sub-folder, an unsafe
   name, more than 15 MB, no `KioskNative.ready()` call), it prints a warning and publishes no web folder. The
   kiosks then keep what they run.
2. **Signature.** If `public/kiosk-ota/web-signature.json` (committed) names the same version, the publisher copies
   its `seq` and `signature` into the manifest. If it names a different version, the manifest is published unsigned,
   and the kiosks ignore it.
3. **On the tablet**, `OtaUpdater` checks the manifest:
   - 20 s after start, then every 10 minutes while the screen is on, and when the network comes back (at most once a
     minute).
   - It uses `If-None-Match`, so an unchanged manifest costs one small request.
   - After errors it backs off to 20, 40, 80 minutes, up to 2 hours.
   - It never checks while the screen is off.
4. **It accepts a manifest only when all of these hold:**
   - It comes over HTTPS from the pinned host. Redirects are refused.
   - It is at most 64 KB and well formed.
   - Every name is flat and safe.
   - The bundle has at most 200 files, 8 MB per file and 15 MB in total, and it includes `index.html`.
   - The version it states matches the version the tablet recomputes from the file list.
   - **The ECDSA P-256 signature over `version + seq + minNativeVersion` verifies against the public key compiled
     into the APK.**
   - `seq` is higher than any the tablet has taken before (no replay of an old signed manifest).
   - The version is not one that failed before.
   - `minNativeVersion` is not above the installed app's version code.
5. **Download.** Files the tablet already has (in the active or previous bundle, or in the APK) are copied, and only
   changed files are downloaded. Downloads go to `files/ota/web/<version>.part/` on a background thread with 16 KB
   buffers. The tablet checks free space first and never reads past a file's declared size. Each file must match its
   size and SHA-256 exactly. The finished folder is then renamed into place and marked *staged*.
6. **Switch.** Every 15 s the tablet asks the page `KioskSession.state`. Only on `ATTRACT` or `CLEAN` (no customer
   mid-visit, staff not unlocked) does it move the pointer (SharedPreferences, written with `commit()`) and reload.
   A cold start always switches a staged bundle in before the first page load.
7. **Trial and rollback.** The new page must call `KioskNative.ready(...)` within 20 s of loading. The tablet rolls
   back to the previous bundle, or to the one inside the APK, and never takes that version again, if:
   - the page does not call it in time,
   - the WebView renderer crashes, or
   - the app process restarts twice during the trial.

   The previous bundle is kept for rollback. Older ones are deleted.
8. **Serving.** The page is served from the virtual origin `https://kiosk.sarcafe.invalid/` through
   `shouldInterceptRequest`. It comes from the active downloaded bundle, or from the APK's assets when none is
   active. A downloaded bundle never mixes in files from the APK. `file://` access is now **off**. Navigation is still
   allowlisted: only the virtual origin, plus the host of an `url` setting if one is set.

### The Android app itself (rare)

- The owner runs `build.ps1` with a higher version code, then `node scripts/publish-kiosk-ota.mjs apk`. That copies
  the APK to `public/kiosk-ota/apk/sarcafe-kiosk-<code>.apk` and writes `public/kiosk-ota/apk/latest.json` as
  `{ versionCode, versionName, url, sha256, size }`. The owner commits both and pushes.
- The tablet checks `latest.json` together with the manifest. When the version code is higher, it does this:
  1. Downloads the APK to its cache, refusing anything over 30 MB.
  2. Checks the size and SHA-256, and checks that the package name and version code inside the APK match.
  3. Waits for an idle moment.
  4. Installs silently through a `PackageInstaller` session. A device owner may do that.
- Android refuses an APK from any other signer, and the keystore never leaves the owner's PC.
- `OtaReceiver` gets `MY_PACKAGE_REPLACED` and starts the kiosk again. `MainActivity` then puts lock-task, the home
  role and the policies back. Device owner, the lock-task package list, the persistent home activity and the alias
  state all survive an app update.
- If an install fails 3 times, that version code is skipped until a higher one appears.

### What staff and the owner see

- Staff menu (5 taps in the top-left corner, then the PIN):
  - An **"Updates: page …, app …, checked …"** line. Tapping it shows details: the active, previous and staged
    bundle, the app version, the last check and its result, and the update server. The details have
    **Check now** and **Undo page update** buttons.
  - A **"Check for updates now"** item.
- On the tablet's logcat, under the tag `SarcafeOta`: `status {...}` (versions, last result). It never contains
  customer data.
- From the PC: `node scripts/sign-kiosk-ota.mjs status` compares the live manifest with your checkout. It shows
  whether the live manifest is signed and whether the version is the same.

## Security model (read this)

| Who controls… | …can they change what the kiosk shows? |
|---|---|
| GitHub or Vercel account only | **No.** They can publish files, but without the private key the kiosk ignores them. The worst they can do is delete the manifest, and then the kiosk keeps what it runs. They can still change the portal's API answers (menu, sign-up), as before. |
| The OTA private key only (`C:\Users\Johnathan\android-tools\sarcafe-kiosk-ota.pem`) | Only if they can also publish to the portal. |
| The APK keystore only | Only if they can also publish to the portal. Android checks the signer. |
| adb with the cable | Everything, as before. |

- **The trust roots are the OTA signing key and the APK keystore.** Both live only on the owner's PC, outside the
  repo, and never on GitHub or Vercel. Back both up offline. If the OTA key is lost, a new APK with a new public key
  must be installed. If the keystore is lost, the app must be uninstalled and set up again over adb.
- `latest.json` is not signed. It does not need to be: the tablet installs only a higher version code, and only an
  APK that Android accepts as signed by the same keystore.
- HTTPS only. The host is pinned to the `ota` setting, or else to the host of the `api` setting
  (`https://sarcafe-portal.vercel.app/kiosk-ota/`). No redirects are followed, and file names cannot leave the
  bundle folder.
- Still keep 2FA on GitHub and Vercel: they control the portal itself.
- **Trade-off chosen:** auto-publish on push is safe because the files cannot run unsigned. The one manual step is
  `node scripts/sign-kiosk-ota.mjs` on the owner's PC. If you skip it, nothing breaks: the kiosk keeps the last
  signed page.

### Configuration is adb-only (S-05)

`MainActivity` ignores every launch extra. Configuration goes to a receiver that needs `android.permission.DUMP`.
The adb shell holds that permission and no installed app does.

```
adb shell am broadcast -n il.co.sarcafe.kiosk/.KioskConfigReceiver --es pin <6-8 digits>
adb shell am broadcast -n il.co.sarcafe.kiosk/.KioskConfigReceiver --es api https://sarcafe-portal.vercel.app/api/kiosk/menu --es rt https://<project>.supabase.co --es rt_key <anon key>
adb shell am broadcast -n il.co.sarcafe.kiosk/.KioskConfigReceiver --es key <sign-up key>
adb shell am broadcast -n il.co.sarcafe.kiosk/.KioskConfigReceiver --es orient portrait|landscape|auto
adb shell am broadcast -n il.co.sarcafe.kiosk/.KioskConfigReceiver --es perf auto|lite|full
adb shell am broadcast -n il.co.sarcafe.kiosk/.KioskConfigReceiver --es debug on|off
adb shell am broadcast -n il.co.sarcafe.kiosk/.KioskConfigReceiver --es url https://...   (or: --es url asset)
adb shell am broadcast -n il.co.sarcafe.kiosk/.KioskConfigReceiver --es ota https://host/kiosk-ota/   (optional; empty removes)
adb shell am broadcast -n il.co.sarcafe.kiosk/.KioskConfigReceiver --es ota_check now
```

The old `adb shell am start ... --es pin ...` form no longer changes anything. Settings already stored (`api`, `rt`,
`rt_key`, the sign-up key, orientation, speed) survive the update.

- **PIN (S-14):** stored as PBKDF2-HMAC-SHA1 with 15,000 iterations and a random 16-byte salt, and compared in
  constant time. A new PIN must be 6–8 digits. The PIN stored before this change is accepted once and moved to the
  new format on its first correct entry. After 5 wrong tries the dialog locks for 30 s, then 1, 2, 4 minutes and so
  on, up to 1 hour. The lock survives a restart.
- **`SarcafeKiosk.config()` (S-16):** it carries the sign-up key, so it answers only while the top-level page is the
  kiosk's own (`https://kiosk.sarcafe.invalid/`). Any other page gets `{}`, and so does a hosted `url`.
  `KioskNative.ready()` is ignored from other pages too. On Android 7–11 a JS interface cannot tell which frame
  called it, so the kiosk page must not embed other sites in iframes.

## Owner: one-time setup

1. **Make the signing key** (once, on the PC):
   `node scripts/sign-kiosk-ota.mjs keygen`. This writes `C:\Users\Johnathan\android-tools\sarcafe-kiosk-ota.pem`
   (keep it there, back it up offline, and never commit or upload it) and prints a public key. Paste that public key
   into `OtaRules.PUBLIC_KEY_B64`. Until that is done the app takes **no** page updates (fail closed).
2. **Lead/agents:** add `"prebuild": "node scripts/publish-kiosk-ota.mjs"` to `package.json`. Make `build.ps1` take
   `-VersionCode` and `-VersionName` (it is hard-coded to 1 / 0.1 today). The first OTA-capable APK must be
   **versionCode 2** (`MIN_NATIVE_VERSION` in the publisher).
3. **Commit `prototypes/sarcafe-kiosk/`.** It is untracked today, so Vercel cannot assemble the bundle. Until then the
   build only warns and no page update is published.
4. **Build and install this APK once over adb.** This is the last manual install:
   `build.ps1` (versionCode 2), then `adb install -r C:\Users\Johnathan\android-tools\kiosk-build\sarcafe-kiosk.apk`.
   - It keeps its stored settings and its device-owner role (same package, same keystore).
   - Its page now runs on a new origin, so the page's local storage starts empty once: the cached menu and
     announcements are fetched again, and the speed test runs again.
   - Then set a new 6–8 digit staff PIN with the `am broadcast` form above. The old PIN still works once.
5. **Sign and push:** `node scripts/sign-kiosk-ota.mjs`, commit `public/kiosk-ota/web-signature.json`, then push.

## Shipping a page change

1. Change the files under `prototypes/sarcafe-kiosk/` or `prototypes/sarcafe-kiosk-app/overrides/`. Commit the
   change.
2. Run `node scripts/sign-kiosk-ota.mjs`. It builds the bundle exactly as Vercel will, signs it, and writes
   `public/kiosk-ota/web-signature.json`. It warns if the bundle's inputs have uncommitted changes.
3. Commit `public/kiosk-ota/web-signature.json` and push to `main`.
4. Within about 10 minutes of the deploy, the kiosk downloads the bundle and switches when nobody is using it.
   `node scripts/sign-kiosk-ota.mjs status` shows `SIGNED` and `(same as live)`.

If you push without signing, the kiosk ignores that page and keeps the last signed one. Sign and push again.

## Shipping an app (native) change

1. Raise the version code in `build.ps1`, then run `build.ps1`. The keystore stays on the PC.
2. Run `node scripts/publish-kiosk-ota.mjs apk`. It reads the version with `aapt2` and refuses a version code that is
   not higher than the current one.
3. Commit `public/kiosk-ota/apk/` and push. The tablet installs it at an idle moment and restarts the kiosk.

A bundle that needs the new native code: raise `MIN_NATIVE_VERSION` in `scripts/publish-kiosk-ota.mjs`. The kiosk
waits for the APK, then takes the page.

## Rollback

- **Automatic:** a page that does not start, crashes, or restarts the app twice is rolled back and never taken again.
- **By staff:** Staff menu → Updates → **Undo page update**. The previous bundle comes back, or the one inside the
  APK, and the undone version is not taken again.
- **By the owner:** revert the change in git, run `node scripts/sign-kiosk-ota.mjs` (a new `seq`, so the tablet
  accepts it although the content is old), commit, and push. A Vercel "instant rollback" alone is **not** taken by
  the tablet, because that older manifest carries a lower `seq`. This is deliberate: it is what stops replays.
- **Native:** publish a higher version code built from the older source.

## Checks

`node scripts/check-kiosk-ota.mjs` (94 checks; needs a JDK for the Java part). It covers:

- the real bundle published twice gives byte-identical output;
- manifest shape, and hashes and sizes on disk;
- path safety and the size and count caps;
- broken bundles are refused without failing the build;
- the sign → publish → verify round trip;
- the APK channel;
- the app's own `OtaRules` / `StaffPin` compiled with `javac --release 8`: Java computes the same version as Node,
  verifies the Node signature, and agrees on the name rules, plus PIN hashing, migration and lockout.

Set `KIOSK_OTA_TEST_APK=<apk>` to also test `publish apk` with `aapt2`.

## Verified only on the real tablet (not yet done)

- Page served from the virtual origin on WebView 97: fonts, images, local storage, the Realtime socket, sign-up
  CORS from the new origin.
- A real update applied at an idle moment, `KioskNative.ready` confirming it, and an induced rollback.
- Silent `PackageInstaller` install as device owner, `MY_PACKAGE_REPLACED` relaunch, lock-task and home restored.
- The `am broadcast` configuration, the PIN migration and the lockout.
- The network callback after Wi-Fi drops, and no checks while the screen is off.
