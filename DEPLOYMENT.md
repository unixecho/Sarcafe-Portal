# SARCafe — Deployment & Infra Setup Runbook

Every gotcha below was hit for real getting this app's first deploy working. Follow this in order for a fresh setup (a new environment, a project recreation, or a sibling app built the same way); use it as a checklist when something breaks, since most breakage so far has been one of these exact items.

## 1. Google Cloud Console — OAuth Client

**Authorized JavaScript origins:**
- `https://<your-production-domain>` (e.g. `https://sarcafe-portal.vercel.app`)
- `http://localhost:3000` (local dev)

**Authorized redirect URIs — all three of these, not just the "correct" one:**
- `https://<project-ref>.supabase.co` ⚠️ **bare origin, no path.** This one is easy to skip because it's not the URI Supabase's own docs tell you to add, but its absence caused real, intermittent login failures (the browser landing on the app's root with a stray `?code=` instead of at `/auth/callback`, stranding the auth code). Add it even though it looks redundant.
- `https://<project-ref>.supabase.co/auth/callback`
- `https://<project-ref>.supabase.co/auth/v1/callback` — the actual Supabase GoTrue callback path; this is the one every guide tells you about.

Missing any of the three has produced real, hard-to-diagnose symptoms in this project. If Google OAuth ever misbehaves again, check this list first.

## 2. Supabase Project

### 2.1 Run every migration, in order
`supabase/migrations/000_core_schema.sql` → `001_menus_schema.sql` → `002_app_settings.sql` → `003_rate_limiting.sql` → `004_grants.sql`, via the SQL editor: `https://supabase.com/dashboard/project/<project-ref>/sql/new`

⚠️ **RLS policies are not the same as table GRANTs.** `004_grants.sql` exists specifically because 000–003 enabled RLS and wrote policies but never actually `GRANT`ed the tables to `service_role`/`authenticated`/`anon` — a separate, more basic Postgres permission layer that RLS sits on top of, not a replacement for. Without it, even the service-role client (which bypasses RLS) gets a hard `permission denied for table X` — not an empty result, an actual error. **Any new table added later needs its own explicit GRANTs, or this exact failure repeats.**

Run the one-time data seed after the schema migrations: `supabase/seed_legacy_menu_data.sql`.

### 2.2 Authentication → URL Configuration
- **Site URL**: `https://<your-production-domain>/`
- **Redirect URLs**: add both
  - `https://<your-production-domain>/**` (wildcard)
  - `https://<your-production-domain>/auth/callback` (exact — added defensively; the wildcard should already cover this, but add both)

### 2.3 Authentication → Providers → Google
Paste the Google OAuth Client ID + Secret from step 1 here. Nothing else needed on this page.

### 2.4 First owner
No signup UI creates the first `owner` — insert it directly:
```sql
insert into public.staff (email, role, badge, branch_id)
values ('<your-email>', 'owner', 'owner', null);
```
Signing in with Google after this links the row automatically via `claim_staff_invite()`.

## 3. Vercel Project

### 3.1 Before importing the repo
**Connect GitHub as a Login Connection first** (Vercel account settings) — importing a repo without this fails outright with "You need to add a Login Connection to your GitHub account first."

### 3.2 Framework detection
⚠️ If the project was ever imported while the repo's default branch had the *old static site* (no `package.json`/`next.config.mjs`), Vercel locks in **Framework Preset: Other** with an **Output Directory override of `public`**. Once the repo has the real Next.js app, this stale setting causes: `Error: No Output Directory named "public" found after the Build completed.` Fix: Settings → General → Framework Preset → **Next.js**, and turn OFF any Output Directory override so it uses the Next.js default. This does not self-correct — it has to be changed manually, once.

### 3.3 Production Branch
Settings → Git → confirm **Production Branch is `main`** (or whichever branch actually has the current app) — pushing to the wrong branch silently deploys nothing new to production while everything *looks* fine on GitHub.

### 3.4 Environment Variables (Settings → Environment Variables)
All three below must be:
- Scoped to **Production** (and Preview, if you want preview deployments to work too)
- Added/edited **before** the deployment you're testing — env var changes never apply retroactively; a new deployment (redeploy or new push) is required after any change

| Variable | Value | Gotcha already hit |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | ⚠️ Must be the **bare project URL** — no `/rest/v1/` suffix. Pasting the REST API endpoint (as shown elsewhere in Supabase's own API docs page) breaks every request the client makes. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the `anon` `public` key | — |
| `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` **secret** key | ⚠️ Easy to paste the `anon` key here by mistake — they're both long JWTs and look similar at a glance. Symptom if wrong: `permission denied for table X` (because the query actually runs as `anon`, which correctly lacks access, not because anything is broken). **Verify by decoding the value at jwt.io — the payload must say `"role":"service_role"`, not `"role":"anon"`.** |
| `CRON_SECRET` | any long random string you generate yourself (e.g. `openssl rand -hex 32`) | Gates `/api/cron/keep-alive` — see §3.6. Not a Supabase value; you're inventing this one. |

### 3.5 After ANY of the above changes
**Deployments → latest → ⋯ → Redeploy.** Settings changes and env var edits do not trigger a new deployment on their own.

### 3.6 Keep-alive cron (Supabase auto-pause)
Supabase's free tier pauses a project after 7 days with zero API activity. The QR codes on the trucks are the only normal traffic this app gets — a slow week or a branch closed for a stretch is enough to trip it, and every page breaks with no warning until a customer scans a dead QR code.

`vercel.json` registers a daily Vercel Cron hitting `GET /api/cron/keep-alive` (see the file for the schedule), which does a throwaway `select` against `branches` purely to register activity. The route refuses any request that isn't Vercel's own scheduled invocation — it checks for `Authorization: Bearer $CRON_SECRET`, which Vercel attaches automatically once `CRON_SECRET` is set in the project's env vars (§3.4). **Vercel Cron only actually runs once this project is deployed** — nothing fires from a local `next dev` — and Hobby-tier projects are limited to once-daily cron invocations, which is already what's configured here (well under the 7-day pause window). Confirm it's firing via Vercel's dashboard → the project → Cron Jobs tab, or by checking `/api/cron/keep-alive`'s logs for a 200 once a day.

## 4. Known defensive code (don't remove without understanding why)

- `src/middleware.ts` forwards a stray `?code=` landing on `/` to `/auth/callback`. This exists because the OAuth redirect has intermittently landed on the app root instead of `/auth/callback` despite every relevant config (Supabase redirect_to, Redirect URLs allowlist) being verified correct at the time — the Google Console fix in §1 (the bare-origin redirect URI) is the suspected real root cause, but this middleware forward stays as a safety net since the exact mechanism was never fully confirmed.
- `src/app/auth/callback/route.ts` surfaces the actual Postgrest/GoTrue error message via `?reason=` and `?detail=` on the `/no-access` redirect instead of swallowing it — keep this; it's what made the two bugs above possible to diagnose at all without direct log access.
