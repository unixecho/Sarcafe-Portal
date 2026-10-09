# Staff checklists

## Local successor update — 2026-10-09

Migration `20261009134321_onboarding_handover_owner_defaults.sql` and its application changes are implemented and verified locally but are **not applied to production**. The successor gives the handover checklist to both staffed shifts on a multi-shift day. Pending assignments are remapped; in-progress and submitted evidence is retained.

Implemented locally on 2026-10-07 and deployed to production on 2026-10-08 at `https://sarcafe-portal.vercel.app`. The production Supabase migration is `branch_checklists` version `20261008050857`; the current Vercel deployment is `dpl_BaLcqRM4kjSzL4DfotRM2LLg2b7o`.

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
