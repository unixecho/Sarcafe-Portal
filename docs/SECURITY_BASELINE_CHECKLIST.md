# Security baseline checklist (Next.js + Supabase + Vercel + PWA / kiosk)

Project-agnostic. Written from the Sarcafe audit of 2026-10-28 for reuse in Ayeka Bar and new projects. Work top to bottom: each level assumes the one before it. Every item is a yes/no question with how to check it.

## 1. Secrets

- [ ] `.gitignore` covers `.env*` (except `.env.example`), `*.pem`, `*.keystore`/`*.jks`, `.vercel`, local Supabase folders. Check: `git ls-files | grep -iE '\.env|\.pem|keystore|jks'` returns only `.env.example`.
- [ ] No secret in history. Check: `git log --all -p | grep -nE 'sb_secret_|BEGIN .*PRIVATE KEY|service_role|eyJhbGciOi'` and decode any JWT's payload `role` (anon keys are public; `service_role` means rotate now).
- [ ] Only public values are `NEXT_PUBLIC_*` (Supabase URL, anon/publishable key, VAPID public key, site URL). Service-role key, VAPID private key, cron secret, HMAC keys, kiosk keys are server-only.
- [ ] The service-role client lives in one server module and is never imported by a `'use client'` file.
- [ ] Build scripts (APK signing, deploy) read passwords from environment variables, never literals; signing keystores are backed up offline and kept out of synced folders.
- [ ] Database jobs that call back into the app read their secret from Supabase Vault, not from the job text.
- [ ] Retired projects (old Supabase projects, preview domains) are paused or deleted so leaked old keys lead nowhere.

## 2. Dependencies

- [ ] `npm audit --omit=dev` is clean of High/Critical, or each one is written down with why it does not apply.
- [ ] Next.js is on the latest patch of its line (middleware-bypass, image-optimizer, RSC/server-action advisories land here first). Check: `npm view next@<major> version`.
- [ ] The lockfile is committed; installs use `npm ci`; no git/tarball dependency without a pinned tag.
- [ ] No package with an unexpected `postinstall` (check `npm ls --json` + package scripts when adding a dependency).
- [ ] Schema validation (zod) only ever sees bodies already capped by size.

## 3. HTTP hardening (check the live response, not just the config)

- [ ] `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
- [ ] `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (or `no-referrer` on private responses).
- [ ] Framing: `X-Frame-Options: DENY` + `frame-ancestors 'none'`; one documented exception per route that must be framed by itself (`'self'`).
- [ ] CSP has at least `base-uri 'self'; object-src 'none'`; target state is a nonce-based `script-src` (roll out with `-Report-Only` first). Never put `object-src 'none'` on a PDF response (it breaks the browser's PDF viewer).
- [ ] `Permissions-Policy` switches off unused features (camera only if a scanner uses it, `=(self)`).
- [ ] `poweredByHeader: false`; production source maps not public.
- [ ] Private responses (anything per-user) carry `Cache-Control: private, no-store`; only truly public pages are CDN-cached.
- [ ] `curl -D - https://<site>/.env /.git/config /index.php` all 403/404.

## 4. Authentication and authorization

- [ ] Middleware gates page prefixes coarsely; **every** page and route handler re-checks the session and the role server-side (middleware matchers skip static extensions and are not a security boundary on their own).
- [ ] Every API route resolves identity from the session, never from the body or query; every id from the client is checked against the caller's scope (branch, owner, self) before use.
- [ ] Owner-only, manager, staff and developer levels are separate checks; developer tools are gated server-side, not hidden in the UI.
- [ ] PIN / passcode logins: strict schema, rate limits before verification (per account, per IP, per pair, per day) that fail **closed**, one generic error, constant work on every failure path, slow hash (bcrypt/argon2) at rest, weak-PIN list.
- [ ] Session tokens: ≥128-bit random, stored hashed, HttpOnly + Secure + SameSite=Lax, server-side revocation on logout and on credential change, expiry.
- [ ] Invitation / link / board / order tokens: ≥128-bit random, stored hashed, expiring, single-use where it makes sense.
- [ ] OAuth callback: PKCE, `next`/`redirect` parameters accept only same-origin paths (`/` but not `//`, no `\`, no scheme, no control chars).
- [ ] CSRF: SameSite=Lax cookies **and** a same-origin `Origin` check on every non-GET `/api/*` (exempt only routes that are called cross-origin on purpose and carry their own credential).
- [ ] No state change on GET.

## 5. Supabase

- [ ] RLS enabled on every table in exposed schemas; new tables get RLS by default (event trigger) and `revoke all from anon, authenticated` unless a policy is deliberate.
- [ ] No `using (true)` for `authenticated`/`anon` except deliberate public data; policies that mean "and also" are RESTRICTIVE.
- [ ] Policies scope to the caller's branch/tenant, not just "is staff" (customer PII especially).
- [ ] Every function: `revoke all from public, anon, authenticated` then `grant execute to service_role` (or the one browser role that needs it). `internal_*` callable by nobody. No overloads (PostgREST PGRST203).
- [ ] Every SECURITY DEFINER function has `set search_path`; helpers too (advisor `function_search_path_mutable`).
- [ ] SECURITY DEFINER views expose only columns meant for their audience; prefer `security_invoker = true` where RLS can do the job.
- [ ] Storage: private buckets for anything personal (payslips, IDs), size and MIME limits on the bucket, server-side magic-byte check, signed or proxied reads.
- [ ] Realtime: only intentionally public topics are public broadcast channels; anything per-user/per-branch is a private channel with `realtime.messages` policies; `postgres_changes` tables have RLS that matches who should see each row.
- [ ] `get_advisors` (security + performance) reviewed after every migration.
- [ ] Auth: unused providers disabled; leaked-password protection on if email/password exists; sign-up open only if invitations require it (then nothing is reachable for a signed-in non-member).
- [ ] Backups: Point-in-Time Recovery or daily backups confirmed, and one restore rehearsed.

## 6. Input handling

- [ ] Every body: content-type check, size cap that does not trust `Content-Length` alone (read with a streaming limit), strict schema (`.strict()`), errors return field paths only, never received values.
- [ ] No SQL string building; RPC parameters only.
- [ ] No `dangerouslySetInnerHTML` / `innerHTML` with user data; markdown rendered with a sanitizer.
- [ ] Uploads: size limit, magic-byte type detection, server-chosen object path (never the client's file name), served with the detected type and `nosniff`.
- [ ] Any server-side fetch of a user-supplied URL is allowlisted by scheme, host and port. **Web Push endpoints count**: accept only the browser push services (`*.googleapis.com`, `*.push.apple.com`, `*.mozilla.com`, `*.notify.windows.com`), https, default port, checked at subscribe time and again before sending.
- [ ] `next/image` remote patterns list exact hosts; `dangerouslyAllowSVG` off.
- [ ] CSV/XLSX exports prefix cells starting with `= + - @ \t \r` with `'`.
- [ ] Logs never contain bodies, phone numbers, emails, PINs, tokens; error responses never contain library error text.

## 7. Public endpoints

- [ ] Every anonymous write has a rate limit (per IP via `x-vercel-forwarded-for`, plus a global ceiling), a honeypot, and a generic answer.
- [ ] CORS `*` only on read-only public data; credentialed endpoints never `*`.
- [ ] Shared device keys (kiosk) compared in constant time, never logged, rotatable, and the endpoint inert when the key is unset.
- [ ] Responses do not reveal membership (no "already registered" / "no such user") unless the product truly needs it.
- [ ] Cron routes require `Authorization: Bearer $CRON_SECRET`, compared in constant time, and refuse when the secret is unset.
- [ ] Webhooks verify signatures before parsing.

## 8. PWA and kiosk (Android WebView)

- [ ] Service worker scope is minimal; it never caches authenticated API responses; notification click URLs are same-origin paths only.
- [ ] WebView: `allowFileAccessFromFileURLs` and `allowUniversalAccessFromFileURLs` false, `allowContentAccess` false, mixed content never, `usesCleartextTraffic=false`, `allowBackup=false`, remote debugging off in production.
- [ ] Navigation restricted to an allowlist of hosts (`shouldOverrideUrlLoading`) and sub-resources too (`shouldInterceptRequest`).
- [ ] JavaScript bridges expose nothing secret, or only to the bundled asset origin (`WebViewCompat.addWebMessageListener` with origin rules).
- [ ] Exported activities do not accept configuration from intent extras; provisioning goes through a component protected by a permission only adb's shell holds (`android.permission.DUMP`).
- [ ] Staff exit PIN: ≥6 digits, salted slow hash, constant-time compare, lockout with backoff; every exit path re-locks after a timeout.
- [ ] Device owner / lock-task: settings access is time-boxed; the app restores lock task on resume.

## 9. Privacy

- [ ] An inventory of personal data (staff: names, phones, emails, payslips; customers: names, phones, emails, feedback) with who can read each.
- [ ] Retention: scheduled purge jobs for each (orders' customer phone, feedback, sign-up attempts, rate-limit rows), and an erase path per person.
- [ ] Consent recorded with version and timestamp for marketing; notice versions enforced server-side.
- [ ] Exports are owner-only, re-checked per request, `no-store`.

## 10. Operations

- [ ] Vercel: preview deployments protected (Standard Protection or password); env vars scoped per environment and marked Sensitive; production and preview use different secrets where possible.
- [ ] Vercel Firewall: bot protection on; a rule or rate limit for credential routes; know how to switch on Attack Challenge Mode.
- [ ] Error pages and API errors show no stack traces (check a forced 500 on a preview).
- [ ] Alerts on 5xx spikes and failed cron runs; someone reads them.
- [ ] A short incident runbook: how to rotate each key (Supabase service role, VAPID, cron, kiosk), revoke all sessions, pause the project.
- [ ] Security check script (`scripts/check-security.mjs` pattern: apply all migrations to PGlite, assert grants/RLS/search_path/no overloads, assert headers and guards in code) runs before every push.
