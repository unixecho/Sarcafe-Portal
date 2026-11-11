# FABLE-002 — Organizations, departments and department heads

**Task ID:** FABLE-002

**Objective:** Implement scoped organization/department management and secure head invitation/acceptance.

**Existing context:** Foundation from 001; current owner guard, `src/app/auth/callback/route.ts`, `src/lib/pos/server/guard.ts` same-origin patterns, `src/lib/rate-limit.ts`, `src/components/glass/`, QA public-route guard index.

**Allowed changes:** New identity organization/invitation modules; `/owner/members` organization slice and `/benefits/manage` proposed routes; minimal safe callback/return-route integration, additive invite/grant migrations and tests. Preserve existing staff invitation semantics.

**Dependencies:** FABLE-001 verified; actual Glisse skill located/read before UI implementation.

## Technical requirements

1. Owner creates/manages organizations only within explicit administration/agreement scope; heads manage assigned department only. Do not infer org rights from schedule delegation or general-manager badge.

2. Use purpose-scoped high-entropy invitation tokens stored as digests with configured expiry/revocation, intended verified recipient binding, single-use atomic acceptance and audit.

3. Head authenticates using existing Supabase Google infrastructure with a distinct safe destination. A typed email alone cannot accept a head grant. Forwarded/mismatched invitation does not create authority.

4. Initial delivery is a private copyable link, no automatic email/SMS. Keep tokens out of URLs captured by logs/referrers; exchange then clear capability from browser location where feasible.

5. Add scoped list/create/update/deactivate endpoints and meaningful unavailable/denied states. No self-escalation or arbitrary business/organization attachment.

## Acceptance criteria

Authorized owner/admin manages departments; invited intended head accepts once and sees only their department; cross-tenant, expired, revoked, wrong-recipient and simultaneous replay paths fail without granting staff/owner access.

## Tests

SQL concurrency for acceptance, API role/tenant matrix, invalid/expired/wrong-recipient/replayed token and limiter outage tests, browser acceptance/management with actual Sarcafe Glisse, full regression QA.

## Execution contract
Read root `handoff.md` first, then `AGENTS.md`, `CLAUDE.md`, `chatGPT/README.md` and the identity planning pack. Verify root, branch, HEAD and working tree; preserve other sessions' work. Use the actual Claude Fable 5.2 model, with resolved provider/session evidence; no fallback model. The user runs this manually. Only perform the assigned slice. Proposed paths below do not yet exist unless earlier verified tasks created them.

All new UI must use the actual Glisse skill and Sarcafe's shared design: read `../10-glisse-design-contract.md`, `docs/SARCAFE_GLASS_UI.md`, and the source in `src/components/glass/`. Locate and report the skill path/version; if unavailable, report before UI implementation. Use the shared shell, Menu/.gl-pop, Pill/tones, Seg/GlassDock RTL wrappers, layout DockHost, shaped loading skeletons, five looks and reduced-motion/performance rules. No new motion library or new GSAP use. Static cards use .gl-surf. The plain-JS kiosk and native Wallet formats retain their established architecture; no React rewrite.

Every feature carries tests now, not only at FABLE-012. Extend the existing `qa/` harness, real SQL verifiers and expected/actual reporting. Use synthetic two-tenant fixtures and mock external adapters. Do not post QA reports or run notification digests against production. A stand-in test does not prove PostgreSQL constraints or Storage policy.

## Protected functionality
Preserve existing dashboard/tool categories, menu/editor, scheduler/checklists, POS/staff access and employee-code login, public web/kiosk phone signup, consent/withdrawal/erase/retention, kiosk menu/ads/shift strip/OTA and default 60-second inactivity + 10-second warning privacy reset. Never edit Ayeka Bar. External beneficiaries are not Sarcafe staff; matching names/phones never auto-merge identities.

## Approval requirements
Local code, safe tests and non-destructive draft migrations in this slice are authorized after dependencies are verified. No push/deployment, production writes/migration application, real SMS/email/customer notifications, real Wallet issuance, public enrollment/benefit/reward activation, or destructive changes. New loyalty activation settings default OFF; preserve existing waitlist collection. No invented discount values. Prepare concrete reviewable changes before any later approval request.

## Deliverables and review
Return code/migrations/tests/domain docs, changed files and rationale, base/result revision or exact uncommitted diff, actual commands with exit/pass/fail/flaky/skip counts, expected/actual failures, acceptance-to-evidence mapping, remaining limits and exact next step. Record migrations as applied locally or NOT APPLIED to production, never imply deployment. Update root handoff and task tracker without secrets/PII. Set **ready for Codex review**, stop and return the report. Codex reviews the diff and independently runs tests before marking verified or authorizing the next task.
