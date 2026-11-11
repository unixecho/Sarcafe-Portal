# FABLE-010 — Kiosk feature controls without regressions

**Task ID:** FABLE-010

**Objective:** Connect harmless effective loyalty controls to the existing kiosk while retaining its menu/signup/ads/shift/privacy performance.

**Existing context:** `prototypes/sarcafe-kiosk-app/overrides/`, `scripts/assemble-kiosk-bundle.mjs`, `src/lib/kiosk/`, kiosk APIs, `docs/SARCAFE_KIOSK_REMOTE.md`, `docs/SARCAFE_KIOSK_OTA.md`, 07/10.

**Allowed changes:** Narrow public config projection and plain-JS kiosk integration, existing bundle assembly only as necessary, kiosk QA and docs. No Android device policies/signing-key changes, React rebuild or OTA publication.

**Dependencies:** FABLE-009 verified.

## Technical requirements

1. Project only non-sensitive effective settings/branding; kiosk shared key never becomes staff scanning/photo/benefit authority. Existing registration remains the waitlist unless an explicitly enabled separate flow applies.

2. OFF/unknown/stale membership config does not display active benefit promises or bypass server gates; respect separately preserved waitlist collection.

3. Register transient state clearers with existing KioskSession; preserve 60s + 10s warning, stay/reset, pending request cap, generation checks, wake reset, Hebrew return and cached menu/ads.

4. Preserve both orientations, three languages, touch/keyboard behavior, lite mode, ads, shift/closing strip, menu stock/admin and signed OTA compatibility.

5. Use existing house-glass CSS/tokens for plain JS; no new animation engine or React runtime. New portal controls use actual Glisse. No signed bundle/APK release.

## Acceptance criteria

Kiosk has unchanged old signup/menu behavior with all new capabilities OFF; server denies forged enablement; reset removes all transient customer data; no PII/photo appears publicly or persists; bundle remains compatible with installed low-end WebView.

## Tests

All check:kiosk-* and verify:kiosk-content-sql plus web signup/menu/scheduler regression; late network response/reset/background/rotation/RTL/offline cases; measured bundle/perf delta; mark real BDF/OTA pilot pending; full QA.

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
