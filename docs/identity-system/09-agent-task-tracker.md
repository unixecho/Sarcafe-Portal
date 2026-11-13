# 09 — Agent task tracker

Updated 2026-11-12. Implementation model: Claude Fable 5.2; manual user invocation. Codex is architect/reviewer. FABLE-000 and FABLE-001 are verified. Codex reviewed FABLE-001 round-2 corrections `1cd9084..bd5c3ad` and independently reran Windows/Linux identity checks, real Postgres concurrency and full Windows QA at `a4ba6dd` (also the remote review-branch tip). Fable has built FABLE-002 and stopped at ready for Codex review (2026-11-12). FABLE-003 is blocked until Codex verifies FABLE-002. Neither identity migration was applied to production.

| Task | Status | Dependencies | Codex acceptance evidence |
|---|---|---|---|
| Discovery/planning | Documents prepared; baseline recorded | Existing checkout | [Audit](01-repository-audit.md), [baseline](baseline/2026-11-11.md) |
| FABLE-000 | **Verified** (Codex, 2026-11-12, round 3) | Base `6caf454`; final correction `7d10554..2053be7` | R1/R2 accepted in round 2. R3 independently reviewed and rerun: Windows harness 13/13; Linux focused checks 2/2 without init and 2/2 with init; disposable process-group mutation correctly failed the live-child assertion while the process-state test passed. Fable's exact R3 full Windows run from a path with spaces: dashboard 134/134, kiosk 38/38; all five SQL verifiers passed. Full Linux suite remains unrun. See newest root `handoff.md` addendum. |
| FABLE-001 | **Verified** (Codex, 2026-11-12, round 2) | 000 verified; correction `1cd9084..bd5c3ad`; tested HEAD `a4ba6dd` | R1–R5 accepted. Independent identity SQL: 228/228 on Windows and Linux. Real Postgres concurrency: 10/10; removing the lock in a disposable database correctly produced 7 failures and both businesses winning all 12 races. Full Windows QA: dashboard 138/138, kiosk 38/38, exit 0, zero failed/flaky/skipped; all five legacy SQL verifiers and typecheck passed. Migration `20261112125033_customer_identity_foundation.sql` **NOT applied to production**. Full Linux QA/GitHub Actions remain unverified. See newest root `handoff.md` addendum. |
| FABLE-002 | **Ready for Codex review** (Fable, 2026-11-12) | 001 verified; base `a4ba6dd`, result `29fb01a` (pushed to `origin/codex/identity-pc`); actual Glisse skill/design contract before UI | Scope: FABLE-002 only; stop for Codex review before FABLE-003. **Fable report (not yet reviewed):** migration `20261112162132_customer_org_management.sql` (NOT applied to production); Glisse skill not available in the environment (reported before UI; shared glass pieces only); own runs: `verify:identity-org-sql` 150/150 and `verify:identity-sql` 229/229 (Windows and Linux `node:20-alpine`), five legacy verifiers pass, typecheck ok, `identity:concurrency-docker` 21/21 (and 13 expected failures without the locks), full QA exit 0, 18m53s. Dashboard 159 passed, 0 failed, 0 flaky, 0 skipped (138 before this task). Kiosk 38 passed, 0 failed, 0 flaky, 0 skipped.; full suite not run on Linux. See the newest Fable addendum in root `handoff.md`. |
| FABLE-003 | **Blocked** (FABLE-002 not verified) | 002 verified | None |
| FABLE-004 | Prepared, not started | 003 verified | None |
| FABLE-005 | Prepared, not started | 004 verified | None |
| FABLE-006 | Prepared, not started | 005 verified | None |
| FABLE-007 | Prepared, not started | 006 verified | None |
| FABLE-008 | Prepared, not started | 007 verified | None |
| FABLE-009 | Prepared, not started | 008 verified | None |
| FABLE-010 | Prepared, not started | 009 verified | None |
| FABLE-011 | Prepared, not started | 010 verified | None |
| FABLE-012 | Prepared, not started | 011 verified | None |

Use `in progress`, `ready for Codex review`, `changes requested`, `verified`, or `blocked (reason)` with base/result revision and evidence links. Only Codex moves an implementation task to verified after actual review/testing. Do not let a self-reported summary or unrun tests mark a task complete.

Fable report template:

```text
Task ID / actual provider-resolved model:
Base revision / result revision or exact uncommitted diff:
Files changed and reason:
Acceptance criteria -> evidence:
Migrations created / applied locally / applied to production (normally none):
Commands run -> exit code, pass/fail/flaky/skip counts:
Expected vs actual for every failure:
Glisse skill path/version and shared components used (UI tasks):
Test environment / adapters / external sends (must be none):
Known limits, hardware/provider cases, blockers:
Exact next step:
Status: ready for Codex review
```

Next step: Fable has implemented FABLE-002 and stopped at ready for Codex review; Codex reviews and reruns. FABLE-003 remains unauthorized until Codex verifies FABLE-002. No production migration application, deployment, posting, notification or other production action is part of this handoff.
