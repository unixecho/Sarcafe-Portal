# 09 — Agent task tracker

Updated 2026-11-12. Implementation model: Claude Fable 5.2; manual user invocation. Codex is architect/reviewer. Codex reviewed FABLE-000 round 3 and independently verified R3 on Windows and Linux. FABLE-000 is verified. FABLE-001 has been built by Fable and waits for Codex review (uncommitted; migration NOT applied to production). FABLE-002 is not started.

| Task | Status | Dependencies | Codex acceptance evidence |
|---|---|---|---|
| Discovery/planning | Documents prepared; baseline recorded | Existing checkout | [Audit](01-repository-audit.md), [baseline](baseline/2026-11-11.md) |
| FABLE-000 | **Verified** (Codex, 2026-11-12, round 3) | Base `6caf454`; final correction `7d10554..2053be7` | R1/R2 accepted in round 2. R3 independently reviewed and rerun: Windows harness 13/13; Linux focused checks 2/2 without init and 2/2 with init; disposable process-group mutation correctly failed the live-child assertion while the process-state test passed. Fable's exact R3 full Windows run from a path with spaces: dashboard 134/134, kiosk 38/38; all five SQL verifiers passed. Full Linux suite remains unrun. See newest root `handoff.md` addendum. |
| FABLE-001 | **Ready for Codex review** (2026-11-12, PC) | 000 verified; base `0ba81e5`, uncommitted diff + untracked files in worktree `Sarcafe-identity-pc` | Fable report: root `handoff.md`, newest addendum; domain doc `docs/SARCAFE_IDENTITY.md`. Own runs: `verify:identity-sql` 173/173; schedule 433, checklist 52, onboarding 49, waitlist 60, kiosk-content 161; typecheck ok; full QA dashboard 138/138, kiosk 38/38, exit 0. Migration `20261112120000_customer_identity_foundation.sql` applied/re-applied in PGlite only, **NOT applied to production**. Pending: Codex review and rerun |
| FABLE-002 | Prepared, not started | 001 verified; Glisse skill for UI | None |
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

Next step: FABLE-000 is verified. Fable has built FABLE-001 and stopped at ready for Codex review; Codex reviews and reruns before FABLE-002 may start. No production migration application, deployment, posting, notification or other production action is part of this handoff.
