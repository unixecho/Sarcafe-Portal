# FABLE-009 — Glisse dashboard management

**Task ID:** FABLE-009

**Objective:** Build scoped member, employee, policy, Wallet and loyalty control screens using the exact established Sarcafe design.

**Existing context:** 001–008 endpoints; `src/components/glass/`, `src/lib/tools/index.ts`, `src/lib/nav/dock.ts`, `src/middleware.ts`, owner/staff layouts, 10-glisse-design-contract.md.

**Allowed changes:** Identity management components/routes/loading states, scoped tool/navigation entries, minimal shared component extension only if reused, tests and documentation. No replacement dashboard/nav system.

**Dependencies:** FABLE-008 verified; actual Glisse skill read before UI work.

## Technical requirements

1. Read actual Glisse skill and repo design sources; report skill path/version. Reuse shared shell/Menu/.gl-pop/Pill/tones/Seg/layout dock/skeletons/five looks and performance rules.

2. Directory is scoped and paginated; minimum PII, no global person search across businesses. Application review, deactivate/reactivate, policy drafts, redemption history/reversals and Wallet states use already-guarded APIs.

3. Launch controls show effective/inherited collection state versus new OFF states, prerequisites and consequences. API checks are authoritative; UI hiding is not permission.

4. Use optimistic settings version and precise errors; server-auth outages never become fake success/empty totals. Do not hold private photos in persistent caches or route transitions.

5. Preserve top bar, existing home categories, all current tools and role-filtered finder; add new entries only where actual capability permits.

## Acceptance criteria

Every role sees only its approved scope/actions, UI follows Sarcafe Glisse across all states/looks, no navigation regression or private-data cache, new program controls remain OFF and require intentional authorized transitions.

## Tests

Role/tenant browser matrix, five-look screenshots, long menus, RTL/bidi, keyboard/focus, 360/390/768/1280 widths and safe areas, no-overflow/contrast, loading/saving/error/offline states, nav access-index tests, full QA.

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
