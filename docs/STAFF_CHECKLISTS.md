# Staff checklists

## Local successor update — 2026-10-09

Migration `20261009134321_onboarding_handover_owner_defaults.sql` and its application changes are implemented and verified locally but are **not applied to production**. The successor gives the handover checklist to both staffed shifts on a multi-shift day. Pending assignments are remapped; in-progress and submitted evidence is retained.

Implemented locally on 2026-10-07 and deployed to production on 2026-10-08 at `https://sarcafe-portal.vercel.app`. The production Supabase migration is `branch_checklists` version `20261008050857`; the current Vercel deployment is `dpl_BaLcqRM4kjSzL4DfotRM2LLg2b7o`.

## Shift timing, tracker, shift card and developer mode — 2026-10-13

**Not before the shift.** `src/lib/checklists/window.ts` (pure, tested by `npm run check:checklist-window`) decides when a checklist is locked: until the shift starts, by the BRANCH's wall clock (`CHECKLIST_EARLY_MINUTES = 0`; raise it to let people start early). `POST /api/checklists` enforces it for `save` and `submit` (409 `too_early`); the lists grey out and disable locked checklists and say when they open ("ייפתח היום ב־13:00"). The clock the screens use is the server's (`serverNow` in the API payload, advanced locally), never the phone's. Developer test forms live in the browser and never reach the API, so they are not gated. No migration: the database is reached only by the service role through this route.

**מעקב משמרות** (owner, `/owner/checklists`): rows are grouped by day with a centred spacer carrying the day and date, the list is explicitly RTL, today and the coming days come first (nearest first) and past days follow (latest first). Each row shows the employee (round avatar and coloured edge, the same colour as on the schedule, computed from the scheduler roster), the branch (a solid tag in the branch's own colour, `src/lib/branches/color.ts`) and a status chip: sent / in progress / open to submit / late / future. Future unsubmitted rows are greyed and `inert`. "Late" follows the reminder schedule (60 min after the start for opening and the arriving handover, 10 min after the end for closing and the departing handover).

**Staff home shift card** (`ShiftStatusCard`, data from `src/lib/staff/shift-status.ts`): on shift now → time left, place and a "הגשת צ׳קליסט …" button per pending checklist (done ones show as sent); before the shift → the next shift with locked buttons and when they open. Buttons deep-link `/staff/checklists?open=<id>&branch=<slug>`.

**Developer mode.** A developer (`badge = developer` or an allow-listed email, `isDeveloper` in `src/lib/checklists/developer.ts`) is no longer sent to the owner dashboard: they get the employee home like anyone else, plus a "מצב מפתח" group with `/staff/dev` (test panel `DevPushPanel`, checklist previews via `?preview=<kind>`, link to the owner dashboard). With no real shift the card offers "כניסה למשמרת בדיקה" (a local, per-browser switch) that shows test checklist buttons. Other owners still land on the owner dashboard.

**Home-screen app opening the till.** iPhone stores the address of the page it was added from, not the manifest `start_url`. The install sheet now sends an iPhone to `/staff` before it explains Add to Home Screen, and `StandaloneLaunchGuard` (root layout, `src/lib/staff/launch.ts`) corrects the first page of an installed-app launch: bare `/pos` goes to `/staff`, and `/login?next=<anything but /staff>` becomes `/login?next=/staff&quick=1`. Station links (`/pos?v=station&p=…`) and every later page are left alone.

## Employee flow

- `/staff/checklists` is Hebrew/RTL and accepts Google sessions or the service-only employee-number session.
- A published schedule is the source of truth. On a two-shift day, the morning employee receives opening then handover; the afternoon employee receives handover then closing. More generally, the first shift gets opening, every staffed shift on a multi-shift day gets one handover, and the last shift gets closing. A single shift gets opening and closing.
- The employee sees one category per screen, with related checks grouped into compact rows. Every machine/product still has its own auditable answer. The category is saved before advancing. `לא תקין` / `לא בוצע` and numeric target mismatches require a reason. Final submission requires attestation.
- The saved row contains the exact template snapshot/version, answers, derived issue list, staff ID, branch, shift and shift-assignment IDs.
- Employee-number users cannot self-assign a login email. They link Google through current-PIN proof and OAuth, which supplies the verified email and Auth identity together. They can change their PIN after proving the current PIN; PIN change revokes employee sessions and requires signing in again.

## Owner flow

- `/owner/checklists` has three tabs: unresolved issue inbox, per-shift submission tracking, and the form builder.
- Builder edits are kept locally until `פרסום לעובדים`. Owners can rename a form, start blank, restore the published version, add/reorder/duplicate/delete categories and checks, mark checks optional, add numeric targets and units, and classify defects. Publishing creates an immutable version and updates only pending runs.
- Dashboard tile shows the unresolved issue count for the selected initial branch.
- Initial definitions are created lazily for every permanent branch. Givat Haviva uses a 500 NIS closing cash target; Maor uses 400 NIS and includes the cushion/tent task.

## Employee access

- `staff_employee_sessions` stores only a SHA-256 token hash. The cookie is HttpOnly, SameSite=Lax and Secure in production.
- `/api/auth/quick-login` rate limits credential attempts fail closed. Staff without a linked Auth identity receive an opaque employee session and are routed to the profile Google-link prompt. A typed contact address never substitutes for OAuth. Existing linked accounts may continue to an authorized destination.
- Owner can choose or randomly generate a six-digit code. Employee creation accepts a nameless draft and the generated employee number can be changed to match HYP manually.
- Old POS quick-session marker rows remain after PIN change/sign-out until conservative cleanup, so a still-valid quick JWT cannot be mistaken for a full owner session.
- The stable QR target is `/login?next=/staff/checklists&quick=1`; the owner checklist screen can copy it, test it, or download a print-ready QR PNG.
- A production-configured developer account sees a non-persistent preview for every active form type. It does not require a shift and cannot create real submissions or inbox issues.
- An owner entering through a six-digit code lands on a restricted `/owner/dashboard` launch screen. Google remains required for privileged owner pages and mutations.
- Quick login uses persistent, fail-closed rate limits for the IP, employee, their pair, and a daily employee budget. Limiter keys use an HMAC rather than storing the raw IP or employee number.

## PWA step

`src/app/staff/layout.tsx` supplies the staff manifest and a one-time Hebrew Add to Home Screen introduction. Android uses the install prompt when available; iOS gets Safari Share → Add to Home Screen instructions.

## Verification

- `npm run typecheck`
- `npm run build`
- `npm run check:schedule` — 158 passed
- `npm run verify:checklist-sql` — 11 passed; applies every migration in local PGlite and checks the two-sided handover mapping, operator scheduling defaults/explicit opt-in, template versioning, pre-Google number/PIN login, PIN rotation/session revocation and browser-role denial.

## Release order

1. Completed: apply `supabase/migrations/20261008050857_branch_checklists.sql` to production Supabase.
2. Completed: run Security and Performance Advisors and verify the new tables, trigger and browser-role denial.
3. Completed: deploy the local workspace to Vercel production and promote deployment `dpl_BaLcqRM4kjSzL4DfotRM2LLg2b7o`.
4. Completed: verify production routes and scan runtime errors.
5. Remaining: test one owner and one employee end to end at Givat Haviva: publish schedule, complete each form type, create a controlled defect, confirm inbox/coverage, reload/resume, change PIN, and install to home screen on iOS and Android.
