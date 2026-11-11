# FABLE-004 — Revocable QR and authenticated identity verification

**Task ID:** FABLE-004

**Objective:** Implement opaque scoped QR credentials, staff scanning and human photo confirmation with transient private state.

**Existing context:** 003; `src/components/orders/QrScanner.tsx` camera/decoder precedent (do not reuse order-token namespace), `src/lib/staff/session.ts`, `prototypes/sarcafe-kiosk-app/overrides/kiosk-session.js`, 02/05/10.

**Allowed changes:** New credential/verification schema, pure QR parser, server endpoints and `/staff/benefits/scan` Glisse components; targeted nav/guard/QA updates. No public kiosk photo/scanner capability or global scanner refactor.

**Dependencies:** FABLE-003 verified.

## Technical requirements

1. Use cryptographic random opaque QR tokens, stored digests with audience/membership/version/expiry/revocation. No personal data or public photo URL in QR. Plan encrypted recoverability separately for Wallet rendering.

2. Authenticate operator and check full-session scanner capability plus business/branch scope. Shared kiosk key and mere Supabase login never grant scanner access.

3. Never navigate arbitrary decoded text. Validate bounded credential syntax; server resolves current membership/organization agreement and minimum photo/name fields.

4. Operator explicitly confirms photo match or rejects; no biometrics. Produce short-lived verification context bound to actor/branch/business/credential+membership versions, and expiry/consumption.

5. Stop camera/decode loops on found/cancel/hidden/navigation/logout; clear image/object URLs/private UI; stale async responses cannot populate the next person's screen.

6. Preserve default kiosk 60+10 privacy state machine; new sensitive scan view clears no later than its allowed lifetime and never persists token/photo in local/session storage.

## Acceptance criteria

Unknown/revoked/expired/wrong-scope QR reveals no identity, valid scan requires an authorized operator and explicit photo comparison, verification cannot be replayed by another actor or after membership change, and all private state clears reliably.

## Tests

Parser malicious QR unit tests; role/audience/revocation API tests; SQL verification state/expiry/concurrency; browser camera stubs plus real cleanup assertions and delayed-response tests; kiosk reset regressions; actual camera/BDF check marked manual.

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
