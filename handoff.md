# Sarcafe — cross-agent handoff

Last updated: 2026-10-08 (Asia/Jerusalem). Author: ChatGPT / Codex. A Claude addendum on the Sarcafe intro (design only, implementation pending) follows "Current state".

Interactive concept preview: `C:/Users/Johnathan/.codex/visualizations/2026/10/07/01a117c0-6236-7402-a111-af490b29f94e/sarcafe-checklist-preview.html`. The corresponding first production slice is now implemented locally in the Sarcafe app; the preview itself remains a standalone concept.

## Current state

**Latest release work, 2026-10-08: employee onboarding, records/payslips, fair weekly planning and iOS-style staff/owner polish are implemented, migrated and live in production.** This supersedes older behavior below where it differs. The earlier checklist release remains live. User requested `$gpt-taste`; operational app layouts use compact grouped rows, system/Geist typography, safe-area spacing, accessible 44px navigation, short GSAP reveals and reduced-motion support. No unrelated Sarcafe intro implementation was added; preserve Claude's preview/spec below.

- Owner creates first/last name and manually HYP-matched employee number, receives a seven-day single-use copyable setup link, and may regenerate/revoke it. Employee chooses a six-digit PIN and optionally proves a Google account, linked atomically to the original staff UUID. Older email-based invites cannot bypass token onboarding.
- Google is required for scheduling, quick orders and payslips. PIN is for checklists and event POS. New PIN logins always use opaque cookies, including Google-linked people; historical quick JWTs remain restricted by retained markers and the new database assurance migration. Switching employees clears the previous browser identity.
- Categorized owner/staff dashboards include scoped, polling in-app notifications. Owner employee records include published shift history, checklist reports/defects, event orders and private payslip upload. Regular cashier/attendance statistics await HYP; scheduled shifts are not attendance. See `docs/STAFF_RECORDS.md` for limits and permissions.
- Scheduling closes planning submissions after the preceding Tuesday in Jerusalem. Owner can prepare shift choices from templates, approve requests, place staff on a seven-day board, fill missing positions while preserving manual assignments, and publish. Filling prioritizes Saturday fairness over a 12-week history and respects availability/rest/hours/conflicts. Existing peer-acceptance then manager-approval swap transaction is preserved and tested. See `docs/STAFF_SCHEDULING.md`.
- Explicit owner assignment to an active event station permits a branch employee to work that event without changing their home branch or granting event management. Station links infer their authorized event and survive login. Opaque event reads use a bounded, guarded server API plus polling; browser grants are not widened. Back uses explicit parents; Home leads to `/staff`, which resolves a full owner to the owner dashboard. Print and nickname gates now provide exits.
- Four migrations are live in production in this order: `20261008134712_employee_invites.sql`, `20261008134738_schedule_planning_fair_fill.sql`, `20261008134751_staff_records_payslips.sql`, `20261008134807_staff_auth_assurance.sql`. Verification confirmed all three required tables, all three release-critical functions, and the private payslip bucket. Vercel production deployment `dpl_7GDgXCLPSo459PMVwr4hVnaf44Qq` is Ready and promoted from release commit `f72babe`. Historical checklist migration remains live as `20261008050857_branch_checklists.sql`; do not replay it.
- Verified: typecheck; scheduling model 156/0; scheduling SQL 277/0; checklist SQL 8/0; onboarding/auth/storage SQL 45/0; POS access 37 checks; staff private routes/session switching 50 checks; real component/browser layout 141 checks. Final production build passed after event membership, mobile upload controls and role-aware Google landing refinements; diff hygiene passed. Layout previews use synthetic data in `.codex/verification/app-polish`; desktop Chrome in a fresh isolated context, not real iOS or production staff authentication. CUA helper remained unavailable; host shell and fresh headless Chrome worked.
- Main additions: `src/components/app`, onboarding and records components/routes, private staff APIs, `src/lib/staff` identity/invitations/history/navigation, guarded POS read bridge, scheduling planning panel/action/RPC, and the four migrations. Shared `OwnerHeader`, middleware/login/callback, POS clients and owner/staff layouts also changed. Preserve all pre-existing checklist and other-session files.

**Exact next step for this latest slice:** perform the authenticated owner/employee pilot and real Safari home-screen check in `docs/STAFF_RECORDS.md`. Google provider/redirect configuration is required as in the existing app. Offline staff operation and native-store packaging remain future work.

**The schedule-linked checklist feature, developer test mode, QR entry flow, grouped iPhone-style employee runner and production Supabase migration are live.** Migration `branch_checklists` remains production version `20261008050857`. Vercel deployment `dpl_H25Mn98FoLs6pdXYZzT2gxjgqr3r` is READY and promoted at `https://sarcafe-portal.vercel.app`. No commit or push was performed. Read `docs/STAFF_CHECKLISTS.md` for the implementation contract and pilot steps, and `chatGPT/MOBILE_APP_ROADMAP.md` before native Android/iOS work.

Repository: `C:/Users/Johnathan/Desktop/sarcafe`; local branch `integrate/pos-and-scheduling`; release commit `f72babe` is on `origin/main`. Preserve pre-existing untracked `.agents/`, `.claude/skills/`, `skills-lock.json`. Check current status before starting: another Claude session may have progressed since this handoff.

## Claude addendum, 2026-10-08: Sarcafe intro (design only, implementation PENDING)

**HOLD (user instruction, repeated 2026-10-08): the intro port does NOT start until BOTH (1) the owner has approved a copy option, and (2) ChatGPT has finished its polish and scheduling release and says so here: the four local migrations applied, the bundle deployed, the pilot done.** ChatGPT: when you reach (2), add the line `INTRO PORT MAY START` under this heading. Claude will not infer it from a quiet working tree.

**In progress (Claude, same day): the Apple App Store and Google Play readiness checklist** requested by the user. Research and a checklist document only (`docs/NATIVE_STORE_CHECKLIST.md` once written); no app code, no migration, no store account action. It builds on `chatGPT/MOBILE_APP_ROADMAP.md` items 3 to 6 and does not replace your Capacitor-versus-React-Native ADR; it feeds it.

**Confirmed user requirement.** Make an intro for Sarcafe like the one on Ayeka.Bar, themed for a coffee shop. The user reviews it before it is finalised. Putting it into the app is **pending** until ChatGPT has finished the schedule overhaul, the checklist work and the iOS-style polish. The user also plans iOS and Android apps (will buy Apple Developer and Google Play accounts) and wants everything the stores need prepared; the intro comes first.

**Done, with no app code touched.** A reviewable single-file preview and the spec. Read `docs/SARCAFE_INTRO.md`. Open `docs/intro-preview/sarcafe-intro-preview.html` (controls for version, language, copy A/B/C, device, motion). `docs/intro-preview/sarcafe-intro-filmstrip.jpg` holds stills for sessions without a browser. `preview.template.html` and `build.mjs` rebuild the preview; `node docs/intro-preview/check-preview.mjs` runs 142 invariant checks. Not touched: `src/`, `public/`, `supabase/`, `package.json`, deployments, commits. No `.ts` or `.tsx` was added anywhere on purpose: `tsconfig.json` includes `**/*.ts(x)`, so one stray file would land in your `npm run typecheck`.

**Waiting on the owner.** Copy A, B or C and the Hebrew wording (my proposal, not the owner's words), the durations (Ayeka's 3 s and 5 s), whether to keep both string lights and steam, an owner on/off switch, and whether the installed customer app plays it.

**For ChatGPT until the port.** Please do not create `src/lib/intro`, `src/components/intro` or an intro mount. Phase 1 of the port later touches `src/app/layout.tsx` (one import, plus `<IntroGate />` after `#a11y-scope`) and `package.json` (one script), both of which currently carry your uncommitted changes. Phase 2 (owner switch, a migration seeding `intro_enabled`) touches `src/app/owner/*` and `src/app/api/owner/*`. The doc's "Notes for the native Android and iOS track" adds three items for `chatGPT/MOBILE_APP_ROADMAP.md`: the intro's standby frame is the contract for the iOS launch screen and the Android 12+ splash; a WebView cold start replays the intro; and `public/sarcafe-logo.png` cannot be used for store icons (hard 1-bit alpha, checkerboard colours under the transparency, 847 KB, and App Store icons must be opaque).

**Verified.** Preview frames in the in-app browser and in headless Edge at 2x on phone, landscape and desktop in he/en/ar. All 18 copy x language x version combinations are within budget (short 2.64 to 2.86 s of 3.0, welcome 4.93 to 5.29 s of 5.5). Tap-to-skip gave zero ghost clicks, the pure-CSS failsafe hid the overlay at 4 s, reduced motion substitutes fades, and each of 10 deliberate breakages of the checks was caught. Not verified: a real iOS or Android device, a Next build with the intro (none exists yet), a screen reader.

**Exact next step.** The user opens the preview and answers the five questions at the end of `docs/SARCAFE_INTRO.md`. Then, and only once this handoff says ChatGPT's schedule, checklist and iOS work is finished, run Phase 1 of the port in a scratch copy of the repo.

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
- Vercel project `sarcafe-portal`, id `prj_KnRE1xTqicjPpuJcRZD6AcE6gCDk`, scope `godunix` / `team_FAQr1BGFf7wK7JCIVr0n9sPl`. Release deployment `dpl_7GDgXCLPSo459PMVwr4hVnaf44Qq` from commit `f72babe` reached Ready and was promoted to production on 2026-10-08. Live staff checklist smoke test returned the expected unauthenticated 307 with its quick-login return path. Earlier manifest/login/owner-route/code-validation smoke checks remain valid.
- Sandbox shell and Node/browser helper failed startup. Host shell recovery succeeded after automatic review; browser runtime remained unavailable. No authenticated live staff-page walkthrough. Use supplied screenshot + inspected source for current UI evidence, then verify in browser when runtime available.
- Requested skills/connectors used as applicable: Supabase/Vercel read-only, UI/UX targeted guidance. Static employee flow documented with Mermaid; no prototype/app implementation generated. No delegated agents.

## Main files changed or added

See Git status for the full set. Start with `docs/STAFF_CHECKLISTS.md`, the checklist migration, `src/app/api/checklists`, `src/app/api/owner/checklists`, `src/components/checklists`, `src/lib/staff/session.ts`, staff/owner route entries, and the auth/staff-panel changes. Continuity files include `CLAUDE.md`, this handoff, `chatGPT/README.md`, `chatGPT/SESSION_LOG.md`, and `chatGPT/MOBILE_APP_ROADMAP.md`.

## Exact next step

Run the onboarding/scheduling/swaps/private-documents and real Safari home-screen pilot in `docs/STAFF_RECORDS.md`, together with the earlier checklist defect/coverage pilot in `docs/STAFF_CHECKLISTS.md`. Local component visual checks now pass in fresh headless Chrome; authenticated production and real iOS verification remain outstanding. Future native assignments start from `chatGPT/MOBILE_APP_ROADMAP.md` after this PWA pilot. Preserve Claude's separate intro preview pending user review.

At each session end update this handoff with implemented/deployed state, migrations, evidence, decisions and exact next step. Keep proposed behavior separate from shipped behavior and never store codes/secrets here.
