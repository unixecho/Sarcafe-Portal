# Sarcafe — cross-agent handoff

## Claude addendum, 2026-10-11 (latest): employee number + six-digit code sign-in broken by a duplicate SQL function — fix pushed, migration NOT yet applied to production

**Report.** The owner could not sign in with the six-digit code on several accounts.

**Cause (inferred, not seen in a log).** Migration `20261009120000` added `pos_verify_pin(text, text)` beside the original `pos_verify_pin(integer, text)`. Both are live in production with the same argument names, so the Supabase REST layer cannot choose between them for a JSON call (PGRST203) and `/api/auth/quick-login` answers with its generic server error. Supporting evidence: no row in `staff_employee_sessions` after 2026-10-09 14:36 UTC; the client form, route, rate limiter and `employee_code` data were all inspected and are fine. Vercel runtime logs (403) and Supabase API logs were not readable, so the PGRST203 text itself was never observed. `src/app/api/checklists/route.ts` (change passcode) calls the same function with the text code and is fixed by the same migration. The local PGlite suites never caught it because plain SQL resolves overloads that the REST layer rejects.

**Fix.** `supabase/migrations/20261011140000_drop_integer_pos_verify_pin.sql` drops `pos_verify_pin(integer, text)`; nothing depends on it (checked `pg_depend`). No application code changes. `scripts/verify-onboarding-sql.mjs` now fails if any function name has two signatures (allowlist: `sched_save_shift`, whose overload differs by argument name) and asserts `pos_verify_pin` has exactly one. 48 passed; `verify:schedule-sql` 334; `verify:checklist-sql` 11. `scripts/verify-pos-sql.mjs` fails at `20261008134751` (its fixture lacks `storage.buckets`) before reaching this migration; it is not in `package.json` and was already stale.

**Production state: NOT APPLIED.** Two `apply_migration` calls through the connector were declined at the permission prompt even after the owner asked in chat to apply it. Nothing in the database changed. **Exact next step:** apply `drop function if exists public.pos_verify_pin(integer, text);` to project `moiunkugxgsgbdokaxbr` (connector approval, or the Supabase SQL editor), then write the ledger row `20261011140000 / drop_integer_pos_verify_pin`, then try a number + six-digit login: a wrong code must show "wrong number or code", a right one must open `/staff`. Read back `select oid::regprocedure from pg_proc where proname='pos_verify_pin'` (expect one row, `(text,text)`).

**Naming guard for Codex.** `AGENTS.md` and `CLAUDE.md` (both now tracked) gained a "Database naming and migrations" section: timestamped migration names, domain prefixes (`sched_`, `pos_`, `staff_`, `checklist_`, `order_`), `p_` parameters, never overload a function, ids that can start with zero are `text`, service-role-only grants, and the pre-apply checklist.

## Claude addendum, 2026-10-11 (later): take-a-shift swaps, employee schedule, shareable poster, settings draft, per-day hours — LIVE (commit `1cc7785`), migration applied

**State.** Pushed to `main` as `1cc7785` (includes the earlier `.page-enter` scroll fix) after the owner approved both the production migration and the push. Migration `20261011120000_swap_take_requests.sql` was applied to Supabase project `moiunkugxgsgbdokaxbr` through the connector's SQL runner as one transaction and its ledger row `20261011120000 / swap_take_requests` was written by hand (statements field says it came from the connector, matching the earlier dashboard-run entries). Read back afterwards: `shift_swaps.direction` is `text default 'give'` with a `give|take` check, the function `sched_request_take` exists, and `sched_request_take`, `sched_respond_swap`, `sched_cancel_swap`, `sched_decide_swap` and `sched_request_swap` are executable by `service_role` only (browser roles denied). Production had zero swap rows before and after. The deployment is confirmed live indirectly (the Vercel connector lacks `godunix` scope and the CLI is not installed): the served stylesheet carries the `.page-enter ... backwards` fix, and harmless unauthenticated probes of `/api/shifts/dispatch` showed the server recognises `requestTake` (404 for a random assignment id) and `saveDraft` (401) while an unknown action is still a 400. Never record the test employee's address here: it is staff data.

**Requests and what was found.**
1. *Catch-up / swaps.* The test employee could not request any swap because they have no shifts and the existing flows start from the giver's own shift; colleagues' shifts offered only "request to join" (needs the manager to open a free slot). Production has no swap history at all, so nothing had ever been used. Implemented a **take** (ask the holder for their shift, nothing back) and an **offer one of mine** path from the colleague's shift; holder answers first, manager decides, schedule unchanged until approval. Details in `docs/STAFF_SCHEDULING.md`.
2. *Employee view.* Rebuilt (`EmployeeSchedule.tsx`, `StaffWorkspace.tsx`): large title, segmented tabs, next-shift hero with live countdown / in-progress state, sticky week strip, grouped day lists, one centred column on wide screens; `WeekGrid` is manager-only now.
3. *Share/PDF.* The white print table is replaced by a canvas-drawn brand poster (picture + one-page PDF via the phone's share sheet; download fallback), for the employee's own or everyone's week and from the manager's menu; `/owner/schedule/print` shows the same poster.
4. *Customer hours.* Verified the public pipeline reads `shift_settings` live with no caching and matched Maor's database row to the live API exactly. The reported staleness is explained by a per-day override: Maor's Sunday entry (07:00–19:00) silently beat the new usual hours (07:30–18:30) and today is Sunday. The editor is now one row per day with a live customer preview, written back from the whole week (`lib/shifts/hours-edit.ts`). Not proven: whether the owner also lost a change to the old 500 ms autosave, which dropped unsent edits on tab change.
5. *Draft system.* Every settings control (hours, days, safety, features, roles, stations, templates, roster flags, delegates) edits a local draft (`SettingsDraft.tsx`, `lib/shifts/draft.ts`) and one `saveDraft` request writes it; survives tab switch and reload; save bar shows what is unsaved. `updateSettings`/`setMember` remain server actions (used by `saveDraft`); `ShiftsProvider` no longer applies them optimistically. `StaffManager`'s single schedulable toggle on `/owner/staff` is unchanged on purpose.

**Files.** SQL: the migration above. Swaps: `src/lib/shifts/{actions,schema,dispatch-write,types,serialize,view,time}.ts`, `src/components/shifts/{TakeSheet,ShiftActionSheet,MyRequests,RequestsPanel}.tsx`. Employee: `EmployeeSchedule.tsx`, `StaffWorkspace.tsx`, `StaffScheduleShell.tsx`, `WeekGrid.tsx`. Share: `SchedulePoster.tsx`, `PrintView.tsx`, `src/lib/shifts/poster-{model,render,pdf}.ts`, the print page, `ScheduleWorkspace.tsx`, `ScheduleWorkspaceShell.tsx`. Draft/hours: `SettingsDraft.tsx`, `ManagerPanel.tsx`, `CatalogEditor.tsx`, `RosterPanel.tsx`, `ShiftsProvider.tsx`, `src/lib/shifts/{draft,hours-edit}.ts`. Styles: `schedule.css` (`.ew-*`, `.sch-hours*`, `.sch-savebar*`), `globals.css` (`.page-enter` fill). Tests/docs: `verify-schedule-sql.mjs`, `check-schedule.mjs`, `check-app-layout.mjs`, `check-intro.mjs`, `docs/STAFF_SCHEDULING.md`.

**Verification.** `npm run typecheck` clean; `check:intro` 448; `check:schedule` 234; `verify:schedule-sql` 333 (40 new); `check:app-layout` 237 (needs `TEST_BROWSER` set to Edge here, Playwright's own browser is not installed); `check:staff-access` 51; `check:pos-access` 37; checklist SQL 11; onboarding SQL 46. A production build of a scratch copy compiled. In that copy, with synthetic data and a headless Edge: the take flow end to end, hero in-progress state and countdown, share sheet PNG (1080 px wide) and PDF (structure verified), and 19 draft checks (nothing sent while editing, bar on every tab, reload restores with a note, one `saveDraft` on Save carrying only what changed, discard). **Not verified:** a real iPhone (Safari toolbar, native share sheet, WebKit's handling of the `.page-enter` transform), real Google sessions, the PDF in an actual viewer (Edge headless would not render it), the SQL on production data.

**Known limits / choices to revisit.** The PDF is one tall page (A4 wide, as tall as the week needs) so it reads well on a phone but prints small. A shift offered in return must be the asker's own, same branch, not started, and not overlapping. Cross-branch employees still cannot swap (swaps stay branch-scoped, as before). Draft restore is per browser tab (sessionStorage).

**Exact next step.** The owner (or a session with their authenticated browser) runs the pilot that nobody could do here: on an iPhone, load the live branch page and scroll to the bottom (the strip and the fixed picture), open `/staff/schedule` as the test employee, ask a colleague for tomorrow's shift (a take, and an exchange), accept it as the colleague and approve it as a manager, share the week from the hero and the manager menu (check the native share sheet and the PDF in Files), change Maor's hours in settings and confirm the customer page updates right after Save. If anything in this release misbehaves, the migration is backward compatible and does not need rolling back; revert the application commit instead.

## Claude addendum, 2026-10-11: legacy photo removed everywhere; picker rotates generated scenes per landing (live); fixed-backdrop scroll bug fixed locally (NOT pushed)

**State.** Commit `849acce` (the six backdrop files below) is on `main` and live: the user said "ship to main now" and the served stylesheet was confirmed to contain no image `url()` at about 09:43. The Vercel connector lacks `godunix` scope and the CLI is not installed, so Ready was inferred from the live CSS, not read from the deployment record. A second fix (see "iPhone scroll bug") is edited in the working tree of `integrate/pos-and-scheduling`, uncommitted and unpushed pending the user's go-ahead. No migration is involved.

**iPhone scroll bug (user report, same day).** On the live branch page the user saw the picture at the bottom of the screen while scrolling (screenshot taken before `849acce` went live). Two causes, found by measuring the live page: (1) before `849acce` the `.public-backdrop` element carried its own CSS `background-image` with `background-attachment: fixed`, which iOS Safari ignores, so an unshaded copy of the picture scrolled with the page and showed through under the Safari toolbar; `849acce` removed it. (2) Still present on the live site and confirmed in Chromium: `.page-enter` (the `template.tsx` wrapper) used `animation: ... both`, and Chromium keeps `transform: matrix(1, 0, 0, 1, 0, 0)` on it after the entrance finishes, which makes it the containing block of every `position: fixed` descendant. The backdrop picture and shade were therefore stretched over the whole page height (−502→812 at scroll 502) and scrolled with the content. Fix in `src/app/globals.css`: `.page-enter` fills `backwards` instead of `both` (the `.rise`/`.pop` rules already do), with the comment rewritten and a new `check-intro` assertion. Measured on the live page by injecting that one declaration: transform `none`; picture and shade exactly 0→812 at scroll 0 and 502. Whether iOS WebKit also leaves the identity matrix is not known, so the iPhone result is unverified. Side effect to watch: every page's `position: fixed` descendants now anchor to the viewport as the file's own comments always intended; check sheets, toasts and the schedule on a phone after release.

**Catch-up on Codex.** Everything in the Codex addenda below is on `main` and live: schedule publication fix, employee week and cross-branch published schedules (migration `20261010145257` applied), the generated branch scenes in `public/backdrops/` (12 WebP files: Maor and Givat Haviva, three scenes each, portrait and wide) and the 60 s crossfade polish. Gap found: the branch picker, `/login`, `/privacy`, `/accessibility`, `/no-access` and the menu loading shell still painted the legacy `/background.jpg` and `/background-wide.jpg` through the CSS fallback, because only the two branch pages mounted the scene component.

**Confirmed requirement.** The owner does not want the old background photo anywhere, and the branch picker must show a different generated picture on each landing.

**Implemented.**

- `PublicBackdrop` now always mounts `BranchBackdropScenes`. A supported branch slug gets its own three scenes; anything else gets a new `portal` pool that alternates all six pictures (Maor 1, Givat Haviva 1, Maor 2 …). The existing per-device cursor (`sarcafe:public-scene:v1:portal`, advanced on every mount) guarantees consecutive landings differ; returning to the picker via the logo or "change branch" also advances it.
- New `hold` prop on `PublicBackdrop` keeps plain ground and mounts no picture. `src/app/page.tsx` holds while `/api/branches` is still loading (so a returning visitor with a saved branch never sees a picker picture swapped for their branch's, and the picker cursor is not consumed). `src/app/menu/[branch]/loading.tsx` always holds because that shell cannot know the branch.
- The CSS fallback is now only `background-color: var(--bg)`: the legacy image and the per-branch first-scene fallbacks in `globals.css` are gone (their reason, hiding the legacy art, no longer exists).
- The first picture mounts only after `decode()` and then fades in over 1.2 s (`FIRST_REVEAL_S`), because the old photo painted straight from CSS and a late pop-in would have been a regression. The fade uses `fromTo` instead of a React-set opacity of 0 on purpose: `useGSAP` runs with `revertOnUpdate`, which restores the pre-tween inline style, and that must be "visible". A `revealed` ref separates the first reveal from the settled state; `mounted` ref keeps StrictMode's double effect safe. Automatic crossfade is unchanged (60 s interval, 4 s, incoming over a fully opaque outgoing).
- `scripts/check-intro.mjs`: five branch-scene assertions rewritten and four added for the new contract (hold, portal pool, decode-then-fade, loading shell holds, no CSS reference to the legacy files; plus the `.page-enter` fill, local only).

**Files changed.** `src/components/{PublicBackdrop,BranchBackdropScenes}.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `src/app/menu/[branch]/loading.tsx`, `scripts/check-intro.mjs` (all in `849acce`); the `.page-enter` fill change touches only `globals.css` and `check-intro.mjs` again, uncommitted. `public/background.jpg` and `public/background-wide.jpg` are now unreferenced by the app but deliberately left in place: `docs/intro-preview/build.mjs` still reads them. Delete or move them only together with that script.

**Verification.** `npm run typecheck` passed. `npm run check:intro` 447 passed, 0 failed for `849acce`, 448 with the `.page-enter` assertion. Production build of a scratch copy (stubbed `/api/branches`, dummy env, port 3099, since removed) exercised in the built-in browser: landings 1 to 6 advanced the cursor 0→5 and cycled Maor 1, Givat Haviva 1 … without repeats; opacity sampling showed the first reveal fading 0→1 over about 1.2 s; a saved-branch visitor only ever saw their branch's picture and the picker cursor stayed put; two consecutive 4 s crossfades had the outgoing picture at 1.00 throughout and left exactly one scene at 1.00 with no dips; `/privacy` rendered a generated scene, `backgroundImage` was `none` everywhere, console clean; screenshots at desktop and 375 px looked right. Not done: real iPhone or Android, the live site, reduced-motion on a device.

**Skills.** The taste pack was already installed project-level (`.claude/skills`, listed in `skills-lock.json`), so nothing was reinstalled. All six ponytail skills (`ponytail`, `-audit`, `-debt`, `-gain`, `-help`, `-review`; upstream `DietrichGebert/ponytail`, MIT, markdown only, rated Safe by the registry audit) were installed project-level with the same `skills` CLI; the core one is byte-identical to the copy Codex put in `~/.codex/skills`. **pstack: deliberately not installed.** It is Lauren Tan's plugin in `cursor/plugins` (`pstack/`, MIT, v0.15.17): 28 workflow skills plus 24 `principle-*` skills, written mainly for Cursor, and its entry skill `poteto-mode` is not discoverable by the `skills` CLI. The user chose "Skip pstack" when offered core-only or everything.

**Exact next step.** With the user's go-ahead, commit `src/app/globals.css` and `scripts/check-intro.mjs` only (leave the other dirty and untracked files alone), push to `main`, confirm the served stylesheet has `.page-enter{animation:page-in-from-left .32s var(--ease) backwards}`, then ask the user to refresh the branch page on the iPhone, scroll to the bottom and check the lower edge; also spot-check a sheet and the staff schedule on the phone.

## Codex addendum, 2026-10-11: branch backdrop transition polish ready for release

The user approved a direct `main` release. Selected Maor and Givat Haviva pages now use a generated branch image as the CSS fallback, so the legacy `/background.jpg` and `/background-wide.jpg` artwork cannot flash through while the dynamic scene loads or crossfades. Automatic changes run once per minute instead of every 14 seconds; the incoming image fades over the fully opaque outgoing image for four seconds, avoiding the mid-transition transparency dip. Refresh still advances the branch-local scene. The `ביקורות` cue has 16px more separation above it.

Verification: `npm run typecheck`, `npm run check:intro` (444/0), `npm run build`, and `git diff --check` passed. No migration is required. Existing unrelated dirty/untracked files remain preserved.

**Exact next step:** push the focused UI commit to `main`, wait for the production deployment to reach Ready, then verify both branch pages on the live mobile layout and leave the overnight device check to the owner.

## Codex addendum, 2026-10-11: employee week and public branch experience implemented locally

This release is live from application commit `ff9980e` on `main`. Vercel deployment `dpl_Fv52YadWgGt8t5FVPkC8YQN22LhB` reached Ready and serves `https://sarcafe-portal.vercel.app`. Production migration `20261010145257_cross_branch_published_schedule_access.sql` was applied through the authenticated Supabase SQL Editor and recorded in `supabase_migrations.schema_migrations`. A production verification query confirmed the ledger row, helper function, service-role execution, and browser-role denial. Existing unrelated dirty/untracked files remain preserved.

### Confirmed requirements and implemented behavior

- `/staff/schedule` now uses the available desktop width and always renders all seven days: seven columns on wide screens, two on tablets and one on phones. Employees get an explicit selector for every active permanent branch plus their assigned event branch, if any.
- Cross-branch permission is deliberately narrow. Active Google-linked staff may read frozen published schedules and request a shift whose published snapshot says it is open. Draft data, event branches, management, delegation, availability submission and fair-fill eligibility keep the original branch scope. Published snapshot state wins over an unpublished live open/closed edit.
- The employee request surface filters to open, future, unowned shifts and uses the exact empty state `אין כרגע משמרות פתוחות שדורשות עובדים.` Availability submission still closes on Tuesday; a separately published open-shift request remains usable after that cutoff.
- Owned shifts now present **מסירת משמרת** and **החלפת משמרת** as separate actions. Handover always sends no return shift and can be named or open to everyone. Exchange requires a named colleague and a return shift. Conflict and manager-approval rules are unchanged.
- The public portal has a localized, accessible seven-day opening-hours disclosure for each selected branch. Missing settings are distinguished from an intentionally closed day.
- Maor and Givat Haviva each have three new responsive scene pairs under `public/backdrops/` (wide and portrait, 12 WebP files total). The selected branch advances its scene on refresh and crossfades to the next preloaded scene every 14 seconds. Rotation pauses while hidden and does not cycle for reduced-motion visitors. The GSAP scene bundle loads only for the two supported branches; other public pages retain the existing fallback background. Customer branch and scene preferences use separate versioned local-storage keys.
- Public menu pages inherit the matching branch scene and the corrected configured/unconfigured hours status. Reviews retain their existing unboxed layout.
- The `ponytail` and `thermo-nuclear-code-quality-review` skills were installed into the user's Codex skills directory. `pstack` remains uninstalled because several unrelated projects use that name and the requested upstream has not been identified.

### Main files

- Employee schedule UI: `src/components/shifts/{AvailabilityPortal,MyRequests,ShiftActionSheet,SwapSheet,WeekGrid,StaffScheduleShell}.tsx`, `src/components/shifts/schedule.css`, `src/app/staff/schedule/page.tsx`.
- Published cross-branch boundary: `src/lib/shifts/{access,guard,dispatch-write,state-query}.ts`, the shifts state route, migration `20261010145257_cross_branch_published_schedule_access.sql`, and schedule verification scripts.
- Public portal: `src/app/page.tsx`, `src/components/{PublicBackdrop,BranchBackdropScenes,MenuView}.tsx`, public menu page, `src/lib/{branches,branches/server}.ts`, `src/lib/shifts/hours.ts`, `src/app/globals.css`, generated `public/backdrops/*.webp`, and intro checks.
- Documentation: this handoff and `docs/STAFF_SCHEDULING.md`.

### Verification

- `npm run typecheck` — passed.
- `npm run check:intro` — 442 passed, 0 failed.
- `npm run check:schedule` — 167 passed, 0 failed.
- `npm run verify:schedule-sql` — 292 passed, 0 failed; every migration applies in order and the new access path is privilege-tested.
- `npm run check:app-layout` — 173 passed with the installed Playwright Chromium runtime; seven-day responsive layout and swap payload contracts are covered.
- `npm run check:staff-access` — 51 passed.
- `npm run build` — passed after the complete integrated diff. Real Chrome smoke checks at 390 px and 1440 px rendered both branches, seven hours rows and no horizontal overflow. The final automated reload-persistence helper produced no output; cursor/persistence behavior was source-reviewed and statically checked instead.
- Production smoke test — `/`, both branch menu routes and the protected employee schedule responded correctly; the live Maor portal rendered its new backdrop and a seven-day opening-hours disclosure, while the signed-out schedule route redirected to login as expected.

**Exact next step:** run an authenticated two-branch employee pilot plus a customer refresh test on both Maor and Givat Haviva. Confirm a cross-branch open-shift request can be approved without exposing any draft or event schedule.

## Codex addendum, 2026-10-10: schedule publication fix, responsive saves and employee identity live

Application commit `fbeef6d` is on `main` and live through Vercel deployment `dpl_F5FymnhQ8nVQYKyxgE9HA4NJCBBR` at `https://sarcafe-portal.vercel.app`. Migration `20261009153126_staff_avatar_emoji.sql` was applied to production Supabase project `moiunkugxgsgbdokaxbr` through the authenticated SQL Editor and recorded in `supabase_migrations.schema_migrations`; a production query confirmed both the column and constraint. The pre-existing `.gitignore` modification and unrelated untracked skill/Graphify/native-store files remain untouched.

### Confirmed cause and implemented behavior

- Fixed the false “changes waiting to be published” banner. PostgreSQL stores `published_snapshot` rows with snake-case column names; the live board compared them as camel-case domain objects, so every published shift/person appeared changed. `serializeWeek()` now normalizes frozen shifts and assignments before comparison, and `requestsOpen` is included in the shift signature.
- Shift saves no longer wait for a second browser round trip. The guarded/atomic database write still runs first; its response now contains the authoritative changed shift and assignments, which the board paints immediately before a quiet full reconciliation. Settings/catalog edits retain debouncing, and roster permission/default-role/hour edits merge per employee during a 550 ms pause.
- Adding a person to a shift now chooses their explicit scheduling default, then a matching staff badge, template role, unmet role requirement, or first configured role. It remains editable before save.
- Every employee receives a stable branch-local schedule color. Optional self-selected emoji avatars appear on the profile and schedule. New private no-store route: `/api/staff/profile/avatar`; it resolves Google or number/PIN identity server-side and updates only that staff row. Migration `20261009153126_staff_avatar_emoji.sql` adds the nullable, constrained column and is applied remotely.
- The public accessibility widget is dynamically loaded only on customer routes and is absent on `/login`, `/owner`, `/staff`, `/pos`, `/checklists`, and `/no-access` (including nested routes).
- The proposed public portal visual polish was rejected and excluded from this release. Reviews retain the original unboxed flow, and branch pages retain the existing responsive illustrated backgrounds (`/background.jpg` and `/background-wide.jpg`).

### Main files

- Scheduling: `src/lib/shifts/{serialize,snapshot-diff,people,types}.ts`, `state-query.ts`, `src/components/shifts/{ShiftsProvider,ShiftSheet,RosterPanel,WeekGrid,StaffPickerSheet,ui}.tsx`, shift dispatch route and schedule tests.
- Avatar/profile: `src/lib/staff/avatar.ts`, records types/loader, `EmojiAvatarPicker.tsx`, `StaffRecordsView.tsx`, private avatar API route, records CSS and migration `20261009153126_staff_avatar_emoji.sql`.
- Public UI/accessibility: `PublicA11yWidget.tsx`, root layout and the updated intro/layout checks.
- Documentation: `docs/STAFF_SCHEDULING.md`, `docs/STAFF_RECORDS.md`.

### Verification

- `npm run typecheck` — passed.
- `npm run build` — passed; final production route manifest includes `/api/staff/profile/avatar`.
- `npm run check:schedule` — 165 passed, including a raw PostgreSQL snapshot regression, request-open diff, role inference and stable colors.
- `npm run verify:schedule-sql` — 281 passed; all migrations apply in order, including the new avatar migration.
- `npm run verify:onboarding-sql` — 46 passed.
- `npm run check:staff-access` — 51 passed.
- `npm run check:intro` — 430 passed after the accessibility wrapper rename.
- `npm run check:app-layout` — 161 passed in Playwright at 320/390/768/1760 px.
- `git diff --check` — passed (line-ending warnings only).
- Vercel build — Ready on Next.js 15.5.25; production alias attached.
- Live owner schedule — loaded successfully; the accessibility launcher is absent after hydration.
- Live Maor and Givat Haviva portals — both retain `background-wide.jpg`; review surfaces have no added background, border or radius.
- Post-deploy logs — no runtime errors and no 5xx responses in the release window.

**Exact next step:** run the authenticated owner pilot: publish an unchanged week and confirm the unpublished-change count returns to zero; add several paper-schedule shifts quickly and confirm the board stays responsive; add an employee and confirm their default role/color; then choose an emoji from `/staff/profile` and confirm it appears on the schedule. If a critical regression appears, restore the previous Ready Vercel deployment; the nullable avatar column is backward-compatible and does not need an emergency rollback.

## Codex addendum, 2026-10-09: onboarding, checklists, requests, RTL, staff roles and branch hub implemented locally

This release is live from application commit `1bfab0e` on `main`. Vercel deployment `dpl_72VWgbRWXzrxsmc945QNuemF6yUo` reached Ready and serves the production aliases including `https://sarcafe-portal.vercel.app`; a live `/login` request returned HTTP 200 and the post-deploy error-log scan returned no errors. Migration `supabase/migrations/20261009134321_onboarding_handover_owner_defaults.sql` was applied to production Supabase project `moiunkugxgsgbdokaxbr` through the authenticated SQL Editor and recorded as version `20261009134321`. A seven-signal production query confirmed the ledger row, function, both triggers, browser-role denials, and complete owner/developer scheduling defaults.

### Confirmed decisions and implemented behavior

- Removed the employee-side `profile_email` write completely. An unlinked number/PIN login now always returns `/staff/profile?setup=google`, regardless of its requested destination. The profile asks for the current six-digit PIN and starts the existing server-proof + PKCE Google OAuth flow. Only the verified Google callback writes the email and `auth_user_id`; owner-entered email is labeled contact-only. OAuth success/failure returns to the profile with visible feedback.
- Checklist synchronization now gives `handover` to both staffed shifts on a multi-shift day. Ordered employee display is `opening → handover → closing`, so the morning shift runs opening then handover and the afternoon shift runs handover then closing. Single-shift days remain opening + closing. Only pending assignments are remapped; in-progress/submitted evidence remains immutable.
- The owner checklist builder now supports form names, blank starts, restore-to-published, local draft persistence, add/reorder/duplicate/delete categories and checks, required/optional checks, number targets/units and server-side minimum-content validation. Publishing remains immutable and pending-only.
- The owner request experience is collapsed by default. Availability is separated into per-employee disclosures with a seven-day green/red/amber/neutral grid and a distinct notes callout. Pending join/swap decisions open in-place with approve/reject actions. A week-activity rail exposes every loaded week with pending requests or submitted availability so off-screen weeks are discoverable.
- Replaced mirrored schedule text glyphs with physical RTL week chevrons in manager, employee and availability views; removed directional text arrows from request prose and isolated partial-hour text.
- Staff now renders in visually separate management/operator and employee groups. Added `developer` / `מפתח/ת` as a display badge; server writes the established `owner` authorization role underneath, so it retains operator powers without displaying Owner. Selecting a non-owner badge removes that role through the same owner-only staff route.
- Owners/developers are unschedulable by default in TypeScript and in per-branch database rows. The migration backfills missing defaults and adds staff/branch triggers; explicit later toggles are preserved. A promotion into owner/developer resets scheduling off until explicitly enabled.
- Branch chip strips were replaced by a compact branch-context picker. The dashboard now has a dedicated branch-management hub with clear active-branch cards and links to schedule, employees and checklists. The once-per-login branch confirmation sheet remains.

### Main files changed

- Auth/onboarding: `src/app/api/auth/quick-login/route.ts`, `src/app/api/checklists/route.ts`, `src/app/auth/callback/route.ts`, `src/app/staff/profile/page.tsx`, `src/components/staff/StaffAccountActions.tsx`, `src/components/checklists/StaffChecklistWorkspace.tsx`.
- Checklists/migration: `src/lib/checklists/server.ts`, `src/components/checklists/OwnerChecklistWorkspace.tsx`, `src/app/api/owner/checklists/route.ts`, checklist CSS, `supabase/migrations/20261009134321_onboarding_handover_owner_defaults.sql`.
- Scheduling/requests/RTL: `PlanningPanel.tsx`, `RequestsPanel.tsx`, all three week navigators, `serialize.ts`, scheduling CSS and schedule/checklist verification scripts.
- Staff/branch UI: `StaffManager.tsx`, `StaffEditSheet.tsx`, `AddStaffSheet.tsx`, `badges.ts`, owner staff API, `BranchSwitcher.tsx`, `SelectSheet.tsx`, `DashboardLive.tsx`, global/records CSS.
- Domain docs updated: `docs/STAFF_ONBOARDING.md`, `docs/STAFF_CHECKLISTS.md`, `docs/STAFF_SCHEDULING.md`, `docs/STAFF_RECORDS.md`.

### Verification

- `npm run typecheck` — passed.
- `npm run build` — passed after running outside the restricted filesystem sandbox so Next could create nested `.next` folders.
- `npm run check:schedule` — 158 passed, 0 failed.
- `npm run verify:schedule-sql` — 280 passed, 0 failed; all migrations apply in order including the new successor.
- `npm run verify:checklist-sql` — 11 passed, 0 failed; includes two-sided handover, new-owner defaults, explicit opt-in preservation and developer-promotion reset assertions.
- `npm run verify:onboarding-sql` — 46 passed, 0 failed.
- `npm run check:staff-access` — 51 passed; includes unlinked redirect and linked station-return behavior.
- `npm run check:pos-access` — 37 passed.
- Playwright `1.64.0` and its Chromium runtime were installed. `npm run check:app-layout` — 161 passed after updating the synthetic navigation fixture. No authenticated iPhone walkthrough was performed.

Graphify was run against `src` (the whole repository exceeded its 500-file threshold); its untracked `graphify-out/` report identified the cross-cutting auth/schedule/UI nodes used for this pass. Existing unrelated dirty/untracked files were preserved, including the pre-existing `.gitignore` change.

**Exact next step:** run an authenticated two-branch pilot on production: skip Google during onboarding and re-link from PIN login, verify morning/afternoon checklist order, confirm owner/dev scheduling defaults, inspect off-week request indicators and availability colors, and check dashboard branch switching plus mobile Hebrew RTL arrows.

## Codex addendum, 2026-10-09: native fixed dashboard shell and request controls implemented locally

The requested `gpt-taste` dashboard refinement is live on production from commit
`9bbb40c` on `main`. Vercel deployment `dpl_J8dzDFb5yUm38Qqp1iyCXkcVeaNq` is
Ready on `https://sarcafe-portal.vercel.app`. The production schema changes were
applied through the authenticated Supabase SQL Editor on 2026-10-09 and migration
version `20261009120000` was recorded with the user's explicit approval.

- Owner and staff pages now share a fixed safe-area-aware iOS-style top bar with a
  role-aware menu that drops from the top. Route loading retains the same chrome
  and shows a small progress hairline. The employee home leads with the next
  published shift and its station/zone before notifications and secondary tools.
- Schedule/staff/POS transient notices use one fixed top location with a rounded,
  blurred iOS-style container, top-down entrance and timed fade. Person/name chips,
  avatars and staff rows use more native grouped rounded-rectangle treatment.
- Direct requests to join a shift are opt-in per shift and closed by default. The
  owner controls this in the shift editor; employees see open/closed labels on both
  published and planning schedules. SQL rejects a closed request even if the API is
  called directly. Existing hand-over, give-up-with-no-return and exchange flows
  remain available for an employee's own shift.
- HYP employee identifiers now have a canonical text `employee_code`, preserving
  leading zeroes such as `0849` through creation, invitations, records, checklists,
  POS and quick login. The old integer column and numeric login payloads remain as
  compatibility paths.
- New production migration: `20261009120000_native_dashboard_shift_requests_employee_codes.sql`.
  It adds `staff.employee_code`, `shifts.requests_open`, service-only text-code
  login/update RPCs and an atomic shift-save overload/request guard.
- Verification: typecheck passed; production build passed (required host filesystem
  access for generated `.next` folders); schedule model 156/0; scheduling SQL 279/0;
  onboarding/auth/storage SQL 46/0; checklist SQL 8/0; staff access 50; POS access 37.
  `check:app-layout` remains blocked by the pre-existing missing `playwright` module.

Live verification after the SQL Editor run: no missing employee codes or null
request flags; browser roles cannot call text-code login; service role can call the
guarded request function but not its internal helper; both new service RPCs and the
shift-save overload exist. The connector migration call expired and the CLI account
lacked project-link privileges, so the matching migration-history row was recorded
manually after explicit user approval and then read back successfully.

Live application verification: production deployment is Ready with no alias error;
the authenticated `/owner/staff` page loaded the new fixed header and the owner menu
exposed all expected management destinations. The post-deploy Vercel error-log scan
returned no errors. Unrelated local files remain untouched and uncommitted.

**Exact next step for this local slice:** the owner performs the live iPhone pilot: login
with a leading-zero HYP code, open exactly one shift for requests, verify closed
shifts reject requests, and verify hand-over/exchange still work.

Last updated: 2026-10-09 (Asia/Jerusalem). Author: ChatGPT / Codex. A Claude addendum on the shipped Sarcafe intro and the store-readiness work follows "Current state".

Interactive concept preview: `C:/Users/Johnathan/.codex/visualizations/2026/10/07/01a117c0-6236-7402-a111-af490b29f94e/sarcafe-checklist-preview.html`. The corresponding first production slice is now implemented locally in the Sarcafe app; the preview itself remains a standalone concept.

## Current state

**Latest release work, 2026-10-08: employee onboarding, records/payslips, fair weekly planning and iOS-style staff/owner polish are implemented, migrated and live in production.** This supersedes older behavior below where it differs. The earlier checklist release remains live. User requested `$gpt-taste`; operational app layouts use compact grouped rows, system/Geist typography, safe-area spacing, accessible 44px navigation, short GSAP reveals and reduced-motion support. No unrelated Sarcafe intro implementation was added; preserve Claude's preview/spec below.

- Owner creates first/last name and manually HYP-matched employee number, receives a seven-day single-use copyable setup link, and may regenerate/revoke it. Employee chooses a six-digit PIN and optionally proves a Google account, linked atomically to the original staff UUID. Older email-based invites cannot bypass token onboarding.
- Google is required for scheduling, quick orders and payslips. PIN is for checklists and event POS. New PIN logins always use opaque cookies, including Google-linked people; historical quick JWTs remain restricted by retained markers and the new database assurance migration. Switching employees clears the previous browser identity.
- Categorized owner/staff dashboards include scoped, polling in-app notifications. Owner employee records include published shift history, checklist reports/defects, event orders and private payslip upload. Regular cashier/attendance statistics await HYP; scheduled shifts are not attendance. See `docs/STAFF_RECORDS.md` for limits and permissions.
- Scheduling closes planning submissions after the preceding Tuesday in Jerusalem. Owner can prepare shift choices from templates, approve requests, place staff on a seven-day board, fill missing positions while preserving manual assignments, and publish. Filling prioritizes Saturday fairness over a 12-week history and respects availability/rest/hours/conflicts. Existing peer-acceptance then manager-approval swap transaction is preserved and tested. See `docs/STAFF_SCHEDULING.md`.
- Explicit owner assignment to an active event station permits a branch employee to work that event without changing their home branch or granting event management. Station links infer their authorized event and survive login. Opaque event reads use a bounded, guarded server API plus polling; browser grants are not widened. Back uses explicit parents; Home leads to `/staff`, which resolves a full owner to the owner dashboard. Print and nickname gates now provide exits.
- Four migrations are live in production in this order: `20261008134712_employee_invites.sql`, `20261008134738_schedule_planning_fair_fill.sql`, `20261008134751_staff_records_payslips.sql`, `20261008134807_staff_auth_assurance.sql`. Verification confirmed all three required tables, all three release-critical functions, and the private payslip bucket. Vercel application deployment `dpl_7GDgXCLPSo459PMVwr4hVnaf44Qq` is Ready and promoted from release commit `f72babe`; the follow-up documentation commit `48c54de` is also on `main` and its production deployment `dpl_7Q9HTcRu1ThHxQ9GB1Phwxeu1Nfk` is Ready. Historical checklist migration remains live as `20261008050857_branch_checklists.sql`; do not replay it.
- Verified: typecheck; scheduling model 156/0; scheduling SQL 277/0; checklist SQL 8/0; onboarding/auth/storage SQL 45/0; POS access 37 checks; staff private routes/session switching 50 checks; real component/browser layout 141 checks. Final production build passed after event membership, mobile upload controls and role-aware Google landing refinements; diff hygiene passed. Layout previews use synthetic data in `.codex/verification/app-polish`; desktop Chrome in a fresh isolated context, not real iOS or production staff authentication. CUA helper remained unavailable; host shell and fresh headless Chrome worked.
- Main additions: `src/components/app`, onboarding and records components/routes, private staff APIs, `src/lib/staff` identity/invitations/history/navigation, guarded POS read bridge, scheduling planning panel/action/RPC, and the four migrations. Shared `OwnerHeader`, middleware/login/callback, POS clients and owner/staff layouts also changed. Preserve all pre-existing checklist and other-session files.

**Exact next step for this latest slice:** perform the authenticated owner/employee pilot and real Safari home-screen check in `docs/STAFF_RECORDS.md`. Google provider/redirect configuration is required as in the existing app. Offline staff operation and native-store packaging remain future work.

**The schedule-linked checklist feature, developer test mode, QR entry flow, grouped iPhone-style employee runner and production Supabase migration are live.** Migration `branch_checklists` remains production version `20261008050857`. Vercel deployment `dpl_H25Mn98FoLs6pdXYZzT2gxjgqr3r` is READY and promoted at `https://sarcafe-portal.vercel.app`. No commit or push was performed. Read `docs/STAFF_CHECKLISTS.md` for the implementation contract and pilot steps, and `chatGPT/MOBILE_APP_ROADMAP.md` before native Android/iOS work.

Repository: `C:/Users/Johnathan/Desktop/sarcafe`; local branch `integrate/pos-and-scheduling`; release commit `f72babe` is on `origin/main`. Preserve pre-existing untracked `.agents/`, `.claude/skills/`, `skills-lock.json`. Check current status before starting: another Claude session may have progressed since this handoff.

## Claude addendum, 2026-10-09: Sarcafe intro SHIPPED to main; store readiness in progress

**The intro is live.** Commit `a061354` on `main` (fast-forward on top of `48c54de`), deployed by Vercel from main and checked on `https://sarcafe-portal.vercel.app`. The user lifted the earlier hold explicitly ("push the intro to main"), so the `INTRO PORT MAY START` marker is no longer needed. Read `docs/SARCAFE_INTRO.md`.

- **What it is.** The portal's opening screen: dark screen, the cream badge warming like a cafe lamp, two lines word by word, then the page. About 5 s on a device's first visit (string lights and steam), about 3 s after. Tap, key or scroll skips. Ten lines in he/en/ar; a device sees line one first, then a different line each visit. `src/lib/intro/`, `src/components/intro/`, `src/components/IntroCard.tsx`, `src/app/owner/intro/`, `src/app/api/owner/intro/`.
- **Where it plays.** `/` always; `/order` only inside the installed customer app (`data-entry="app"`, hidden by CSS unless `display-mode: standalone`). Not the menu, order tracking, login, staff, owner or POS.
- **Owner switch.** `/owner/intro` (tile on the owner dashboard): on/off, a preview of each version and of every line. The `intro_enabled` row is upserted public by the route, so there is **no migration**. Only an explicit `false` turns it off; the read is time-boxed to 1.5 s and fails open.
- **Shared files I edited (small, for your next pull).** `src/app/layout.tsx` (one import and `<IntroGate />` after `#a11y-scope`, before the accessibility widget; keep it outside `#a11y-scope`), `src/middleware.ts` (`/owner/intro` added to the owner-only list), `src/app/owner/dashboard/page.tsx` (one tile and icon import), `src/lib/settings/keys.ts` and `server.ts` (the key and `getIntroEnabled()`), `package.json` (`check:intro`). Your checkout was fast-forwarded to `a061354`; your uncommitted `.gitignore` and `handoff.md` edits were left alone.
- **Verified.** `npm run check:intro`: 430 passed. Typecheck and production build pass. The built app against a stand-in settings endpoint (never the real database) for on, off, missing row, `"false"`, `0`, a 500 and a hang: off removes it on `/` and `/order`; the junk and failure cases leave it on; a hanging read costs the page about 1.5 s. Live smoke test after deploy: overlay on `/` (`site`) and `/order` (`app`), none on `/menu/*` and `/login`, `/owner/intro` redirects signed out, `/api/owner/intro` returns 401, the logo is served optimized (8 KB). `npm run check:pos-access`-style checks I ran (`check-pos-access` 37, `check-staff-access` 50) still pass; `scripts/check-app-layout.mjs` fails with MODULE_NOT_FOUND on the shared checkout too (a module not installed here), unrelated to the intro.
- **Not verified.** A real iPhone or Android phone; the installed-app entry on a really installed PWA (the CSS gate is tested, the install is not); a screen reader.
- **Copy to confirm with the owner.** Line one is the owner's. Lines 2 to 10 were written by Claude in the same spirit; lines 5 and 6 name pastries, shakes and hot or cold coffee. English and Arabic are translations.
- **For the native track (`chatGPT/MOBILE_APP_ROADMAP.md`).** The intro's standby frame is the contract for the iOS launch screen and the Android 12+ splash. A WebView shell is not `display-mode: standalone`, so the `/order` entry would not fire there: decide the shell's start URL. `public/sarcafe-logo.png` cannot be used for store icons (hard 1-bit alpha, checkerboard colours under the transparency, 847 KB; App Store icons must be opaque).

**Store readiness (Apple App Store and Google Play): researched, decisions file written.** Research and documents only; no app code, no migration, no store account action. `docs/NATIVE_STORE_DECISIONS.md` lists 13 decisions with recommendations and defaults, the inputs needed from the owner, and the questions for an accountant or lawyer. It builds on `chatGPT/MOBILE_APP_ROADMAP.md` items 3 to 6 and feeds your Capacitor-versus-React-Native decision rather than replacing it. Headline findings for you: an osek must enroll with Apple as an Individual (personal name public); an iPhone build needs a cloud macOS builder, not a Mac (Xcode Cloud cannot be the first route); Google OAuth is blocked in embedded web views and web push does not exist in WKWebView; Apple 4.8 makes Google login on iPhone require Sign in with Apple unless the iOS build is PIN-only (recommended first release); 4.2 is the main rejection risk, so staff/owner app first and the customer side stays a PWA. The detailed phase checklist will be built from the owner's answers. The research notes are in the Claude session record, not in the repo.

**Exact next step.** The owner reads `docs/NATIVE_STORE_DECISIONS.md` and answers it (D1, D3 and D5 unblock the most). Separately, the owner can open `/owner/intro` to read and preview the ten lines and strike or reword any (words live in `src/lib/intro/copy.ts`; the harness pins line one).

## Read next

1. `chatGPT/CHECKLIST_PLAN.md` — complete product/UX/auth/data/API/implementation/verification plan, updated with user answers.
2. `chatGPT/CHECKLIST_CONTENT_HE.md` — all 41 original checklist items mapped to Hebrew categories: 22 opening, 3 handover, 16 closing. Counts are original requirements, not necessarily final answer-card counts.
3. `chatGPT/CODEBASE_FINDINGS.md` — inspected current behavior, source paths, live DB findings and access limitations.
4. `chatGPT/SESSION_LOG.md` and `chatGPT/README.md` — continuity and validation.
5. Existing `docs/STAFF_SCHEDULING.md` and `docs/POS_BLUEPRINT.md` before touching those domains.

Root `CLAUDE.md` now instructs Claude sessions to read this handoff first and update it at the end. Existing Claude files were not overwritten.

## Confirmed user requirements

- Employee checklists and friendly owner builder, first for Givat Haviva, editable/copyable for other branches; everything in Hebrew/RTL and fast on phones, with iOS-like continuity.
- Visual standard for the SaaS: use the shared Sarcafe dark design system with compact app navigation, clear hierarchy, large touch targets and polished iPhone-like flow; avoid oversized single-question cards and generic browser-form layouts. The grouped checklist runner is the current reference implementation.
- Opening, handover and closing grouped by categories. Per machine/product: `תקין` / `לא תקין`; every failure requires reason. Employee reviews/attests all defects/reasons at the end. Missing inventory/unclean cart must be reported to manager.
- Owner can edit categories, instructions, products (including shake varieties), required steps, order/flow, branch conditions and targets. Publishing must not rewrite past/running reports.
- Owner creates an initially nameless employee draft in `/owner/staff`, then fills first/last name, nickname, optional email/phone and assigned employee number matching HYP for easy remembering. HYP matching is manual; no automatic HYP integration was requested.
- **First employee login must work with employee number + six-digit code WITHOUT Google/email.** After login, employee can optionally add email and use the existing Google sign-in option, or keep number/code. Do not preserve the old one-time-Google prerequisite.
- Owner can manually define OR randomly generate six-digit code. Original request also allows manager and employee code setup; design explicit scoped manager authority and recent credential verification for employee self-change.
- **Initial reports are a dedicated Sarcafe checklist inbox with noticeable owner-panel gap signal**, no push/WhatsApp for now. Unread and unresolved-gap counts are different.
- Cash target: Givat Haviva 500 NIS, Maor 400 NIS. Cushion/tent task only Maor. Pastries two per type, cup spare sleeves three per item, spare drinks at least three trays.
- Preserve continuity with Claude through this file and `chatGPT/`.

## Implemented in this slice

- Migration `supabase/migrations/20261008050857_branch_checklists.sql`: immutable template versions, schedule-linked assignments/submissions, issue evidence, manager seen/resolved state and service-only employee sessions. The filename now matches the live migration ledger.
- Published schedules generate forms per exact shift assignment: first shift gets opening, every shift followed by another shift gets handover, final shift gets closing; a one-shift day gets opening + closing. Republish removes stale pending requirements.
- `/staff/checklists`: Hebrew category runner with an iPhone-style compact app shell, sticky progress/action areas, grouped related checks, category-level save/resume, mandatory reason for every individual failure or target mismatch, review and final attestation. Grouping is presentational: evidence remains per machine/product for manager reporting.
- `/owner/checklists`: unresolved issue inbox, exact per-shift submission tracking, editable builder and deliberate version publishing. Owner dashboard shows unresolved checklist count.
- `/owner/staff`: nameless drafts, HYP-matched employee number, random or owner-chosen six-digit PIN, and first number/PIN login without Google/email.
- Number/code employees can add email later, keep using the code, and change their own code after proving the old one.
- Dedicated staff PWA manifest plus one-time Android/iOS Add to Home Screen introduction.
- Credential limiter now fails closed. Quick-session marker retention closes the previously documented privilege-classification gap.
- A production-configured developer account receives non-persistent opening/handover/closing previews on `/staff/checklists`, even without an assigned shift. Preview submissions never enter real shift records or the owner inbox. The allowlist is a sensitive Vercel setting and personal account data is not stored here.
- Owner quick login lands on a restricted `/owner/dashboard` launch screen with employee-checklist access; privileged owner pages and API mutations still require Google authentication.
- Owner checklists include a stable QR entry link (`/login?next=/staff/checklists&quick=1`) with copy, test and downloadable high-correction QR PNG actions.
- Builder form styles load reliably and use labeled, responsive dark cards. The install introduction uses the shared mobile-sheet/desktop-dialog layout.
- Six-digit codes are enforced in the owner prompt and again by the server schema/database function. Quick login uses fail-closed 15-minute IP, employee and IP+employee limits plus a 24-hour employee limit, HMAC-obscured limiter keys, generic errors and failure jitter.

## Historical gaps addressed

1. Number/PIN no longer requires linked Auth/email for staff checklist routes; manual PIN and nameless draft creation are implemented.
2. Quick-session markers are retained for a conservative 90-day minimum and are not deleted on PIN rotation/sign-out classification checks; an old floor token cannot become an owner-capable session by losing its marker.
3. Credential verification uses a separate fail-closed limiter while unrelated operational rate limits keep existing behavior.
4. UID-first access is implemented as a service-only opaque employee session cookie with a hashed token and shared server identity resolver. Existing Supabase browser Realtime/Data API permissions were not relaxed.
5. Optional later Google linking must bind verified identity to the SAME staff UUID/history via server-stored link intent; entering an email alone proves nothing. The plan assumes email login means existing Google OAuth, not a newly requested password/OTP system.
6. Checklist access must not depend on event POS being enabled, event session, or POS nickname confirmation. Scheduling-manager delegation must not silently grant builder/code authority.

## Release order

Supabase migration, advisor review, Vercel production deployment and public-route verification are complete. Remaining: authenticated owner/employee Givat Haviva pilot. Offline queue/background retry remains a later PWA hardening task and is recorded in the mobile roadmap.

## Verification

- `npm run typecheck` — passed.
- `npm run check:schedule` — 150 passed, 0 failed.
- `npm run verify:schedule-sql` — 233 passed, 0 failed; local PGlite fixtures, not production writes.
- `npm run verify:checklist-sql` — 8 passed, 0 failed; all migrations apply locally and mapping/remapping, template versioning, pre-Google PIN login, PIN rotation/session revocation and browser-role denial are covered.
- `npm run build` — passed; employee/owner pages and APIs appear in the production route manifest.
- `git diff --check` — passed (line-ending warnings only).
- Production follow-up checks: staff manifest and onboarding returned HTTP 200; protected staff and owner routes returned expected 307 redirects; the station link preserved its full return target; a five-digit quick code was rejected with HTTP 400 and a passcode field error; deployment runtime error query was empty.

## Connected environment / limitations

- Supabase `moiunkugxgsgbdokaxbr`, Sarcafe Portal, eu-central-1. Migration `branch_checklists` is applied as production version `20261008050857`. Verification confirmed all three tables, the schedule trigger, and denied `anon`/`authenticated` reads. Branch slugs `givat-haviva`, `maor`; code resolves generated IDs dynamically.
- Supabase advisors ran after migration. The new checklist/session tables intentionally report RLS-with-no-policy because all browser grants are revoked and access is service-only. Advisors also report existing project-wide security/performance findings, including security-definer views/functions and unindexed foreign keys; none exposed the new checklist RPCs to browser roles.
- Vercel project `sarcafe-portal`, id `prj_KnRE1xTqicjPpuJcRZD6AcE6gCDk`, scope `godunix` / `team_FAQr1BGFf7wK7JCIVr0n9sPl`. Application deployment `dpl_7GDgXCLPSo459PMVwr4hVnaf44Qq` from commit `f72babe` reached Ready and was promoted on 2026-10-08. Final main deployment `dpl_7Q9HTcRu1ThHxQ9GB1Phwxeu1Nfk` from documentation commit `48c54de` is Ready on the production alias. Live staff checklist smoke test returned the expected unauthenticated 307 with its quick-login return path. Earlier manifest/login/owner-route/code-validation smoke checks remain valid.
- Sandbox shell and Node/browser helper failed startup. Host shell recovery succeeded after automatic review; browser runtime remained unavailable. No authenticated live staff-page walkthrough. Use supplied screenshot + inspected source for current UI evidence, then verify in browser when runtime available.
- Requested skills/connectors used as applicable: Supabase/Vercel read-only, UI/UX targeted guidance. Static employee flow documented with Mermaid; no prototype/app implementation generated. No delegated agents.

## Main files changed or added

See Git status for the full set. Start with `docs/STAFF_CHECKLISTS.md`, the checklist migration, `src/app/api/checklists`, `src/app/api/owner/checklists`, `src/components/checklists`, `src/lib/staff/session.ts`, staff/owner route entries, and the auth/staff-panel changes. Continuity files include `CLAUDE.md`, this handoff, `chatGPT/README.md`, `chatGPT/SESSION_LOG.md`, and `chatGPT/MOBILE_APP_ROADMAP.md`.

## Exact next step

Run the onboarding/scheduling/swaps/private-documents and real Safari home-screen pilot in `docs/STAFF_RECORDS.md`, together with the earlier checklist defect/coverage pilot in `docs/STAFF_CHECKLISTS.md`. Local component visual checks now pass in fresh headless Chrome; authenticated production and real iOS verification remain outstanding. Future native assignments start from `chatGPT/MOBILE_APP_ROADMAP.md` after this PWA pilot. Preserve Claude's separate intro preview pending user review.

At each session end update this handoff with implemented/deployed state, migrations, evidence, decisions and exact next step. Keep proposed behavior separate from shipped behavior and never store codes/secrets here.
