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
| `npm run qa -- --only static,unit` | some stages (dashboard: `harness, static, checks, unit, security, features, ui, survival`; kiosk: `kiosk-static, kiosk-checks, kiosk-api, kiosk-ui`) |
| `npm run qa -- --reuse-build` | keep the last production build. It is kept only when it was made from exactly today's source (a fingerprint of every file that goes into the build is stored beside it); after any edit the suite says so and builds again |
| `npm run qa -- --post` | also send both reports to the portal (in GitHub Actions: GitHub's identity token; by hand: `QA_REPORT_SECRET`) |
| `node qa/tools/send-digest.mjs --dry` | what the 07:00 notification would say right now (sends nothing) |
| `QA_TESTS=ui.reset,ui.notifications-long npm run qa -- --only ui` | only those tests, while fixing one thing (the full run before the push still runs everything) |

**The rule:** every change runs `npm run qa` before it is pushed, and a failing test is fixed or explicitly reviewed, never deleted. A new
feature adds its tests in the same change (a new endpoint → `qa/live/features.mjs` + it appears in `security.probe-signed-out` automatically).

## Machines (Windows and Linux)
The suite runs the same way on a Windows PC and on GitHub's Linux runner. Set up a machine once:

```
npm ci
npx playwright install chromium      (Linux CI: npx playwright install --with-deps chromium)
npm run qa
```

The first line of every run says what it really ran on (platform, Node, the npm script it uses, the JDK it found). What has actually been run:

| Machine | Node / npm | JDK | Result |
|---|---|---|---|
| GitHub Actions, `ubuntu-latest` (`.github/workflows/qa.yml`) | Node 22 | Temurin 17 | the daily and per-push runs; **not re-run with the 2026-11-11 / 11-12 harness changes yet** (they are not on `main`). The harness stage alone was run on Linux in a `node:20-alpine` container (Node 20, no JDK, no browser): 11 passed, 2 skipped; the full suite has not run on Linux with these changes |
| Owner's PC, Windows 11 | Node 22.20.0 / npm 11.9.0 | Oracle JDK 24.0.1 (found through the `javac` on the PATH; `JAVA_HOME` is not set) | full runs, see `handoff.md` 2026-11-11 and 2026-11-12 (the second from a folder with spaces) |
| Work laptop, Windows 11 | Node 24.13.0 / npm 11.6.2 | Temurin 21.0.7 | before the fix only (the failing baseline in `docs/identity-system/baseline/2026-11-11.md`); not re-run after it |

Supported: **Node 22 or 24, any JDK from 17 up** (the Java tests compile with `--release 8`). No version is pinned in `package.json`
on purpose: CI is the reference (Node 22, Temurin 17), and a different local version is printed, not hidden. Without a JDK the two
Java tests are skipped with the reason; with one they must run.

Rules the harness keeps so it works on both (`qa/lib/exec.mjs`, `qa/lib/jdk.mjs`, `qa/lib/scratch.mjs`, `qa/lib/browser.mjs`; tested by the `harness` stage):
- **No shell, ever.** A command is an executable and an argument array. `npm` and `npx` are not spawned by name (on Windows they are
  `.cmd` files that only a shell can start: `spawn npm ENOENT`): npm's own `npm-cli.js` and a package's own `bin` script are run with
  the Node that runs the suite (`npm()`, `packageBin()`).
- **A module is imported by file URL** (`importFile()`), never by a bare absolute path (`C:…` is not a module address).
- **The JDK is looked for, not assumed:** `JAVA_HOME` when it holds a compiler, else the `javac` on the PATH (`javac.exe` on Windows);
  when that is only a launcher (Oracle's `javapath`), the JDK it runs. The check scripts get it as `JAVA_HOME`.
- **The build copy** (`qa/.work/app`) holds only what a build reads: the files and folders listed in `qa/lib/scratch.mjs`
  (`SOURCE_FILES`, `SOURCE_DIRS`), never a `.env*` file, never another top-level folder. A new top-level file the build needs is
  added to that list on purpose. It reaches the installed packages through a junction on Windows (no administrator rights) and a
  symlink elsewhere; removing the copy removes the link first and refuses any path outside `qa/.work`.
- **The test app starts with the operating system's variables only** plus the stand-in's made-up keys (`cleanEnv`): a real project
  address, key or provider setting in the developer's shell cannot reach it. The `check:*` scripts still get the whole environment,
  as they do when run by hand.
- **Nothing is left running.** Every program the suite starts (`run()` and `start()` alike) is ended with everything it started when
  it passes its time limit or is stopped: on Windows `taskkill /T` from the suite's own still-running child; on Linux / macOS the
  child is started as the leader of its own process group and the group is signalled. Never a process the suite did not start.
  When the build, the server or the browser fails to start, whatever was already started is closed; Ctrl+C ends the children too.
  A run refuses to start while its two ports (54399, 3399) are taken. The `harness` stage proves it with a program that starts a
  child that starts a grandchild, and requires all three to be gone on both systems. "Gone" means not running: on Linux a zombie
  (ended, waiting to be collected; in a container without an init process it stays for ever) counts as ended, read from
  `/proc/<pid>/stat`. Run on Linux in `node:20-alpine` with and without an init process (2026-11-12, the harness stage only).
- **A browser is used only after it proves it works** (`qa/lib/browser.mjs`, `qa/lib/browser-probe.mjs`): each candidate is started
  with Playwright in its own process, must render a test page and exit 0 inside 45 seconds. A non-zero exit, a time-out, a start
  error or an exit without the page rejects it **with the reason on the run's first lines**, and the next candidate is tried
  (Playwright's Chromium, `QA_CHROMIUM`, the container's copy, on Windows the installed Edge). When browsers are installed but
  none works, the browser tests **fail** with those reasons; "skipped: needs Windows Edge" is only for a machine with no browser.
- Not on Windows: a checkout path with non-English letters breaks the Java tests (the JDK's launcher reads its arguments in the
  system code page). Spaces are fine.

## Every morning
`.github/workflows/qa.yml`:
- **02:13 Israel time (03:13 in summer), with a backup try two hours later if that run did not happen**, after every push to `main`, and on demand ("Run workflow"): job `qa` runs both suites and posts
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
| harness | `qa/stages/harness.mjs` | unit, security | the suite checks itself on this machine: npm and package tools start without a shell, a module loads by its path, the JDK is found and compiles, a stuck program and a server are ended with everything they started (three generations), a browser that exits with an error, hangs or renders nothing is rejected with the reason and the next one is tried, the chosen browser passes the real readiness check, the test app's environment is clean, the build copy holds only app code and its cleanup cannot leave `qa/.work` |
| static | `qa/stages/static.mjs` | static, sql, security | `tsc`; migration names; **no function with two signatures** (follows `drop` and `rename`); every new function revoked from browser roles; RLS on every new table; secrets in git; **every API route guarded or on the reviewed public list**; npm audit (new high/critical fail; known ones listed with a reason); required docs exist |
| checks | `qa/stages/checks.mjs` | regression, sql, security | every existing `check:*` / `verify:*` script (SQL is real Postgres via PGlite; since 2026-11-12 that includes `verify:identity-sql`, the identity foundation with two businesses and two organizations, `docs/SARCAFE_IDENTITY.md`). The Windows-Edge browser checks run on the suite's Chromium (`EDGE_PATH`); `check:shift-scroller` needs its fixture page, so it runs in the ui stage against the built copy. Anything this machine truly cannot run is **skipped with the reason**, never passed |
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

The Java stage needs a JDK (`javac`): the workflow installs Temurin 17; locally the suite finds it through `JAVA_HOME` or the PATH
(`qa/lib/jdk.mjs`, see "Machines"), and skips with the reason only when there really is none.

**Flaky:** a failing test runs once more; passing the second time is reported as *flaky* (amber), never hidden.

## How it is built (copy this to another project)
```
qa/
  run.mjs                  stages → report → review → (post)
  lib/harness.mjs          stage/test, assert, retry-once, skip-with-reason, time limits
  lib/report.mjs           report JSON + the Hebrew morning review + diff with the previous run
  lib/exec.mjs             child processes without a shell, with time limits; npm and package tools; servers ended with what they started
  lib/jdk.mjs              where this machine's JDK is
  lib/browser.mjs          this run's browser: the first candidate that passes a bounded readiness check (browser-probe.mjs)
  lib/scratch.mjs          the build copy: what goes in, the link to the packages, the source fingerprint, safe removal
  standin/supabase.mjs     in-memory PostgREST + GoTrue user + RPCs + fault injection (down / error / slow / missing tables & functions)
  standin/seed.mjs         the project's world (people, branches, shifts) relative to today
  live/app.mjs             production build of THIS checkout against the stand-in, `call(path, { as })`, `page(who)`, control
  live/*.mjs               the live stages
  stages/*.mjs             harness (the suite checks itself), static, checks, unit
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
