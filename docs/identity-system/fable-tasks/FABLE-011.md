# FABLE-011 — Security, privacy and low-end performance hardening

**Task ID:** FABLE-011

**Objective:** Attack the new trust boundaries with isolated fixtures and fix actual leaks, races and regressions.

**Existing context:** Implemented 001–010; 05 threat model, 08 coverage matrix, existing QA security/survival/contrast/perf stages and SQL grants.

**Allowed changes:** Scoped corrections to identity integration and its tests; narrowly necessary shared guards/kiosk fixes with regression evidence. No unrelated framework migration or production penetration tests.

**Dependencies:** FABLE-010 verified.

## Technical requirements

1. Test two-tenant and two-department access across every list/detail/photo/export/QR/Wallet/policy/redemption/setting endpoint and underlying RPC; include forged roles, wrong actor IDs, quick/revoked sessions and missing services.

2. Exercise concurrent invitation acceptance, quota exhaustion, redemption duplicate keys/fresh keys, deactivation during scan, stale policy/flag/job versions, provider outage/recovery and erasure races.

3. Audit output artifacts/logs/browser storage/service-worker/cache behavior for private photos, contact values and tokens; no public images or capability-bearing telemetry.

4. Measure Glisse rendering/scroll/scan workload on existing throttle/profile setup; lazy bounded decoder, no per-row SVG lens, no background camera or leaked listeners. Compare baseline and record actual budgets/results.

5. Review dependency advisories without indiscriminate upgrades/allowlists. Ensure SQL single signatures, RLS/grants and no service-callable internal helpers. Correct identified bugs through this task's diff.

## Acceptance criteria

No unresolved critical role/tenant/PII/credential/duplicate-redemption defect; measurable regressions addressed; all requirements have substantive tests or explicitly documented hardware/provider gaps, never a fabricated pass.

## Tests

Full identity security/survival/transaction concurrency suite, three required SQL verifiers and waitlist SQL, existing regression/browser/audit checks, repeated lifecycle leak tests with finite bounds; final full npm run qa.

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
