# 04 — Implementation roadmap

Codex specifies and independently reviews; Claude Fable 5.2 writes application code, migrations, tests and corrections. The user will run the prompt manually. No alternative model is authorized. Work sequentially in a local `codex/identity-*` branch or isolated worktree after checking status; never overwrite other work. No push: Git-linked builds and kiosk releases can publish changes.

| Order | Assignment | Completion evidence |
|---|---|---|
| 0 | [FABLE-000](fable-tasks/FABLE-000.md) QA portability/readiness | Reproducible Windows baseline, reliable cleanup, accurate skips; Codex rerun |
| 1 | [FABLE-001](fable-tasks/FABLE-001.md) Foundation | Minimal identity/business/org schema, constraints, scoped guards and real SQL negative tests |
| 2 | [FABLE-002](fable-tasks/FABLE-002.md) Organizations | Department and head authority with secure invite/accept; cross-scope denials |
| 3 | [FABLE-003](fable-tasks/FABLE-003.md) Registration | Pending application, private sanitized photo, approval/reject/deactivate and consent |
| 4 | [FABLE-004](fable-tasks/FABLE-004.md) Verification | Revocable QR, authenticated scanner, scoped photo confirmation, privacy lifecycle |
| 5 | [FABLE-005](fable-tasks/FABLE-005.md) Benefits | Draft policy engine and atomic/idempotent redemption; no invented discount |
| 6 | [FABLE-006](fable-tasks/FABLE-006.md) Wallet infrastructure | Safe provider-neutral contracts, Apple/Google adapters and mock failure/lifecycle tests |
| 7 | [FABLE-007](fable-tasks/FABLE-007.md) Wallet issuance | Test delivery, updates, revoke/reissue, replay/concurrency protection |
| 8 | [FABLE-008](fable-tasks/FABLE-008.md) Loyalty | Preserve waitlist and consent; disabled membership/reward/notification infrastructure |
| 9 | [FABLE-009](fable-tasks/FABLE-009.md) Dashboard | Glisse management, scoped directory, policies, Wallet and launch controls |
| 10 | [FABLE-010](fable-tasks/FABLE-010.md) Kiosk | Safe public flag projection, preserved signup/menu/ads/shift strip/privacy/OTA |
| 11 | [FABLE-011](fable-tasks/FABLE-011.md) Hardening | Adversarial role/tenant tests, race tests, privacy/performance evidence |
| 12 | [FABLE-012](fable-tasks/FABLE-012.md) Final integration | Clean reproducible QA, complete map, CI-compatible reports, manual pilot and release checklist |

Each feature adds its tests immediately; FABLE-012 integrates coverage, it does not postpone testing. Stage migrations by ownership; no conflicting work in parallel. New loyalty controls and real provider actions remain disabled throughout local work.

## Review loop and exit gates

After **each** assignment Fable reports changed files, base/result commit or exact uncommitted diff, model evidence, migration status, commands and actual results, expected/actual failures, skips with reasons, acceptance mapping, blockers and next step. Set tracker to `ready for Codex review`, not complete. Codex inspects the diff, runs independent tests, requests corrections and reruns affected tests plus final regressions. Only Codex marks `verified`.

The readiness brief requires a baseline before feature delegation. Because this baseline failed in the Windows harness, the first runnable prompt is FABLE-000 only. Once Codex verifies it, issue FABLE-001. This is a technical gate from the user's brief, not an additional production approval process. The PC parity gap is already accepted and does not need to be asked again.

Real Wallet test issuance, real external messages, production migrations/deployment, and public loyalty/benefit activation are separate authorization gates. Implement and test everything reviewable with safe adapters before asking for one of these actions. The mere presence of credentials does not authorize their use.

## Dependencies and unresolved live choices

- Glisse skill not installed on the inspected laptop: locate it in Claude's project/account, read it and record its path/version before UI work. The repo's Sarcafe design contract remains binding.
- Discount values, eligible SKUs/departments, stacking/limits, redemption sale reference and reversal policy are owner inputs; no active defaults.
- Apple issuer/team/pass type/certificate and Google issuer/service-account/publishing access are unverified. Mock adapters are the development default.
- Main-PC version/signing/device inventory absent by accepted exception. Real BDF tablet, iPhone/Apple Wallet and Android/Google Wallet pilots remain explicit manual cases.
- Retention/consent text for new photos and memberships requires owner-approved policy before real enrollment; the existing waitlist's published retention/consent is preserved.

No task in this roadmap authorizes editing Ayeka Bar or replacing the existing scheduling, POS, kiosk or dashboard systems.
