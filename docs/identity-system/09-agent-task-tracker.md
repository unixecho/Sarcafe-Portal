# 09 — Agent task tracker

Codex independent review, 2026-11-13: `a4ba6dd..82e2deb` is **CHANGES REQUESTED**, not verified. R1: enforce current OAuth/Google proof for identity operations; R2: retain inactive organizations in their live administrator's management list. D1/D2 decided in the newest root handoff entry. FABLE-003 remains unauthorized. **Update 2026-11-13 (Claude Opus 5.5): R1/R2 corrected and ready for Codex review, not verified (newest root handoff entry).** Prior Fable/Opus evidence below is historical attribution; Opus/Sonnet remain owner-authorized.

Updated 2026-11-13. The owner now authorizes their selected Claude Opus or Sonnet for continuation because Fable credits are exhausted; earlier Fable-only/no-fallback model requirements are superseded. Keep historical Fable attribution and existing task IDs. Codex remains architect/independent reviewer. FABLE-000 and FABLE-001 are verified. Fable's FABLE-002 implementation is `29fb01a` (base `a4ba6dd`), followed by handoff commit `8c84205`; it remains ready for Codex review. This model handoff did not independently review or rerun FABLE-002. **Continuation 2026-11-13 (Claude Opus 5.5, `claude-opus-5-5`, self-reported by the session):** reviewed `a4ba6dd..29fb01a`, reran the checks, added scoped corrections/tests (see newest root handoff entry); still **ready for Codex review**, not verified. FABLE-003 stays blocked until Codex verifies FABLE-002. Neither identity migration was applied to production. See the newest root handoff note for the model override and next verification assignment.

| Task | Status | Dependencies | Codex acceptance evidence |
|---|---|---|---|
| Discovery/planning | Documents prepared; baseline recorded | Existing checkout | [Audit](01-repository-audit.md), [baseline](baseline/2026-11-11.md) |
| FABLE-000 | **Verified** (Codex, 2026-11-12, round 3) | Base `6caf454`; final correction `7d10554..2053be7` | R1/R2 accepted in round 2. R3 independently reviewed and rerun: Windows harness 13/13; Linux focused checks 2/2 without init and 2/2 with init; disposable process-group mutation correctly failed the live-child assertion while the process-state test passed. Fable's exact R3 full Windows run from a path with spaces: dashboard 134/134, kiosk 38/38; all five SQL verifiers passed. Full Linux suite remains unrun. See newest root `handoff.md` addendum. |
| FABLE-001 | **Verified** (Codex, 2026-11-12, round 2) | 000 verified; correction `1cd9084..bd5c3ad`; tested HEAD `a4ba6dd` | R1–R5 accepted. Independent identity SQL: 228/228 on Windows and Linux. Real Postgres concurrency: 10/10; removing the lock in a disposable database correctly produced 7 failures and both businesses winning all 12 races. Full Windows QA: dashboard 138/138, kiosk 38/38, exit 0, zero failed/flaky/skipped; all five legacy SQL verifiers and typecheck passed. Migration `20261112125033_customer_identity_foundation.sql` **NOT applied to production**. Full Linux QA/GitHub Actions remain unverified. See newest root `handoff.md` addendum. |
| FABLE-002 | **Ready for Codex review** (R1/R2 corrections, Claude Opus 5.5, 2026-11-13; previously changes requested by Codex) | 001 verified; reviewed `a4ba6dd..82e2deb`; corrections on top of `82e2deb` on `codex/identity-pc` (hash in the newest root handoff entry) | **Correction report (not yet reviewed):** R1 current-session proof (`session-proof.ts`: SDK-validated claims bound to the user, `amr` oauth, matching verified Google identity; coded 403s; reauth card, no loop); R2 `customer_manage_scopes` keeps inactive organizations for live administrators (migration edited in place, never applied). Own runs: unit 29/0, identity stage 25/0, `verify:identity-org-sql` 183/0 (Windows + Linux), other six SQL verifiers pass (Windows + Linux), concurrency 21/0 and `--without-lock` 8 pass / 13 expected failures, full QA exit 0 dashboard 167/0/0/0, kiosk 38/0/0/0; negative controls on the original code fail as expected (identity 5, SQL 7). **Codex's earlier review, kept:** R1 current-session authentication proof; R2 inactive-organization recovery. Independent QA: dashboard 161 passed / 0 failed / 0 flaky / 0 skipped; kiosk 38 passed / 0 failed / 0 flaky / 0 skipped. Linux identity SQL 162/162 and foundation 229/229; real concurrency 21/21; mutation 8 pass / 13 expected failures. Independent API/browser reproductions confirm both findings. D1/D2 accepted within recorded limits. Migrations NOT applied to production. See newest root handoff entry. |
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

Next step: Codex independently reviews the FABLE-002 R1/R2 corrections (`82e2deb..<result>`, see the newest root handoff entry) and reruns. FABLE-003 remains unauthorized until Codex verifies FABLE-002. No production action is authorized.
