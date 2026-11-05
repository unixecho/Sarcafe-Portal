# QA blueprint — the automatic test suite (Sarcafe, reusable for other projects)

**Owner, 2026-11-05:** "an automatic testing suite for this project which will be the blueprint for other projects … each time we implement
something we run all the automatic QA suite and we look for security flaws, vulnerabilities, regression, retesting, survival and recovery …
a developer's review every morning … a place in the panel for them."

## Run it
| Command | What |
|---|---|
| `npm run qa` | everything, writes `qa/reports/latest.json` + `latest.md` (≈15–25 min, most of it the production build and the 30+ regression scripts) |
| `npm run qa:fast` | everything except the existing `check:*` / `verify:*` scripts |
| `npm run qa -- --only static,unit` | some stages (`static, checks, unit, security, features, ui, survival`) |
| `npm run qa -- --reuse-build` | keep the last production build (only when no app code changed since) |
| `npm run qa -- --post` | also send the report to the portal (needs `QA_REPORT_URL` + `QA_REPORT_SECRET`) |
| `QA_TESTS=ui.reset,ui.notifications-long npm run qa -- --only ui` | only those tests, while fixing one thing (the full run before the push still runs everything) |

**The rule:** every change runs `npm run qa` before it is pushed, and a failing test is fixed or explicitly reviewed, never deleted. A new
feature adds its tests in the same change (a new endpoint → `qa/live/features.mjs` + it appears in `security.probe-signed-out` automatically).

## Every morning
`.github/workflows/qa.yml` runs the whole suite at 05:17 Israel time (06:17 in summer), after every push to `main`, and on demand
("Run workflow"). It posts the report to `/api/qa/report`; the developer opens **/staff/dev/qa** (account menu → "סקירת QA של הבוקר", or the
card at the top of the developer view): a verdict, the pass rate, what changed since the last run, what is good, what is at risk, the next
steps, every stage with its tests, the dependency audit and the last 14 runs. The GitHub run page shows the same review (job summary) and keeps
the JSON for 30 days.

**One-time setup (owner):** (1) apply migration `20261105090000` (creates `qa_runs`); (2) Vercel → Settings → Environment Variables:
`QA_REPORT_SECRET` = a long random string, then redeploy; (3) GitHub → the repository → Settings → Secrets and variables → Actions:
`QA_REPORT_SECRET` (the same value) and `QA_REPORT_URL` = `https://sarcafe-portal.vercel.app/api/qa/report`. Until then the workflow still runs
and keeps its report in GitHub, and the panel shows the report that shipped with the code.

## What it checks (stages)
| Stage | File | Categories | What |
|---|---|---|---|
| static | `qa/stages/static.mjs` | static, sql, security | `tsc`; migration names; **no function with two signatures** (follows `drop` and `rename`); every new function revoked from browser roles; RLS on every new table; secrets in git; **every API route guarded or on the reviewed public list**; npm audit (new high/critical fail; known ones listed with a reason); required docs exist |
| checks | `qa/stages/checks.mjs` | regression, sql, security | every existing `check:*` / `verify:*` script (SQL is real Postgres via PGlite). The Windows-Edge browser checks run on the suite's Chromium (`EDGE_PATH`); `check:shift-scroller` needs its fixture page, so it runs in the ui stage against the built copy. Anything this machine truly cannot run is **skipped with the reason**, never passed |
| unit | `qa/stages/unit.mjs` | unit, security | the pure rules as real TypeScript: search engine (Hebrew, typos, ranking), **tool index vs the middleware access lists**, message cleaning (direction overrides, zero-width), tones, pills, the report contract |
| security | `qa/live/security.mjs` | security, recovery | against the running app: **all API routes signed out** (no data, no 500, no leaked stack/SQL), cross-site writes blocked, form posts refused, security headers, `no-store` on private data, pages redirect to sign-in, roles (employee / manager / owner / developer), the QA report endpoint's lock |
| features | `qa/live/features.mjs` | e2e, security, survival, recovery | the team message matrix (recipients, push-enabled only, roles, branches, shift windows, validation, limits, duplicates, fail-closed limiter, before-migration mode, inbox) and the tool history (sync, merge, isolation, validation, reset, before-migration) |
| ui | `qa/live/ui.mjs` | e2e, a11y, perf, survival | real Chromium as each person: dashboards, notifications menu (green / red), branch switch, the team message flow with server error and offline, the finder, employee and manager homes, developer + QA page, the on-shift carousel, the dock at 3 widths, **text contrast against the real pixels in all 5 looks**, no sideways scroll at 360/768/1280, scroll smoothness at 4x CPU throttle |
| survival | `qa/live/survival.mjs` | survival, recovery | the database fails with internal details, goes down, is slow, comes back: clean errors, no leaks, recovery without restart, a send during an outage retries once exactly |

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
  reports/latest.json|md   the last run (committed; the panel's fallback); history/ stays local
src/lib/qa/report.ts       the report contract (zod), shared by the suite, the ingest route and the page
src/app/api/qa/report      ingest (Bearer secret, size cap, strict schema) → qa_runs
src/app/staff/dev/qa       the morning review page
.github/workflows/qa.yml   schedule + push + manual
```
To adopt it elsewhere: copy `qa/`, the report contract, the ingest route and the page; rewrite `standin/seed.mjs` and the live stages for that
project's features; keep `static.mjs` (point `PUBLIC_ROUTES` and `ACCEPTED_ADVISORIES` at that project); add the workflow and the two secrets.

## Browser traps found the hard way (keep these when you copy the suite)
- **Build with `next build --profile`.** In a plain production build React's `<Profiler onRender>` never fires, so any check that counts
  renders reads `NaN`. `--profile` keeps the real production build and turns the profiler back on.
- **Headless Chromium in a landscape viewport turns a horizontal swipe at the end of a scroller into "Back"**, whatever the page's
  `overscroll-behavior` says (a plain page with no app code does it too; portrait never does). Launch the browser with
  `--disable-features=OverscrollHistoryNavigation` for touch tests. It is the emulator, not the app: a phone's back gesture is the system's.
- **A synthetic swipe must be long enough for scroll snapping:** under about half a slide, snapping pulls it back. Size swipes to the slide
  (`check:shift-scroller` uses at least 60% of one), not to a fixed pixel count.
- **Scope locators by name.** A screen can have two glass segmented controls (the top bar's branch switch and the page's lenses); use
  `getByRole('radiogroup', { name })`, not "the first `.gl-seg`".
- The Windows-only browser checks (`check:kiosk-*`, `check:shift-scroller`) take `EDGE_PATH`; the suite points it at its Chromium.

## Known limits (said plainly)
- The stand-in is not Postgres: SQL behaviour is covered by the `verify:*` scripts (PGlite), not by the live stages. Embedded selects
  (`rel(*)`) return null in the stand-in.
- No real phone, no iOS Safari (glisse has no refraction there), no real push delivery (rows in the outbox are checked, not the phone).
- Touch is emulated (CDP touch events); fling momentum is weaker than a real thumb, which is why swipes are sized to the slide.
