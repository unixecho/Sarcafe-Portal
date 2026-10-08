# Codebase findings — employee checklist planning

Reviewed 2026-10-07. These are inspected facts, distinguished from proposals in `CHECKLIST_PLAN.md`.

## Repository and environment

- Repository: `C:/Users/Johnathan/Desktop/sarcafe`; branch `integrate/pos-and-scheduling`; HEAD `bbb5369` (`chore: bump a11y-widget to v1.1.0`).
- Initial status: untracked `.agents/`, `.claude/skills/`, `skills-lock.json`. Preserve them; they predate this work. No tracked application edits were present in the initial status.
- Stack: Next.js 15 App Router, React 19, TypeScript, Tailwind 3, Zod, Supabase SSR/client, Lucide. Versions above describe package ranges, not a fresh dependency audit.
- Local migrations through `024_scheduling_overhaul.sql`. Existing scheduling docs: `docs/STAFF_SCHEDULING.md`; POS docs: `docs/POS_BLUEPRINT.md`. Some older comments still describe a Google-only/no-scheduling world; executable code and newer docs take precedence as evidence.
- Supabase project `moiunkugxgsgbdokaxbr` (Sarcafe Portal), eu-central-1, healthy. Read-only schema inspection shows no dedicated shift-checklist tables. All public tables returned by inspection have RLS enabled.
- Confirmed branch slugs: `givat-haviva`, `maor`, plus one training event. Use branch IDs resolved from slugs; never hardcode generated UUIDs. Givat Haviva/Maor are permanent branches.
- Vercel project `sarcafe-portal`, Next.js, Node 24.x; project summary reports production READY. Deployment source/details calls returned scope `godunix` 403. This does not verify production parity with the local checkout.
- Sandbox shell and Node/browser runtimes failed during startup. Host execution restored shell access after automatic review. Browser runtime remained unavailable, so no authenticated live-page walkthrough was completed. The supplied screenshot is visual evidence of the staff quick-code section, not evidence of all live behavior.

## Authentication and quick codes

| Concern | Inspected evidence | Planning consequence |
|---|---|---|
| Google OAuth | `src/app/login/page.tsx`, `src/components/AuthHandoff.tsx`, `src/app/auth/callback/route.ts` | Reuse OAuth; no parallel email/password system. Callback claims existing staff invitations. |
| Quick login | `src/components/auth/QuickLogin.tsx`, `src/app/api/auth/quick-login/route.ts` | Employee number plus six-digit code already exists. Route response currently hardcodes `next: '/pos'`. |
| Staff identity | `staff.id`, `staff.auth_user_id`, `staff.employee_no` | Internal UUID, Auth UUID, and human employee number are distinct. Interpret user-facing UID as employee number unless corrected. |
| Activation | `pos_verify_pin`, migration 022; staff edit UI | Quick login currently requires linked Auth user and email, reached by a first Google login. Name-only staff can be scheduled but cannot log in. |
| Employee code selection | `src/app/api/pos/passcode/route.ts`, `src/components/pos/me/QuickCodeSheet.tsx` | Employee can manually set/change/remove their own code after a full session. UI is tied to POS providers. No employee random-generation action here yet. |
| Owner code generation | `src/app/api/owner/staff/passcode/route.ts`, `StaffManager.tsx`, `staff/StaffEditSheet.tsx` | Owner can generate/remove code or change employee number. Manual owner-set code is missing; non-owner managers cannot use this owner-only route. |
| Session creation | `src/lib/pos/server/quick-login.ts` | Mints genuine Supabase session for linked staff, then records its signed JWT session ID in `pos_quick_sessions`. Reuse identity mechanism, remove POS-only navigation assumptions. |
| Authorization | `src/lib/owner/guard.ts`, `src/lib/shifts/guard.ts`, `src/middleware.ts` | Full-session checks block quick-session owner/manager actions. Branch authorization is rechecked on APIs, not just middleware. |
| Brute force | `src/app/api/auth/quick-login/route.ts`, `src/lib/rate-limit.ts` | Existing number/IP limits and generic failures; limiter confirmed fail-open on errors. Plan a credential-specific fail-closed limiter rather than changing all operational limits blindly. |

### Release blocker: quick-session marker deletion

Local migration 022 and the deployed definitions of `pos_set_pin`, `pos_clear_pin`, `pos_clear_old_quick_sessions` all delete rows from `pos_quick_sessions`. `isQuickSessionId()` classifies a missing row as false (full/non-quick). The cleanup route explicitly removes markers after three days while the cookie expires independently.

This is a confirmed classification gap; exploitation with a real session has NOT been attempted. A still-valid token can cease being classified as quick after code rotation/cleanup. Owner/manager guards trust this classification. Do not describe deletion of the marker as session revocation.

Supabase documentation states access tokens can remain usable after sign-out until expiry; strict revocation requires checking the token's session ID against session state: https://supabase.com/docs/guides/auth/sessions . Preserve provenance and revoked/expired status, deny revoked sessions, and test replay before expanding quick login.

## Branch access and shared components

- `src/lib/staff/access.ts`: `isOp` = role owner OR badge owner; GM menu capability is branch-scoped. Owner is never branch-scoped.
- `src/lib/shifts/access.ts`: owner/GM/delegated schedule manager. Scheduling delegation is a specific capability; do not silently give it checklist builder or passcode authority.
- Staff pages filter visible branches; branch cookie `sarcafe_branch` is selection state, never authorization. New APIs must check branch membership independently.
- `src/lib/pos/server/guard.ts`: useful identity/parser/RPC patterns, but `requirePosStaff()` imposes POS enabled/handle rules. Checklist access must not require event POS setup, an event session, or a confirmed POS nickname.
- `src/app/staff/page.tsx` has schedule/register/event POS tiles and auto-redirects to a live event. Add checklist entry without making live-event routing swallow a direct checklist destination.
- `SheetShell.tsx`, `ConfirmSheet.tsx`, `SelectSheet.tsx`, `BranchSwitcher.tsx`, `Switch.tsx`, shared haptics and page transitions provide reusable interactions.
- Global layout defaults Hebrew/RTL. Keep checklist root explicitly Hebrew/RTL even if the POS language preference changes. Reuse Sarcafe theme tokens and existing Hebrew font treatment; do not import a generic English-font design system.
- `src/lib/pos/outbox.ts` queues only POS order creation, with idempotency and retry. Pattern can inform a separate checklist queue; do not send checklist actions through the POS queue.
- `schedule_notifications` is scheduling-specific. Reuse visual notification patterns, not that table's domain contract. Customer web-push subscriptions are order-specific and cannot be repurposed as staff subscriptions.
- `public/manifest.json` currently launches the customer order surface. Avoid changing its start URL globally just to make employee checklists feel native.
- Staff deletion/history rules dynamically consider FK dependencies (documented in scheduling overhaul). New checklist foreign keys must preserve submitted evidence and be included in lifecycle verification.

## Validation and limitations

Baseline commands run: `npm run typecheck`, `npm run check:schedule`, `npm run verify:schedule-sql`. Final results are in root `handoff.md`.

No application feature, schema, login code, production data, deployment, or external manager notification was changed in this planning session. Only continuity/planning Markdown files were authored. Existing TypeScript incremental tooling may update its build-info cache.

## Clarifications received after inspection

User requires an initially nameless owner-created employee record, subsequently filled with first/last name, nickname, email/phone and employee number matched to HYP. Current `AddStaffSheet.tsx` requires a name and a valid nickname; current GET's `has_google` infers linkage from `auth_user_id`. Both assumptions need intentional revision for UID-first onboarding, not just new checklist UI.

User requires employee-number/code first login WITHOUT Google/email, optional later email linking, owner manually chosen OR generated code, and a noticeable in-app checklist inbox. The plan incorporates these as confirmed requirements. Current activation/login constraints above describe today's inspected behavior, not the desired behavior.
