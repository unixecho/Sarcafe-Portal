# Prompt: AyekaBar dashboard glass (glisse) revamp — for ChatGPT (Astra 6, Extra High)

Paste everything below the line into ChatGPT, with the AyekaBar repository connected (and, if you can, the Sarcafe repository
`unixecho/Sarcafe-Portal` too, read-only, as the reference).

---

You are a senior front-end engineer doing a careful, production-quality redesign. Work in the **AyekaBar** repository. The goal:
give AyekaBar's **staff/owner dashboards** the same "liquid glass" revamp that its sister project **Sarcafe** got, including every
small fix the owner asked for along the way, plus a **full automatic QA suite** with a daily notification and an extensive report.
**Order: map → a preview on REAL data that the owner tests and approves → only then build.** The customer-facing website is
**out of scope** (do not touch it).

## 0. Ground rules
- First read the AyekaBar repo's own instructions (`CLAUDE.md`, `AGENTS.md`, `handoff.md`, `README`, docs) and follow them; where they
  conflict with this prompt, the repo's rules win and you say so.
- Do not invent a new design system. Port Sarcafe's, adapted to AyekaBar's routes, data, roles and brand.
- Never change what the dashboards DO (data, permissions, which tools each role sees, the order of the owner's tool lists) while
  restyling. A restyle that drops or reorders a tool is a bug.
- Never record or print secrets, keys, passwords, employee codes or personal staff data in code, commits, docs or chat.
- Work in small, reviewable commits on a branch. Do not push to `main` or deploy without the owner's go.
- When you are unsure, inspect the code; when it is the owner's decision (brand colours, what to call things), ask once, briefly.

## 1. The reference: how Sarcafe did it (read these if you can reach the Sarcafe repo)
- `docs/SARCAFE_GLASS_UI.md`: the working guide (rules, pieces, traps). The most important file.
- `docs/SARCAFE_GLASS_UI_STYLE.md`: the design history and measurements.
- `src/components/glass/` (`glass.css`, `GlassDashboardShell`, `GlassTopBar`, `GlassDock`, `DockHost`, `GlassSkeleton`, `Seg`, `Pill`,
  `toast.ts`, `GlassMotion`, `tools/*`) and `src/lib/nav/dock.ts`.
- The library is **glisse 0.5.0** (React "Liquid Glass"), pinned exactly in `package.json`.
If you cannot reach it, everything you need is restated below.

## 2. The owner's rules (non-negotiable)
1. **The account button's menu is the signature look.** Every menu, popover, picker and notification list looks like it: glisse's
   `<Menu>` when it opens from an icon button, otherwise a `.gl-pop`-style surface with the SAME tokens, radius and shadow. Menus and
   popovers are nearly opaque (surface ≈ 97%) so nothing behind competes with their text.
2. **One badge style:** a single orange pill (like "2 בקשות"), only ever with a true, known number. No other badge styles.
3. **Good news green, bad news and errors red.** Toasts, pills, status lines, notification rows. Neutral stays the brand accent. Status
   is never colour alone: an icon or words go with it.
4. **The top bar stays as it is** structurally (logo, branch switch for managers, bell, account menu), just in glass.
5. **The home tool lists are the owner's:** keep every tool, every category, the order. Shortcuts and a search ("tool finder") may sit
   ON TOP of the lists; they never replace them.

## 3. Build it like this
- **Shell:** one `GlassDashboardShell`-like component: backdrop → (branch context) → glass top bar → `<main>`. Every dashboard screen
  uses it.
- **Cards are cheap glass:** static cards use a CSS glass surface (`.gl-surf`: blur + tint + 0.5 px edge), NOT a real `<Glass>` (each
  real one builds an SVG refraction filter: slow). Real `<Glass>` only for the top bar, the dock and controls. While scrolling, and for
  ~0.9 s after a switch, swap refraction for plain blur (Sarcafe's `GlassMotion` / `settleGlass()`).
- **Map glisse tokens from the app's own theme tokens** (`--lg-*` from the app's `--bg`, `--bg-elev`, `--text`, accent). If AyekaBar has
  several looks/themes (including light ones), every look must work; light looks need stronger secondary text. No hard-coded dark colours.
- **The bottom dock (tab bar) belongs to the LAYOUT, never to a page**, so it is the same element across tabs and does not blink or
  slide; give it its own view-transition name so the page slides and the bar does not. Who gets which tabs lives in one plan file.
  The tapped tab lights up at once; a "more" tab opens the tool finder.
- **Every route has a `loading.tsx` skeleton shaped like its page** (same backdrop and title, shimmering blocks where the cards go).
  Parts that load in the browser show skeleton blocks, never "טוען…"/"Loading…" text (screen readers get words in `.sr-only`).
- **Instant revisits:** keep visited pages in the router cache (Next `experimental.staleTimes`, e.g. dynamic 180 s / static 300 s), AND
  keep it honest: after any successful write through an API route, refresh the router once on the next tab change and when the app comes
  back after > 1 minute away; live numbers refresh themselves quietly when their copy is older than ~10 s.
- **Only the fields that need data wait:** render the frame (titles, links, buttons, dock) immediately and stream the data parts behind
  `<Suspense>` with a skeleton shaped like that part. Never a whole-page `await` when only one card needs data. Share per-request reads
  with React `cache()`.
- **Taps feel instant:** links prefetch; a tap shows the next page's skeleton at once.

## 4. The small fixes the owner asked for on Sarcafe (apply all of them; each one bit us once)
- **RTL + glisse:** glisse places selection thumbs with physical left/right. Never use its `SegmentedControl` or `TabBar` directly in a
  right-to-left UI: wrap them (Sarcafe's `Seg` / `GlassDock`) in an LTR box with the items reversed.
- **Width trap:** never stretch a glisse control with `width: 100%`; it sizes segments with `--lg-tab-width` and moves the thumb by
  exactly that. Set the variable with container units instead (the thumb drifted up to 96 px).
- **Notification list overlap:** glisse menu items set `min-height: 32px`; in a menu with a `max-height` every row got squeezed and the
  text ran over the next row (owner's iPhone). Keep `flex-shrink: 0` on every menu row, let long menus scroll, clamp long items to two
  lines. Test with 30+ notifications, not three.
- **iPhone safe areas:** the page reserves `env(safe-area-inset-top)` and the top bar is sticky at that height (it used to sit 59 px on the
  first card); a status-bar strip shades cards that scroll under the clock; the dock rests just above the home indicator
  (`max(10px, safe-area-bottom − 12px)`) over an opaque band, so nothing shows beneath it (it used to float 46 px up). Test with real
  safe-area insets (Chromium has none by default; emulate them).
- **Bottom bars (save bars):** use `position: fixed` like the dock, never `position: sticky; bottom` (on iPhone it got stranded mid-screen
  after scrolling down and up). A page's bottom bar sits ABOVE the dock; a task that owns the screen may hide the dock.
- **"Coming soon" tiles:** a group of rounded tiles must not get a square glass box behind it; give the tiles the surface, not the group.
- **Contrast (WCAG AA 4.5:1) measured on real pixels, in every look:** glisse's filled button is white on the fill (2.6:1 on orange):
  make it dark ink. Disabled states stay legible. Soft chips on bright backdrop areas need the card surface under their tint. A green
  or red status line on a tinted block keeps its WORDS in the text colour and lets the block carry the tone (green words on a tinted
  light card measured 3.9:1). Small bold pill text needs margin above 4.5 (darker ink on the accent).
- **Bidi:** a time range inside Hebrew text (07:00–14:00) goes in `<bdi dir="ltr">`.
- **`hidden` attribute:** a `display:grid/flex` rule overrides it; add `[hidden]{display:none!important}` for those classes.
- **Two dashboards, one switch:** if AyekaBar has more than one dashboard (e.g. owner + device/kiosk), a segmented switch at the top moves
  between them without a page reload and keeps the dock.

## 5. Preview FIRST, with real data (the owner decides before anything is built)
The owner wants to SEE and USE the new dashboard before any real screen changes. So, before step 6:
1. **Map (no code yet):** list AyekaBar's dashboard routes, layouts, roles and their tool lists, its themes/looks, its notification and
   account menus, its bottom bars, and anything that already resembles a dock or skeleton. Write the map into the repo
   (`docs/AYEKABAR_GLASS_UI.md`, "current state") with a short plan.
2. **Build a preview that runs on REAL data, alongside the live dashboards — replacing nothing:**
   - A separate, private route (for example `/owner/preview/glass`, and `/staff/preview/glass` for the staff home), behind the SAME
     sign-in and role checks as the real dashboards (owner/manager/employee see what their role sees). Not linked from anywhere public,
     `noindex`, never cached; the existing dashboards stay exactly as they are and stay the default.
   - It reads the SAME real data through the SAME server code the live dashboards use (today's numbers, shifts, requests,
     notifications, tool lists, branches). No mock data, no copied numbers, no separate database.
   - It is fully clickable: links go to the real pages; menus, the branch switch, notifications, the dock and the tool finder work.
     Writes (saving, sending, approving) go through the same existing API routes and permission checks, so testing it is real use.
     If a write action is not ready in the preview, show it disabled with the words "בתצוגה המקדימה" — never a fake success.
   - A visible "תצוגה מקדימה" pill in the top bar and a one-tap way back to the current dashboard.
   - Every look/theme switchable from the preview (the owner's own look by default), phone and desktop.
3. **Hand it to the owner:** the preview link(s), screenshots (phone + desktop, a dark and a light look), and a short list of choices for
   them (brand accent, which tools go in the dock, anything that differs from Sarcafe). **Stop and wait for the owner's go.** Apply their
   changes to the preview and show it again until they approve. Only then continue with section 6.

## 6. Build it (after the owner approves the preview)
1. **Foundation:** add `glisse@0.5.0` (exact), the shared glass pieces and the token mapping for every look (the preview already
   proved them).
2. **One screen at a time:** owner home → employee/staff home → other dashboards → inner pages. Each: glass shell, cards to the cheap
   surface, menus to the signature style, a `loading.tsx` skeleton, the dock from the layout. Keep every tool and its order. Then
   retire the preview route (or keep it for the next pass if the owner wants).
3. **Prove it after every screen** with the QA suite of section 7 (and add the new screen's tests in the same change).
4. **Document as you go:** `docs/AYEKABAR_GLASS_UI.md` becomes the working guide (rules, pieces, traps), like Sarcafe's. Update the
   repo's `handoff.md` at the end: what changed, files, what was verified (pass/fail), what is left, the exact next step.
5. **Report to the owner** in plain words: what they will see, what was tested and the result, anything that needs their decision.

## 7. A full automatic QA suite, like Sarcafe's (build it first — the preview and every screen are checked with it)
If AyekaBar has no suite yet, build one (Sarcafe's blueprint: `docs/QA_BLUEPRINT.md` and the `qa/` folder); if it has one, extend it.
- **`npm run qa`** runs everything, and it runs before every push. A failing test is fixed or explicitly reviewed, never deleted or
  weakened. Every new feature adds its tests in the same change.
- **Stages:**
  - **static:** typecheck; migration naming; no SQL function with two signatures; every new function revoked from browser roles; RLS on
    every new table; no secrets in git; **every API route guarded or on a reviewed public list (with its reason)**; `npm audit` (new
    high/critical fail).
  - **regression:** every existing check/verify script in the repo (SQL in real Postgres via PGlite where they need it).
  - **unit:** the pure rules (permissions per role, tool lists vs the access rules, money/time maths, anything the dashboards compute).
  - **security** against the running app: every API route signed out (no data, no 500, no stack traces or SQL in answers), roles
    (owner / manager / employee / developer) each see only theirs, cross-site writes refused, security headers, `no-store` on private data.
  - **features end to end:** each dashboard feature with its real rules (validation, limits, duplicates, before-migration behaviour).
  - **browser (Playwright, real Chromium):** every dashboard as each role; menus and the notification list at real volume; the dock
    stays the same element across tabs; skeletons appear at once; no sideways scroll at 360 / 768 / 1280 px; iPhone safe areas (emulated
    insets); **text contrast ≥ 4.5:1 against the real pixels in every look**; the preview route too.
  - **survival and recovery:** the database fails, goes down, is slow and comes back: clean errors (503 when sign-in cannot be checked,
    never a false "signed out"), no leaks, recovery without a restart.
- **Never against production data:** the suite builds the app and runs it against a stand-in database (in-memory, seeded with a realistic
  world relative to today), like Sarcafe's `qa/standin/`.
- **Separate suites → separate reports** (for example the dashboard, and any device/kiosk app AyekaBar has), each its own report.

## 8. The daily QA run and the developer's notification
- A **GitHub Actions** workflow runs the full suite **every night before 07:00 Israel time** (e.g. 02:13 Israel in winter / 03:13 in
  summer, with a backup firing two hours later that runs only if the first one did not succeed), after every push to `main`, and on
  demand. It posts each report to the app with **GitHub's own identity token (OIDC)**, accepted only for this repository, this workflow
  file and `main` — no long-lived secret needed (a shared secret only as a fallback for manual runs).
- Reports are stored in a table (RLS on, service role only) and shown on a **developer-only review page** (e.g. `/staff/dev/qa`) with a
  switch between the suites and the last 14 runs.
- **At 07:00 Israel time, ONE notification to the developer only** (push + the in-app bell): "בדיקות הבוקר: הכול עבר" (green) or
  "<suite> נכשל" (red), with one line per suite (passed X/Y, or failed N). A report that did not arrive counts as a failure. At most one
  per day (a per-day record). **On a failure, the notification opens the full report of the failing suite, scrolled to its problems,
  which are highlighted.** The page and the report are glass, like the rest.

## 9. The extensive report (what the owner reads)
Every test in the report shows, so the owner can follow the whole QA without reading code:
- **What is checked** (one plain sentence, in Hebrew, like the rest of the app) and its category (security, end to end, readability…).
- **Expected result** and **actual result**, written for each test (for example: expected "a signed-out request to /api/owner/staff
  answers 401 with no data"; actual "401, body {error: unauthorized}"). On a failure, the actual result says exactly what happened
  (status, the text found, the measured contrast, the element and the screen size), and a screenshot is attached for browser tests.
- **Status:** passed / failed / flaky (passed on the retry — shown, never hidden) / skipped **with the reason**.
- Duration, and what changed since the previous run (new failures first, then fixed ones).
- On top of the report: the verdict, the pass rate per category, what is good, what is at risk, the next steps, the dependency audit.
- The same report as JSON (for the page and the history) and as Markdown (in the GitHub run summary), kept 30 days.

## 10. Done means
The preview was approved by the owner on real data; every AyekaBar dashboard screen is glass with the rules above, nothing lost from the
tool lists; the full QA suite runs on every push and every night, the 07:00 notification reaches the developer, and the report shows
expected and actual results for every test; all checks green (or every failure named with its reason); the guides (`docs/AYEKABAR_GLASS_UI.md`,
`docs/QA_BLUEPRINT.md`) and `handoff.md` written; the work on a branch waiting for the owner's go to merge and deploy.
