# Sarcafe security audit — 2026-10-28

Security agent, one session. Covers the whole repository and a read-only look at production. Code fixes are in the working tree; **nothing is committed, pushed or applied**. The migration `supabase/migrations/20261028190000_security_hardening.sql` is written and tested locally only.

## Scope

- Next.js App Router app (`src/`): middleware, all 78 route handlers under `src/app/api` and `src/app/auth`, server-side page guards, `src/lib`.
- Supabase project `moiunkugxgsgbdokaxbr` (read-only): advisors, RLS and policies, table and function grants, SECURITY DEFINER functions and views, storage buckets and policies, realtime publications, pg_cron jobs, migration ledger.
- Live site `https://sarcafe-portal.vercel.app` (unauthenticated GET only): response headers, exposed paths, PHP probes.
- Dependencies (`npm audit`, full and `--omit=dev`), git history (all branches) and the working tree for secrets.
- Kiosk Android app `prototypes/sarcafe-kiosk-app` (read-only; owned by the kiosk agent).
- `legacy-static-site/`, `public/`, `vercel.json`, `next.config.mjs`.

Not covered: Vercel project settings, env var names, deployment protection and firewall (the Vercel connector returned 403 for the team scope), Supabase Auth settings (not readable via SQL), a full build and live test of the changes, and the real devices.

## The PHP question

Nothing PHP exists in the app or is served. The only `.php` file on disk is `node_modules/flatted/php/flatted.php` (a dev dependency's alternate-language port, never deployed or executed). Vercel answers `403` for `/index.php` and `/wp-login.php`; `/.env`, `/.git/config`, `/config.js` and `/legacy-static-site/config.js` are `404`. `legacy-static-site/` is not under `public/`, so it is not served. A PHP breach does not apply to this stack; the equivalent risks for Node (framework advisories, exposed secrets, server-side request forgery) are covered below.

## Method

1. `git log --all -p` and the working tree scanned for JWTs, `sb_secret_`, private keys, service-role / VAPID / cron secrets, keystore passwords (output redacted; only file + type recorded).
2. `npm audit --json` (prod and full); installed versions of next, react, supabase, zod, web-push.
3. `curl -D -` on the live site for headers and exposed paths.
4. Every route mapped to its guard (`requireOwner`, `requireMenuEditor`, `requirePosStaff`, `resolveStaffIdentity`, cron bearer, kiosk key, token + rate limit); unguarded-looking routes and pages read in full.
5. Supabase advisors (security), `pg_policies` (incl. permissive vs restrictive), `has_table_privilege` / `has_function_privilege` for `anon` and `authenticated` on every public object, view definitions, SECURITY DEFINER bodies, storage, realtime publication, cron job body (secrets redacted).
6. Kiosk `AndroidManifest.xml`, `MainActivity.java`, `build.ps1`.

## Findings

| ID | Severity | Area | Evidence | Status |
|---|---|---|---|---|
| S-01 | High (advisory: Critical) | Dependencies | `next` 15.5.25 installed (`package.json` `^15.1.0`). GHSA-2464-fhr4-w9xw (RCE in Image Optimization with SVG, ≤15.5.27), GHSA-p3m5-59mp-jv5r (Server Actions DoS), GHSA-4jqv-mc3x-m676 / GHSA-mcj8-r9mp-w47p (ISR cache poisoning). Exposure is reduced (no `dangerouslyAllowSVG`, image `remotePatterns` limited to the Supabase host, no server actions, Vercel-hosted) but not removed. | Needs-owner (package.json belongs to the dashboard agent): `npm install next@15.5.28 eslint-config-next@15.5.28` |
| S-02 | Medium | Push / SSRF | `src/app/api/order/subscribe/route.ts` stored any `endpoint` string from an anonymous caller holding an order token; `src/lib/push/send.ts` and `src/lib/push/staff.ts` later POST to it. A crafted endpoint (`http://127.0.0.1:…`, an internal host) made the server send requests where the caller chose. Staff route only required `https://`. | Fixed: `src/lib/push/endpoint.ts` allowlist (https, default port, browser push-service hosts) enforced at subscribe and again before every send |
| S-03 | Medium | Supabase RLS / privacy | `pos_orders` (incl. `customer_name`, `customer_phone`, `note`), `pos_order_items`, `pos_sessions`, `pos_events`… have `SELECT` for `authenticated` with `using (is_staff_client())`: any active staff member with a Google session can read every branch's POS orders over `/rest/v1` and realtime, not only their branch's. | Needs-owner (changes what POS devices receive; must be tested on the tablets). Suggested SQL below |
| S-04 | Medium | XSS impact | No `script-src` CSP; the Supabase session cookie is readable by JavaScript by design of `@supabase/ssr`. Any future XSS becomes session theft. No current XSS sink found (`dangerouslySetInnerHTML` only with constants: `StaffAppIntro.tsx:87`, `theme-transition.ts:90`). | Recommended: nonce-based CSP from middleware, rolled out as `Content-Security-Policy-Report-Only` first |
| S-05 | Medium | Kiosk app | `AndroidManifest.xml`: `MainActivity` and `HomeAlias` are `exported="true"`; `MainActivity.applyIntentConfig()` (lines 140–187) accepts `url`, `pin`, `debug`, `key`, `api`, `rt` extras from any sender. Any app on the tablet can reset the staff PIN, turn on WebView remote debugging, or point the kiosk at its own https page, which then reads the sign-up key through `SarcafeKiosk.config()`. | Kiosk agent (fix below) |
| S-06 | Low | Supabase functions | `log_shift_audit(uuid,text,text,jsonb)` is SECURITY DEFINER and executable by `authenticated`; no app code calls it. Any Google account that signs in (sign-up is open for invitations) can add forged rows to `shift_audit`. | Fixed in migration (Needs-migration-apply) |
| S-07 | Low | Supabase functions | Advisor `anon_security_definer_function_executable`: `rls_auto_enable()`; also `publish_menu`, `set_default_variant`, `reap_expired_variants` (invoker), and trigger functions `branches_parent_guard`, `pos_sync_employee_code` executable by `anon`. | Fixed in migration (Needs-migration-apply) |
| S-08 | Low | Supabase functions | Advisor `function_search_path_mutable`: `sched_lock_staff`, `sched_lock_staff_many`, `sched_range`, `sched_range_text`, `sched_fmt`, `sched_fail`, `sched_needed`. | Fixed in migration (Needs-migration-apply) |
| S-09 | Low | CSRF | `apiRoute` has no Origin check; ~20 owner/staff routes read `request.json()` without `parseBody()`'s `assertSameOrigin` (e.g. `owner/staff/route.ts`, `owner/settings/route.ts`, `owner/menu/route.ts`, `shifts/dispatch/route.ts`). Mitigated by SameSite=Lax cookies. | Fixed: `src/middleware.ts` refuses any `/api/*` write whose `Origin` is another host (kiosk and public feedback routes exempt) |
| S-10 | Low | HTTP headers | Live: `X-Powered-By: Next.js`, no `Permissions-Policy`, CSP only `frame-ancestors`. | Fixed in `next.config.mjs`: `poweredByHeader: false`, Permissions-Policy, `base-uri 'self'; object-src 'none'` |
| S-11 | Low | Cron | `src/app/api/cron/*/route.ts` compared `Authorization` with `!==` (not constant time). | Fixed: `src/lib/http/cron.ts` `bearerMatches()` |
| S-12 | Low | Error leakage | `src/app/api/auth/signout/route.ts:33` returned the auth server's `error.message`. | Fixed: generic message, name logged |
| S-13 | Low | Privacy | `src/app/api/kiosk/waitlist/route.ts` answers `409 already_registered`: whoever holds the kiosk key (it lives on the tablet) can test whether a phone number is on the list. | Needs-owner (product choice; alternative: always answer `200` and let the kiosk say "you're on the list") |
| S-14 | Low | Kiosk app | Staff PIN stored as unsalted `SHA-256("sarcafe-kiosk:"+pin)` of 4–8 digits (`MainActivity.java:230`), compared with `String.equals`, no attempt limit at the PIN dialog. | Kiosk agent |
| S-15 | Low | Kiosk build | `build.ps1:69,72` signs with keystore/key password `android` hard-coded. Whoever copies the keystore file can sign an update. | Kiosk agent / owner |
| S-16 | Low | Kiosk app | `addJavascriptInterface(…, "SarcafeKiosk")` exposes `config()` (incl. `signupKey`) to every frame of every page loaded, including iframes from any origin. | Kiosk agent |
| S-17 | Low | Realtime | Public broadcast channels `menu:<slug>`, `orders:<slug>`, `order-status:<orderId>` (no `realtime.messages` policies): anyone with the public key can listen to or send these payload-less nudges (activity timing; forced refetches). `menu:<slug>` is intended. | Recommended: private channels + `realtime.messages` policies for `orders:*` |
| S-18 | Low | Dependencies | `zod` 3.25.76 (GHSA-mrhx-c7xc-m3w5, fixed only in v4; mitigated by body-size caps), transitive `postcss`, `sharp`, `source-map-js`, `brace-expansion`, `postcss-selector-parser`. | Needs-owner: `npm audit fix` (no `--force`); zod 4 is a separate migration |
| S-19 | Low | Input limits | Body caps in `api/order/*` and `api/feedback` trust `Content-Length`; a chunked body skips the cap (Vercel's 4.5 MB limit still applies). `parseBody()` and `readLimitedText()` do it right. | Recommended (feedback route: dashboard agent) |
| S-20 | Info | Supabase Auth | Advisor: leaked-password protection disabled. The app signs in with Google and PIN only. | Needs-owner: disable the Email provider if unused, or enable the protection |
| S-21 | Info | Supabase views | SECURITY DEFINER (`security_invoker=false`) views `public_menus`, `public_menu_variants`, `published_schedule`, `pos_staff_directory`: reviewed; they are deliberate projections (published menu only; schedule gated by `can_view_schedule`; directory gated by `is_staff_client`, 3 columns). | Accepted |
| S-22 | Info | Secrets | Git history (`821d411`, `config.js`) and `legacy-static-site/config.js` contain the **anon** key of the retired project `gdoxoetrrfnensbahclc` (role decoded: `anon`). No service-role key, VAPID private key, cron secret or private key found anywhere in history or the tree; `.env.local` is untracked and ignored. | Needs-owner: pause or delete the retired Supabase project |
| S-23 | Info | PHP | See "The PHP question". | n/a |
| S-24 | Info | Middleware | The matcher skips paths ending in `.png/.svg/…`, so `/owner/staff/x.png` bypasses the middleware gate. Every protected page re-checks server-side (verified, including the seven pages that delegate to a `*PageBody` component). | Accepted; keep page-level guards |
| S-25 | Info | Vercel | Deployment protection, env var names, firewall: not verified (connector 403 for team `godunix`). | Needs-owner |
| S-26 | Info | Headers | `Access-Control-Allow-Origin: *` on static 404 responses (Vercel default for static files); `/api/kiosk/menu` CORS `*` is intended (read-only public projection). | Accepted |
| S-27 | Medium | Kiosk OTA (added during the audit by the kiosk agent) | `OtaRules.java:30`: manifest signing is opt-in; with no public key configured the kiosk accepts any well-formed manifest from the pinned host and runs the downloaded web bundle (which can call the JS bridge). APK updates are protected by Android's same-signer rule, so their safety is the signing keystore's (S-15). | Kiosk agent / owner: ship with the ECDSA public key set and the private key kept offline |

Counts: Critical 0, High 1, Medium 5, Low 14, Info 7.

### Verified as good (no change needed)

- Every `/api/owner/*` route calls `requireOwner` / `requireMenuEditor` / `requirePosManager` server-side; `/api/pos/*` call `requirePosStaff*` with rate limits; staff routes resolve identity from the session, never from the body.
- PIN login (`api/auth/quick-login`): strict schema, four fail-closed rate limits (per employee 15 min / day, per IP, per pair) keyed by HMAC, one generic answer, bcrypt in `pos_verify_pin`, no Auth JWT issued, opaque 256-bit session token stored as SHA-256, HttpOnly/Secure/SameSite=Lax, revoked on logout and PIN rotation.
- Invitation, Google-link, board and order tokens: 256-bit / 160-bit `randomBytes`, stored hashed; `next` redirects pass `safeNext()` / `safePosReturn()`.
- RLS on all 49 public tables; `anon` reads only `app_settings` (public rows), `branches`, and the two public menu views. The 12 `full_browser_session` policies are RESTRICTIVE (correct). Storage: one private bucket (`staff-payslips`, 4 MB, PDF/PNG/JPEG) with a restrictive deny for browser roles; uploads magic-byte checked.
- No overloaded functions; `internal_*` not executable by any API role; pg_cron job reads its secret from Vault.
- CSV exports neutralise `= + - @ \t \r`; error envelope never returns stack traces; kiosk key compared in constant time; no committed secrets.

## What was fixed (files)

- `src/lib/push/endpoint.ts` (new), `src/lib/push/send.ts`, `src/lib/push/staff.ts`, `src/app/api/order/subscribe/route.ts`, `src/app/api/staff/push/route.ts` — S-02.
- `src/middleware.ts` — S-09.
- `next.config.mjs` — S-10.
- `src/lib/http/cron.ts` (new), `src/app/api/cron/{cleanup-feedback,cleanup-pos,keep-alive,staff-push}/route.ts` — S-11.
- `src/app/api/auth/signout/route.ts` — S-12.
- `supabase/migrations/20261028190000_security_hardening.sql` (new, NOT applied) — S-06, S-07, S-08.
- `scripts/check-security.mjs` (new) — database + code regression check. Needs `"check:security": "node scripts/check-security.mjs"` in `package.json` (dashboard agent owns it).
- `scripts/check-staff-push.mjs` — two static assertions updated to the new helpers.

### The migration

Privileges and settings only, guarded by `to_regprocedure` so it is idempotent and safe if a function is missing:
- `log_shift_audit`: revoke from public/anon/authenticated, grant service_role.
- `rls_auto_enable`, `branches_parent_guard`, `pos_sync_employee_code`: revoke from public/anon/authenticated (event triggers and triggers do not need EXECUTE to fire).
- `publish_menu`: revoke from public/anon, grant authenticated + service_role (the owner's session still calls it).
- `set_default_variant`, `reap_expired_variants`: revoke from public/anon/authenticated, grant service_role (server-only callers).
- Seven `sched_*` helpers: `set search_path = public, pg_temp`.

Before applying: `npm run verify:schedule-sql`, `verify:checklist-sql`, `verify:onboarding-sql`, `node scripts/check-security.mjs`; ledger row version `20261028190000`, name `security_hardening`.

## Fixes for files owned by other agents

**Dashboard agent (package.json, feedback route):**
1. `npm install next@15.5.28 eslint-config-next@15.5.28` then `npm audit fix` (no `--force`); re-run typecheck and checks.
2. Add `"check:security": "node scripts/check-security.mjs"` to `scripts`.
3. `src/app/api/feedback/route.ts:84`: replace `request.json()` with `readLimitedText(request, <cap>)` from `@/lib/kiosk/waitlist` + `JSON.parse`, so a chunked body cannot skip the size cap.

**Kiosk agent (`prototypes/sarcafe-kiosk-app`):**
1. S-05: stop reading config extras in `MainActivity` (`onCreate`/`onNewIntent` → no `applyIntentConfig`). Move `applyIntentConfig` into a new `ConfigReceiver` declared `android:exported="true" android:permission="android.permission.DUMP"` (adb's shell holds DUMP; third-party apps cannot). Provisioning becomes `adb shell am broadcast -n il.co.sarcafe.kiosk/.ConfigReceiver --es pin … --es key …`.
2. S-14: require 6–8 digits; store `PBKDF2WithHmacSHA256` (random 16-byte salt, ≥100k iterations) instead of plain SHA-256; compare with `MessageDigest.isEqual`; after 5 wrong PINs lock the dialog for 5 minutes, doubling each time.
3. S-16: register the bridge only when the asset page is loaded, or answer `config()` with `signupKey` only for `file:///android_asset/`; block sub-frame and sub-resource loads to hosts other than the API/realtime hosts with `shouldInterceptRequest`.
4. S-15: read the keystore and key passwords from an environment variable (e.g. `SARCAFE_KEYSTORE_PASS`) instead of the hard-coded value; keep the keystore out of synced folders and back it up offline. Now that the app installs its own APK updates, this keystore is the only thing standing between an attacker and a silent update.
5. S-27: make the OTA manifest signature mandatory (refuse unsigned manifests when no key is configured), bake the P-256 public key into the APK, keep the private key offline, sign in the release script.

## Items for the owner

1. Apply `20261028190000_security_hardening.sql` (SQL editor or `apply_migration`), then record the ledger row.
2. Upgrade Next.js (S-01) — or ask the dashboard agent to.
3. S-03 decision. Suggested change, test on the POS tablets first (an event worker from another branch would stop seeing those orders):
   ```sql
   drop policy if exists pos_orders_staff_select on public.pos_orders;
   create policy pos_orders_staff_select on public.pos_orders for select to authenticated using (public.can_work_orders(branch_id));
   ```
   and the same pattern for `pos_order_items` (via its order) and the other `pos_*` tables with a `branch_id`.
4. Supabase dashboard: disable the Email provider if unused (or enable leaked-password protection); confirm Point-in-Time Recovery / daily backups on the plan; pause/delete the retired project `gdoxoetrrfnensbahclc`.
5. Vercel dashboard (not verified here): Deployment Protection "Standard" for previews; confirm `CRON_SECRET`, `KIOSK_SIGNUP_KEY`, `RATE_LIMIT_KEY_SECRET`, `VAPID_PRIVATE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are Production/Preview only and marked Sensitive; turn on the Firewall's bot protection; consider an alert on 5xx / error spikes.
6. No key rotation is required by this audit (no secret was found exposed). Rotate if the kiosk tablet is lost (`KIOSK_SIGNUP_KEY`).
7. S-13 product decision (hide "already registered").
8. S-04 / S-17: schedule a CSP (nonce) rollout and private realtime channels as their own tested changes.

## Verification

- `node scripts/check-security.mjs`: 51 passed (all migrations apply in order on PGlite, the security migration applies twice, grants and helpers behave).
- `npx tsc --noEmit`: no errors in files touched by this audit; the remaining errors are in the dashboard agent's in-progress files (`src/components/kiosk-admin/KioskContentEditor.tsx`, `src/components/kiosk-feedback/PollForm.tsx`, `src/lib/kiosk/content-project.ts`).
- Passing: `check:staff-access` (109), `check:pos-access` (37), `check:notifications-gate` (47), `check:staff-push` (118), `verify:onboarding-sql` (49), `verify:schedule-sql` (423), `verify:checklist-sql` (52), `verify:waitlist-sql` (54), and every other `check:*` except below.
- Not caused by this audit: `check:kiosk-waitlist` (missing `prototypes/sarcafe-kiosk-app/overrides/kiosk-idle.js`, kiosk agent's rename), `check:a11y-scope` (new `/feedback` route unclassified, dashboard agent), `check:app-layout` (Playwright browser not installed).
- Not verified: a production build, the headers and the cross-site guard on a running server, push delivery after the allowlist (existing production subscriptions are all on `fcm.googleapis.com` and `web.push.apple.com`, both allowed).
