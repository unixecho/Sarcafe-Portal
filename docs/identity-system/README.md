# Hybrid identity and membership planning pack

Prepared by Codex on 2026-11-11 against `main`, commit `2a18889f1419334ba1a5eabfade6347cd1507193`. This pack is a **proposal and implementation specification**, not implemented or deployed functionality. No migration was created or applied. Claude Fable 5.2 implements; Codex independently reviews and tests.

Returning on the PC? Start with [PC setup and retrieval](PC_START.md). The shared branch is `codex/identity-plan`; this pack is not on `main`. Then read [the copy/paste prompt](FABLE_PROMPT.md), [repository audit](01-repository-audit.md), [baseline evidence](baseline/2026-11-11.md), and [task tracker](09-agent-task-tracker.md). Assignments are in [fable-tasks](fable-tasks/README.md).

| Document | Purpose |
|---|---|
| [01 Repository audit](01-repository-audit.md) | Inspected source, laptop readiness, uncertainties |
| [02 Architecture](02-architecture.md) | Identity, organization/business boundaries, flows and permissions |
| [03 Database plan](03-database-plan.md) | Proposed schema, integrity, transactions and migrations |
| [04 Roadmap](04-implementation-roadmap.md) | Ordered work and review gates |
| [05 Security and privacy](05-security-and-privacy.md) | Threats, photos, consent, retention and access |
| [06 Wallet integration](06-wallet-integration.md) | Apple/Google adapters, lifecycle and provider prerequisites |
| [07 Loyalty launch controls](07-loyalty-launch-controls.md) | Preserve waitlist; new capabilities default OFF |
| [08 Test strategy](08-test-strategy.md) | Requirements map and independent QA contract |
| [09 Task tracker](09-agent-task-tracker.md) | Evidence-based status; nothing marked implemented |
| [10 Glisse contract](10-glisse-design-contract.md) | Mandatory Sarcafe visual and motion rules |

Latest user decisions: the initial inspection ran on the work laptop; the owner has now returned to the PC and requested access to this work there. Use the local project baseline and record missing cross-machine parity evidence. The user will run the prompt inside their current project checkout using the Fable 5.2 model shown in their account. All new designs must follow Sarcafe's established Glisse design and the Glisse skill. No substitute implementation model is authorized.

The full baseline currently fails on Windows harness portability. **First assignment is FABLE-000 (QA readiness), then Codex review; FABLE-001 is the first feature assignment.** This preserves the readiness gate in the user's brief. Hardware/provider-only cases stay explicitly unverified, not silently passed.
