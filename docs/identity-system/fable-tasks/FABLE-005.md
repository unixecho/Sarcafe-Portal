# FABLE-005 — Employee benefit policies and atomic redemptions

**Task ID:** FABLE-005

**Objective:** Implement configurable draft policies, authoritative eligibility and an auditable duplicate-safe redemption ledger.

**Existing context:** 004; `src/lib/pos/cart.ts`, `src/lib/pos/server/guard.ts`, existing order transaction patterns; 02/03/05/07. Current terminal amounts can differ and no HYP integration is verified.

**Allowed changes:** New pure policy evaluator, server policy/redemption modules, additive policy/ledger/RPC migrations and focused minimal admin/scanner integration with Glisse. Existing POS prices/payment flow changes require explicit scoped design review.

**Dependencies:** FABLE-004 verified. Owner policy values/live sale contract are gates for real rollout, not blockers to disabled local implementation.

## Technical requirements

1. Persist draft/versioned policies with explicit business/agreement/branch/department/product/time/cap/stacking fields. No seeded real percentage, amount or active policy. Synthetic test values only.

2. Use integer agorot and defined basis-point/rounding rules; reject negative/overflow/invalid amounts. Calculate from trusted server sale facts, never accept client discount result.

3. Recheck current flags, actor scope, membership/credential/reviewer state, policy and unconsumed verified-photo context at commit time; no offline grant.

4. Atomically consume verification/quota/reward effects and append redemption/audit. Bind idempotency key to tenant/action/request hash; fresh key cannot double-redeem same sale/benefit/member. Test parallel different-sale quota races.

5. Reversals are authorized compensating entries with reason and linkage, not deletions. Stale or disabled policy version cannot authorize a new redemption.

6. Document and return the real sale-attachment decision (portal order vs external terminal/HYP reference). Do not claim the ledger changes a terminal or settles payment; do not enable production redemption until that contract and actual values are supplied.

## Acceptance criteria

Server rejects ineligible/deactivated/unverified/wrong-scope attempts; exact retries are stable, changed payload conflicts, duplicate sale and concurrent quota abuse fail, rollback leaves no half ledger, and all real policies remain inactive.

## Tests

Policy unit boundaries and timezones; real SQL transaction/concurrency/grant tests; API tampering and deactivation-between-scan-and-redeem; mock sale fixtures; existing POS/scheduler/waitlist regression plus full QA.

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
