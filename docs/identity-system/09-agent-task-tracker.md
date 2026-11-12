# 09 — Agent task tracker

Updated 2026-11-12. Implementation model: Claude Fable 5.2; manual user invocation. Codex is architect/reviewer. FABLE-000 round 2 was reviewed; R1/R2 are sound, but Codex requested R3 for a Linux-container zombie false-positive in the self-test. Fable fixed R3 (2026-11-12, local commit on `codex/identity-pc`, not pushed) and it waits for Codex. No feature task has run. FABLE-001 remains blocked.

| Task | Status | Dependencies | Codex acceptance evidence |
|---|---|---|---|
| Discovery/planning | Documents prepared; baseline recorded | Existing checkout | [Audit](01-repository-audit.md), [baseline](baseline/2026-11-11.md) |
| FABLE-000 | **Ready for Codex review, round 3** (2026-11-12, PC): R3 fixed. Round 2: Codex CHANGES REQUESTED (R1/R2 accepted; R3 Linux zombie false-positive) | Base `6caf454`; reviewed `a04dc13..7d10554` on `origin/codex/identity-pc` | Codex independently: Windows path-with-spaces full QA dashboard 133/133 + kiosk 38/38; five SQL verifiers pass; Linux with init passes and the broken-group mutation fails. No-init Linux leaves only `STAT Z` entries but `alive()` counts them as running, so the focused test falsely fails. Fix R3 and return for Codex review. **Fable, round 3 (root `handoff.md`, newest addendum):** `alive()` reads `/proc/<pid>/stat` on Linux and counts `Z`/`X` as ended; one file of code (`qa/stages/harness.mjs`), local commit on top of `7d10554`, not pushed. Windows: harness 13/13; full QA from a path with spaces dashboard 134/134, kiosk 38/38, exit 0; five SQL verifiers pass. Linux `node:20-alpine`: old helper fails without init; R3 passes without and with init; process-group mutation fails in both. Full suite not run on Linux. Pending: Codex review and rerun. |
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

Next step: Fable has fixed R3 only and returned the narrow diff/evidence (`7d10554..HEAD` of local `codex/identity-pc`); Codex reviews and reruns focused Linux/Windows checks before authorizing FABLE-001. No production action is part of this handoff.
