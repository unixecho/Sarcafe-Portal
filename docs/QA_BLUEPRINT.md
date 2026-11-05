# QA blueprint — the automatic test suite (Sarcafe, reusable for other projects)

**Owner, 2026-11-05:** "an automatic testing suite for this project which will be the blueprint for other projects … each time we implement
something we run all the automatic QA suite and we look for security flaws, vulnerabilities, regression, retesting, survival and recovery …
a developer's review every morning … a place in the panel for them."

## Run it
Two suites, two reports: **the dashboard** (`qa/reports/latest.json|md`) and **the kiosk** (`qa/reports/kiosk-latest.json|md`). One
production build serves both.

| Command | What |
|---|---|
| `npm run qa` | both suites, both reports (≈20–30 min, most of it the production build and the 30+ regression scripts) |
| `npm run qa -- --suite kiosk` | one suite (`dashboard` or `kiosk`) |
| `npm run qa:fast` | everything except the existing `check:*` / `verify:*` scripts |
| `npm run qa -- --only static,unit` | some stages (dashboard: `static, checks, unit, security, features, ui, survival`; kiosk: `kiosk-static, kiosk-checks, kiosk-api, kiosk-ui`) |
| `npm run qa -- --reuse-build` | keep the last production build (only when no app code changed since) |
| `npm run qa -- --post` | also send both reports to the portal (in GitHub Actions: GitHub's identity token; by hand: `QA_REPORT_SECRET`) |
| `node qa/tools/send-digest.mjs --dry` | what the 07:00 notification would say right now (sends nothing) |
| `QA_TESTS=ui.reset,ui.notifications-long npm run qa -- --only ui` | only those tests, while fixing one thing (the full run before the push still runs everything) |

**The rule:** every change runs `npm run qa` before it is pushed, and a failing test is fixed or explicitly reviewed, never deleted. A new
feature adds its tests in the same change (a new endpoint → `qa/live/features.mjs` + it appears in `security.probe-signed-out` automatically).

## Every morning
`.github/workflows/qa.yml`:
- **04:41 Israel time (05:41 in summer)**, after every push to `main`, and on demand ("Run workflow"): job `qa` runs both suites and posts
  the two reports to `/api/qa/report` (stored in `qa_runs` with their `suite`).
- **07:00 Israel time**: job `digest` asks `/api/qa/digest` to send the developer **one notification** with both results — title "בדיקות הבוקר: הכול עבר"
  (green) or "בדיקות הבוקר: <suite> נכשל" (red), and a line per suite ("<suite>: עבר 212/214 · <suite>: נכשל, 2 בדיקות"). Only developers receive it (badge `developer` or the
  checklist-developer address). A report that did not arrive counts as a failure. The portal keeps one digest per Israel day
  (`qa_digests`), so a re-run or the other season's firing only answers "already sent". GitHub's cron is in UTC, so there are two
  firings (03:47 and 04:47 UTC); the job works out Israel's clock, stops if it is the early one, and otherwise waits for 07:00.
- **The link**: on a pass it opens **/staff/dev/qa**; on a failure **/staff/dev/qa?suite=<the failing suite>&focus=problems** — that
  suite's full report, scrolled to its problems, which are highlighted. The page has a switch between the two reports (dashboard / kiosk).

The review page (account menu → "סקירת QA של הבוקר", or the card at the top of the developer view): a verdict, the pass rate, what changed
since the last run, what is good, what is at risk, the next steps, every stage with its tests, the dependency audit and the last 14 runs, per
suite. The GitHub run page shows the same reviews (job summary) and keeps both JSON files for 30 days.

**Who may post (no stored secret in GitHub):** both jobs prove who they are with GitHub's own identity token (OIDC, `id-token: write`,
audience `sarcafe-qa`), asked for right before each post because it lives only minutes (`qa/lib/github-token.mjs`). The portal checks
GitHub's signature and that the token is for **this repository, `.github/workflows/qa.yml`, the `main` branch** (`src/lib/qa/auth.ts`);
anything else is 401. A manual post uses `QA_REPORT_SECRET` (Vercel env), and the repository secrets `QA_REPORT_SECRET` / `QA_REPORT_URL`
are optional fallbacks. Migration `20261105090000` creates `qa_runs` (with `suite`) and `qa_digests`.

## What it checks (stages)
| Stage | File | Categories | What |
|---|---|---|---|
| static | `qa/stages/static.mjs` | static, sql, security | `tsc`; migration names; **no function with two signatures** (follows `drop` and `rename`); every new function revoked from browser roles; RLS on every new table; secrets in git; **every API route guarded or on the reviewed public list**; npm audit (new high/critical fail; known ones listed with a reason); required docs exist |
| checks | `qa/stages/checks.mjs` | regression, sql, security | every existing `check:*` / `verify:*` script (SQL is real Postgres via PGlite). The Windows-Edge browser checks run on the suite's Chromium (`EDGE_PATH`); `check:shift-scroller` needs its fixture page, so it runs in the ui stage against the built copy. Anything this machine truly cannot run is **skipped with the reason**, never passed |
| unit | `qa/stages/unit.mjs` | unit, security | the pure rules as real TypeScript: search engine (Hebrew, typos, ranking), **tool index vs the middleware access lists**, message cleaning (direction overrides, zero-width), tones, pills, the report contract |
| security | `qa/live/security.mjs` | security, recovery | against the running app: **all API routes signed out** (no data, no 500, no leaked stack/SQL), cross-site writes blocked, form posts refused, security headers, `no-store` on private data, pages redirect to sign-in, roles (employee / manager / owner / developer), the QA report endpoint's lock |
| features | `qa/live/features.mjs` | e2e, security, survival, recovery | the team message matrix (recipients, push-enabled only, roles, branches, shift windows, validation, limits, duplicates, fail-closed limiter, before-migration mode, inbox) and the tool history (sync, merge, isolation, validation, reset, before-migration) |
| ui | `qa/live/ui.mjs` | e2e, a11y, perf, survival | real Chromium as each person: dashboards, notifications menu (green / red), branch switch, the team message flow with server error and offline, the finder, employee and manager homes, developer + QA page, the on-shift carousel, the dock at 3 widths, **text contrast against the real pixels in all 5 looks**, no sideways scroll at 360/768/1280, scroll smoothness at 4x CPU throttle |
| survival | `qa/live/survival.mjs` | survival, recovery | the database fails with internal details, goes down, is slow, comes back: clean errors, no leaks, recovery without restart, a send during an outage retries once exactly; **while sign-in cannot be checked every owner and staff route answers 503, never 401** (401 only for a missing session) |

**The kiosk suite** (its own report):

| Stage | File | Categories | What |
|---|---|---|---|
| kiosk-static | `qa/kiosk/static.mjs` | static, unit | the tablet page's scripts parse; the page bundle assembles (no empty file, every script loaded); **the app's plain Java compiled and run with `javac`** (a PIN record made by the portal opens the panel in `StaffPin.java`; bad records refused); the app's wiring (remote PIN on every update check, pinned host, no redirects; a command marked done before it runs) |
| kiosk-checks | `qa/stages/checks.mjs` | regression | every `check:kiosk-*` / `verify:kiosk-*` script |
| kiosk-api | `qa/kiosk/api.mjs` | security, e2e, survival | the kiosk key, a tablet sees only its own settings, commands end to end (sent → carried by the report → done), the PIN round trip (never the PIN, only the record; once), the PIN rules and the rate limit, owner-only, outage answers |
| kiosk-ui | `qa/kiosk/ui.mjs` | e2e, security, a11y | the kiosk dashboard in Chromium: the tablet's state, the switch between the dashboards both ways (owner and developer, no reload), saving settings, remote actions and the PIN sheet, access by role, contrast in all five looks, iPhone and tablet widths |

The Java stage needs a JDK (`javac`): the workflow installs Temurin 17; locally the suite finds `/usr/bin/javac` or `JAVA_HOME`, and skips
with the reason when there is none.

**Flaky:** a failing test runs once more; passing the second time is reported as *flaky* (amber), never hidden.

## How it is built (copy this to another project)
```
qa/
  run.mjs                  stages → report → review → (post)
  lib/harness.mjs          stage/test, assert, retry-once, skip-with-reason, time limits
  lib/report.mjs           report JSON + the Hebrew morning review + diff with the previous run
  lib/exec.mjs             child processes with time limits; long-running servers in their own process group
  standin/supabase.mjs     in-memory PostgREST + GoTrue user + RPCs + fault injection (down / error / slow / missing tables & functions)
  standin/seed.mjs         the project's world (people, branches, shifts) relative to today
  live/app.mjs             production build of THIS checkout against the stand-in, `call(path, { as })`, `page(who)`, control
  live/*.mjs               the live stages
  stages/*.mjs             static, checks, unit
  kiosk/*.mjs              the kiosk suite's stages (static + Java, api, ui)
  lib/github-token.mjs     GitHub's identity token for posting
  tools/send-digest.mjs    the 07:00 digest call
  reports/latest.json|md   the dashboard suite's last run; kiosk-latest.json|md the kiosk's (committed; the panel's fallback); history/ stays local
src/lib/qa/report.ts       the report contract (zod, with `suite`), shared by the suite, the ingest route and the page
src/lib/qa/auth.ts         who may post: GitHub's identity token (this repo, this workflow, main) or the shared secret
src/lib/qa/digest.ts       the 07:00 notification's words and link
src/app/api/qa/report      ingest (size cap, strict schema) → qa_runs
src/app/api/qa/digest      one notification a day to the developers → qa_digests + schedule_notifications
src/app/staff/dev/qa       the morning review page (switch between the suites, ?focus=problems)
.github/workflows/qa.yml   schedule + push + manual; job qa, job digest
```
To adopt it elsewhere: copy `qa/`, the report contract, the ingest route and the page; rewrite `standin/seed.mjs` and the live stages for that
project's features; keep `static.mjs` (point `PUBLIC_ROUTES` and `ACCEPTED_ADVISORIES` at that project); add the workflow and point
`QA_GITHUB_REPOSITORY` (or the default in `src/lib/qa/auth.ts`) at that repository.

## Browser traps found the hard way (keep these when you copy the suite)
- **Build with `next build --profile`.** In a plain production build React's `<Profiler onRender>` never fires, so any check that counts
  renders reads `NaN`. `--profile` keeps the real production build and turns the profiler back on.
- **Headless Chromium in a landscape viewport turns a horizontal swipe at the end of a scroller into "Back"**, whatever the page's
  `overscroll-behavior` says (a plain page with no app code does it too; portrait never does). Launch the browser with
  `--disable-features=OverscrollHistoryNavigation` for touch tests. It is the emulator, not the app: a phone's back gesture is the system's.
- **A synthetic swipe must be long enough for scroll snapping:** under about half a slide, snapping pulls it back. Size swipes to the slide
  (`check:shift-scroller` uses at least 60% of one), not to a fixed pixel count.
- **Plain Chromium has no notch.** With `viewport-fit=cover` an iPhone adds 59 px at the top and 34 px at the bottom
  (`env(safe-area-inset-*)`); Chromium adds none, so a top bar sitting 59 px on the first card passed every test. `live.page(who,
  { iphone: true })` sets an iPhone's insets through `Emulation.setSafeAreaInsetsOverride`; test phone layouts with it.
- **Scope locators by name.** A screen can have two glass segmented controls (the top bar's branch switch and the page's lenses); use
  `getByRole('radiogroup', { name })`, not "the first `.gl-seg`".
- The Windows-only browser checks (`check:kiosk-*`, `check:shift-scroller`) take `EDGE_PATH`; the suite points it at its Chromium.

## Known limits (said plainly)
- The stand-in is not Postgres: SQL behaviour is covered by the `verify:*` scripts (PGlite), not by the live stages. Embedded selects
  (`rel(*)`) return null in the stand-in.
- No real phone, no iOS Safari (glisse has no refraction there), no real push delivery (rows in the outbox are checked, not the phone).
- No real tablet: the kiosk app's Android parts (activities, WebView, installer) are not run; its plain-Java rules are, with `javac`. The
  stand-in plays GitHub's token issuer (`QA_OIDC_ISSUER`, a test key) so the token check is tested end to end without GitHub.
- Touch is emulated (CDP touch events); fling momentum is weaker than a real thumb, which is why swipes are sized to the slide.
