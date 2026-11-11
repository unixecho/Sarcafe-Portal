# FABLE-000 — Restore reproducible Windows QA readiness

**Task ID:** FABLE-000

**Objective:** Fix the existing test harness portability defects and establish a trustworthy local baseline before any identity feature code.

**Existing context:** `qa/lib/exec.mjs`, `qa/live/app.mjs`, `qa/stages/checks.mjs`, `qa/kiosk/static.mjs`, `qa/run.mjs`, `docs/QA_BLUEPRINT.md`, `.github/workflows/qa.yml`; see `../baseline/2026-11-11.md` for reproduced failures at 2a18889.

**Allowed changes:** QA harness/helpers, narrowly related test-script portability and setup documentation; package scripts only for a justified portable launcher. No `src` feature edits, new database migrations, production changes, or dependency-major upgrades. CI edits only if needed to exercise both supported OS paths, without enabling deployment or posting.

**Dependencies:** None beyond manual Fable model selection. This is the first safe corrective assignment; user accepted missing PC parity, not a failed QA baseline.

## Technical requirements

1. Reproduce `spawn npm/npx ENOENT` on Windows. Invoke known npm/Next/TypeScript CLI entry points portably with argument arrays and inherited test env; do not globally enable shell execution on untrusted strings.

2. Convert absolute Windows dynamic import paths to file URLs in kiosk static/PGlite paths and any equivalent verified failure.

3. Use a Windows-safe junction/copy strategy for scratch dependencies without requiring administrator symlink rights. Validate scratch cleanup target containment; never delete/move a computed path outside the test workspace.

4. Fix javac discovery to recognize Windows `.exe` and actual JAVA_HOME. Direct `check:kiosk-device` and `check:kiosk-ota` already compile/run successfully: a missing-JDK skip is false.

5. Ensure child start errors, build failure, timeout and browser launch failure always close stand-in/server/browser resources on Windows and Linux; kill only owned processes. Reject stale source/build reuse.

6. Prevent local/production `.env*`, credentials and unrelated private folders from entering test app copies. Use a reviewed explicit source/config allowlist and synthetic environment. Reports/tests must not send to real providers.

7. Preserve legitimate skip/flaky semantics, coverage/assertions and both reports. Do not add allowlists for new failures or remove checks to make the baseline green. The bare /owner route uses a streaming redirect: assert final /login plus protected /owner/dashboard 307, not an invented requirement that bare /owner return 307.

8. Document Node 24.13.0/npm 11.6.2 laptop versus Node 22/JDK17 CI difference. Pin/document a supported version matrix after running it where available; mark CI unverified if not actually executed. PC parity gap is already accepted by the user.

## Acceptance criteria

`npm run qa` completes meaningfully on this Windows laptop from a path with spaces, builds the current app, executes browser/API/SQL stages, emits correct reports and exits, with no portability failures or false JDK skips. Every remaining app/test failure has concrete evidence and is returned for review; do not proceed to FABLE-001 while the baseline is unresolved.

## Tests

Run the unmodified baseline first to confirm the known problems, then full `npm run qa` without --post, direct required SQL verifiers, process-cleanup/start-failure tests, and focused Windows path/CLI/import/JDK tests. Run Linux/CI equivalence if available; never claim it without execution.

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
