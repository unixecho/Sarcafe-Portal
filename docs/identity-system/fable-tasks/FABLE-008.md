# FABLE-008 — Preserve waitlist and add inactive loyalty infrastructure

**Task ID:** FABLE-008

**Objective:** Integrate business memberships/rewards/consent with the existing waitlist without activating the club or changing its collection behavior.

**Existing context:** `src/app/api/loyaltysignup/route.ts`, `src/app/api/kiosk/waitlist/route.ts`, `src/lib/loyalty/`, `src/lib/kiosk/waitlist.ts`, owner waitlist/export/cleanup routes, all three waitlist migrations; 07 controls.

**Allowed changes:** New settings/consent/waitlist-link/reward/job tables and modules; narrow adapters around existing waitlist paths only as needed; owner-only settings APIs, disabled public membership surface and tests.

**Dependencies:** FABLE-007 verified.

## Technical requirements

1. Every new program/enrollment/Wallet/reward/redemption/customer-notification capability false by default. Keep legacy collection operational through explicit inheritance; capture existing state rather than blanket disabling it.

2. Fail closed for new capabilities on absent/error config; distinguish old-schema compatibility from a failed read of a previously explicit OFF collection override.

3. Preserve exact web vs kiosk duplicate responses, rate limits, language notice versions, request replay, no-overwrite duplicate behavior, staff signup alerts, owner export/withdraw/erase and twelve-month cleanup.

4. Do not bulk migrate or auto-link on phone/email/name. Explicit verified claim plus current membership acceptance creates a link; keep historical waitlist consent evidence unchanged.

5. Implement reward ledger/notification outbox as inert infrastructure. Purpose/channel marketing consent required separately at enqueue and dispatch; no reuse of staff/order push subscriptions.

6. New public enrollment uses separate proposed membership route; current /loyaltysignup remains interest collection. No real customer messages or active rewards.

## Acceptance criteria

Existing fixture waitlist rows/consent are unchanged after upgrade; original signup still works; all new direct API/RPC/worker activation bypasses fail; explicit mock claim links only the proven member and leaves marketing optional.

## Tests

Before/after migration equality snapshots with synthetic rows; verify:waitlist-sql; original web/kiosk signup tests; flags missing/OFF/error/stale-tab/concurrent-disable tests; consent withdrawal/erase/purge/job cancellation and mocked notification deny tests; full QA.

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
