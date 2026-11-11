# FABLE-003 — Employee registration, private photos and approval

**Task ID:** FABLE-003

**Objective:** Build invited employee registration with first/last name, nickname, private photo and scoped review/deactivation.

**Existing context:** 001/002; `src/lib/staff/records.ts` private-response wrapper, `src/app/api/owner/staff/[id]/payslips/route.ts` private-storage precedent, web/kiosk consent patterns, security plan 05.

**Allowed changes:** New benefit registration/application/photo modules and pages, private bucket/table migrations, review endpoints and tests. Do not reuse staff-payslips bucket or create Sarcafe staff records.

**Dependencies:** FABLE-002 verified. Real photo collection/notice activation not authorized.

## Technical requirements

1. Exchange valid scoped invite for narrow short-lived registration session; collect required identity fields and versioned notices; submit pending application without automatic approval.

2. Bound upload stream and decoded pixels, verify actual raster content, re-encode/strip metadata; reject unsupported/active formats and bombs. Private opaque object paths; no public signed-long-lived photo URLs.

3. Use scoped server-proxy photo reads with no-store/no-referrer on success and errors; prevent path traversal, cross-membership/department access, listing and stale photo access.

4. Only authorized department/organization reviewer approves/rejects; no self-approval. Record actor/reason/time. Identity-critical edits trigger review again.

5. Deactivation invalidates eligibility and verification contexts immediately and provides extension points for later credential/Wallet revocation. Clean orphan uploads and erasure jobs safely.

6. Keep new retention/notice durations configurable and unpublished pending business review; preserve existing waitlist consent and retention.

## Acceptance criteria

Unapproved applicants cannot scan for benefits or receive active passes. Required fields/photo validated; only scoped reviewers access/review; private images cannot be fetched anonymously or across tenants; approved member does not gain existing staff access.

## Tests

Unit image/type/size/metadata checks; SQL review and lifecycle invariants; API upload/proxy abuse and approval matrix; browser form error/success/review using Glisse; explicit pending real Storage validation if only mocked; full QA.

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
