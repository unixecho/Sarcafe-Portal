# FABLE-012 — Reproducible final integration and independent QA handoff

**Task ID:** FABLE-012

**Objective:** Deliver a clean, repeatable identity QA suite and complete evidence package for Codex to independently review/run before any launch.

**Existing context:** All prior verified tasks; existing `qa/run.mjs`, `qa/lib/harness.mjs`, `qa/lib/report.mjs`, `qa/standin`, `qa/live`, `qa/kiosk`, `src/lib/qa/report.ts`, `.github/workflows/qa.yml`; 08 test strategy.

**Allowed changes:** Integrated QA stages/fixtures/commands, CI-compatible report integration, requirements map, setup/operator/manual-pilot/release docs and corrections found by this suite. No production launch/push/real sends.

**Dependencies:** FABLE-011 verified and every earlier correction accepted by Codex.

## Technical requirements

1. Implement/document clean `npm run qa:identity` using existing framework and include it in normal full QA; Windows and CI-compatible setup from lockfile. Refuse production data targets, use safe Wallet/notification adapters, and ensure test isolation/cleanup.

2. Complete ID-01–ID-19 map with exact test IDs/files, commands, fixtures and meaningful assertions covering tenant/role, invite expiry/single-use, review/deactivate, private photos, QR revoke, eligibility/duplicate redemption, Wallet lifecycle, OFF gates, consent/waitlist and existing regressions.

3. Retain expected/actual per test, nonzero failure exit, retries marked flaky, coverage gaps and skip reasons; capture tested commit/diff/environment. Never count a required skipped test as passing.

4. Prepare synthetic end-to-end journey: org/head -> employee pending/photo -> approval -> test credential/pass -> authorized visual match -> server-priced mock redemption -> duplicate denial -> deactivation/revocation; separate inactive loyalty/waitlist journey and cross-tenant denials.

5. Preserve existing dashboard and kiosk reports and one morning digest contract. No --post/digest sending from local QA, no new production automation.

6. Manual checklist must cover actual Apple/Google test devices, approved issuer access/private Storage environment, low-end BDF WebView/camera/keyboard/reset/rotation/perf, operator photo comparison and real sale/discount integration. Mark each not-run with reason.

7. Prepare release checklist with exact new migrations/checksums/order/ledger verification, OFF defaults, authorized pilot/rollout, rollback using flags and preserving evidence; no automatic deployment.

8. Return actual diff/report to Codex. Codex will inspect assertion quality then fresh install/build/run in isolation, send failures for correction and rerun affected plus full regression. Do not self-mark final complete.

## Acceptance criteria

A fresh checkout can run the safe identity suite and full regressions with reproducible results; all automated requirements pass, meaningful limitations remain explicit, documentation/operator rollback is reviewable, and no production state has changed. Final verified status belongs to Codex only.

## Tests

Fresh npm ci, matching browser setup, qa:identity, full npm run qa, required SQL verifiers, build and browser API/data journey; show exact commands/commit/output summary and manual cases. Do not claim hardware/provider checks from mocks.

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
