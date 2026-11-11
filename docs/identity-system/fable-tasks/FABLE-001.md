# FABLE-001 — Hybrid identity foundation

**Task ID:** FABLE-001

**Objective:** Add the minimal service-only identity, business/organization membership foundation and scoped authorization without changing existing staff or customer behavior.

**Existing context:** `src/lib/supabase/server.ts`, `src/lib/staff/session.ts`, `src/lib/owner/guard.ts`, `src/lib/staff/access.ts`, `src/middleware.ts`, `scripts/verify-onboarding-sql.mjs`, existing `customer_waitlist_*` migrations. Read architecture 02, database 03 and security 05.

**Allowed changes:** New `src/lib/identity/` pure types/rules and `src/lib/identity/server/` guards/repositories; additive migration(s), new identity SQL tests using existing PGlite pattern, minimal QA registration and planning/domain docs. No UI/Wallet/discount or waitlist rewrite in this slice.

**Dependencies:** FABLE-000 independently verified by Codex. Stop after this slice for Codex review.

## Technical requirements

1. Implement only the foundation tables owned here: private member identity, verified principal bindings, businesses/branch mappings, organizations, departments if needed for FK contracts, explicit business-organization agreements, scoped access grants and organization/business membership skeletons plus minimal audit.

2. Separate identity from affiliation and operator permission. No automatic staff row, auth account, contact match merge or production backfill. Keep identity core inaccessible as a global directory.

3. Enforce scoped foreign keys and uniqueness; a department/membership/grant from another organization/business must not attach through an ID swap. Scope rules must cover service-role access, not only RLS.

4. Wrap current owner/staff session resolution; full-session management and explicit business scope. Legacy owners bind only to Sarcafe, never all future businesses. External org administrators use verified auth principals without gaining staff access.

5. Add only draft/disabled infrastructure. Use explicit existing-domain customer_ naming, p_ parameters, text human identifiers, exact signature grants, RLS and no browser access. No overloads or service_role-callable internal_*.

6. Migration names must be UTC timestamps strictly after newest file at implementation time; additive/idempotent; preserve old migration files. Reapply locally and check pg_proc duplicates.

## Acceptance criteria

Two businesses and organizations can share one explicitly linked identity without cross-scope data access or role leakage. Duplicate-looking people stay separate. Existing authentication, waitlist, scheduler and POS behavior remains unchanged. Foundation SQL passes once and on reapplication with grants proven.

## Tests

Real SQL fixtures for scoped FKs, duplicates, grants/RLS and browser denial; guard tests for all role/session classes including wrong-business owner and revoked grant; existing three mandatory SQL verifiers plus verify:waitlist-sql, typecheck and full QA.

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
