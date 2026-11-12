# 09 — Agent task tracker

Updated 2026-11-12. Implementation model: Claude Fable 5.2; manual user invocation. Codex is architect/reviewer. FABLE-000 is verified. Codex reviewed FABLE-001 round 1 at local implementation commit `24d2ae5` (HEAD documentation commit `1cd9084`) and requested five corrections. Fable has corrected R1–R5 (committed locally as `bd5c3ad` on `1cd9084`, not pushed) and waits for Codex review round 2. FABLE-002 is blocked and has not started. The migration was NOT applied to production.

| Task | Status | Dependencies | Codex acceptance evidence |
|---|---|---|---|
| Discovery/planning | Documents prepared; baseline recorded | Existing checkout | [Audit](01-repository-audit.md), [baseline](baseline/2026-11-11.md) |
| FABLE-000 | **Verified** (Codex, 2026-11-12, round 3) | Base `6caf454`; final correction `7d10554..2053be7` | R1/R2 accepted in round 2. R3 independently reviewed and rerun: Windows harness 13/13; Linux focused checks 2/2 without init and 2/2 with init; disposable process-group mutation correctly failed the live-child assertion while the process-state test passed. Fable's exact R3 full Windows run from a path with spaces: dashboard 134/134, kiosk 38/38; all five SQL verifiers passed. Full Linux suite remains unrun. See newest root `handoff.md` addendum. |
| FABLE-001 | **Ready for Codex review, round 2** (Fable, 2026-11-12; round 1 was changes requested) | 000 verified; reviewed `0ba81e5..24d2ae5`, local HEAD `1cd9084` | Independent `verify:identity-sql` 173/173 and full QA dashboard 138/138 + kiosk 38/38 passed, but five corrections remain: first-admin bootstrap/revoke crosses business boundaries; Auth cascade erases authority history; grant errors expose target existence; migration timestamp is future/misordered relative to creation UTC; `reviewed_by_principal_id` lacks its FK index. See the Codex round-1 addendum in root `handoff.md`. Migration **NOT applied to production**. **Fable round-2 report (not yet reviewed):** R1–R5 corrected, committed locally as `bd5c3ad` on `1cd9084`, not pushed; migration renamed `20261112125033_customer_identity_foundation.sql`; own runs: `verify:identity-sql` 228/228 (Windows, and Linux in `node:20-alpine`), five other SQL verifiers pass, typecheck ok, `identity:concurrency-docker` 10/10 on Postgres 16, full QA dashboard 138/138 + kiosk 38/38, exit 0; full suite not run on Linux. See newest root `handoff.md` addendum. |
| FABLE-002 | **Blocked** (FABLE-001 not verified) | 001 verified; Glisse skill for UI | None |
| FABLE-003 | Prepared, not started | 002 verified | None |
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

Next step: Fable has corrected FABLE-001 review findings R1–R5 and stopped at ready for Codex review (round 2); Codex reviews and reruns. FABLE-002 remains unauthorized until Codex verifies FABLE-001. No production migration application, deployment, posting, notification or other production action is part of this handoff.
