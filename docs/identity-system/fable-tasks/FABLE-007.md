# FABLE-007 — Test Wallet issuance, delivery and lifecycle

**Task ID:** FABLE-007

**Objective:** Connect approved test memberships to safe delivery and update/revoke/reissue flows.

**Existing context:** 006 adapters and 004 credentials, 003 approval; Apple/Google protocol constraints in 06, new activation gates in 07.

**Allowed changes:** New scoped issuance/delivery endpoints, Apple protocol endpoints and minimal Glisse test administration, lifecycle jobs/tests. No production provider enablement, real notification transport or public issuance.

**Dependencies:** FABLE-006 verified. Real test passes need explicit owner approval and confirmed provider/test-account credentials.

## Technical requirements

1. Default test/mock issuance only. Validate current approval, audience, issuer configuration and feature gates before preparing/delivering. Separate per-provider delivery from membership approval.

2. Use bounded high-entropy delivery capabilities, hash storage, expiration and atomic claim/replay policy; don't leak tokens through referrers/cache/logs. Multiple device registrations follow provider protocol rather than a blind single-device assumption.

3. Implement exact provider update registration/list/fetch/unregister authorization and statuses; add narrowly justified QA public-route entries, not a wildcard exemption.

4. Deactivation immediately denies QR even during provider outage; queued revocation updates remain possible when new issuance is OFF. Retry/update jobs check desired version and cannot restore revoked credential.

5. Reissue explicitly revokes old credential/delivery; distinguish artifact prepared, provider accepted, downloaded and installation evidence. No fake installed badge.

## Acceptance criteria

Approved synthetic members get correct separate brand/provider artifacts; expired/wrong-scope delivery fails; duplicate requests are safe; revoke/reissue invalidates old scans immediately with honest pending provider status.

## Tests

End-to-end mock issue/download/update/register/unregister/revoke/reissue; cross-tenant/wrong token/API replay tests; concurrent issuance/job tests; manual Apple/Google test-device checklist remains pending without authorized credentials/devices; full QA.

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
