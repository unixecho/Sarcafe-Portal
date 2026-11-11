# FABLE-006 — Provider-neutral Wallet infrastructure

**Task ID:** FABLE-006

**Objective:** Implement safe Apple/Google adapter contracts, key/config boundaries and durable lifecycle jobs.

**Existing context:** 005; 06-wallet-integration.md primary provider sources; existing server-only conventions, QA fault injection and private-response patterns. No Wallet integration currently exists.

**Allowed changes:** New server-only `src/lib/identity/server/wallet/`, provider adapters, outbox/pass/registration migrations, mock transports and tests; pinned package additions only with reason and lockfile update.

**Dependencies:** FABLE-005 verified. Provider-only setup remains pending; no silent model or library substitution for an unavailable provider.

## Technical requirements

1. Separate domain pass lifecycle, QR credentials, delivery capabilities and provider protocol secrets. Organization and business passes have separate brand/audience mappings.

2. Define typed create/prepare/update/revoke/reconcile operations, normalized failures, desired/applied versions and bounded retry/idempotency. Provider network calls outside DB transactions.

3. Default to explicit mock/disabled adapters; production environment/credential presence cannot silently enable real calls. Never expose signing keys or Google credentials to client.

4. Apple adapter supports signed package validation and update-registration contract; update token remains stable for updates, independent of QR revocation. Use encrypted recoverable material plus verification digest where regeneration needs secrets.

5. Google adapter defines issuer/class/object identity, save artifact preparation and lifecycle updates. Confirm Generic/Loyalty choice per use case; private portraits never go to public image hosts.

6. Document unverified provider credentials, account rights, certificate lifetimes and test access; no real issuance/send.

## Acceptance criteria

Adapters can be tested offline with synthetic identities, no live network/secret leakage; provider failure cannot duplicate issuance or resurrect revoked state; object/serial/audience mapping is unique and tenant-scoped.

## Tests

Adapter contract tests for success/auth failure/timeout/rate limit/retry/stale version/revoke; archive/signature structural validation with test-only material; client-boundary check and dependency audit; full QA.

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
