# 09 — Agent task tracker

Updated 2026-11-12. Implementation model: Claude Fable 5.2; manual user invocation. Codex is architect/reviewer. FABLE-000 round 2 (Codex findings R1, R2) is done on the PC and waits for Codex; no feature task has run. Not verified by Codex yet.

| Task | Status | Dependencies | Codex acceptance evidence |
|---|---|---|---|
| Discovery/planning | Documents prepared; baseline recorded | Existing checkout | [Audit](01-repository-audit.md), [baseline](baseline/2026-11-11.md) |
| FABLE-000 | **Ready for Codex review, round 2** (2026-11-12, PC). Round 1: Codex CHANGES REQUESTED (R1 POSIX process tree, R2 browser probe) | Base `6caf454`; round 1 `46725b5`..`a04dc13`; round 2 on top, pushed as `origin/codex/identity-pc` | Fable report: root `handoff.md`, 2026-11-12 addendum. Own run on the PC from a path with spaces: dashboard 133/133, kiosk 38/38, exit 0; five SQL verifiers pass. **Linux not run: the POSIX half of R1 is unverified.** Pending: Codex review and rerun |
| FABLE-001 | Prepared, blocked on 000 review | 000 verified | None |
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

Next step: Codex reviews the FABLE-000 diff and independently reruns the QA baseline before authorizing FABLE-001. No production action is part of this handoff.
