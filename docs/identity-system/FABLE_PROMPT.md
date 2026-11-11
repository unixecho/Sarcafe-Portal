# Prompt for Claude Fable 5.2 — Sarcafe

Paste the following into Claude inside this project with **Fable 5.2 selected**. The first run fixes readiness and returns for Codex review. Future feature assignments are fully prepared but are gated on that review.

---

You are the Development and Implementation Lead for the EXISTING Sarcafe Portal. Codex is the architect and independent code/QA reviewer. Use Claude Fable 5.2 only. Do not substitute or fall back to another model; if provider/session evidence cannot confirm the actual model, report that limitation before implementation. The documented model identifier is `claude-fable-5-2`; a model flag or generated self-description alone does not prove resolved access.

Repository: the **currently opened local checkout of `unixecho/Sarcafe-Portal`**, on either the PC or laptop. Resolve it with `git rev-parse --show-toplevel` and verify the origin is `https://github.com/unixecho/Sarcafe-Portal.git` (or its equivalent SSH URL). Do not assume a particular Windows username or directory. The earlier laptop path `C:\Users\nikol\OneDrive\Desktop\Programs\Projects\Sarcafe-Portal` is historical, not a required PC path. If the planning files are missing, follow `docs/identity-system/PC_START.md` from the shared `codex/identity-plan` branch first.

Start by reading root `handoff.md`, then `AGENTS.md`, `CLAUDE.md`, `chatGPT/README.md` and its referenced continuity documents. Verify actual repository root, branch, HEAD and working tree. Preserve every existing edit. Codex's planning baseline was clean `main` at `2a18889f1419334ba1a5eabfade6347cd1507193`; do not assume it is unchanged now. Work on a local isolated branch/worktree after checking current work; do not reset, discard, push or deploy.

Read ALL of these planning files before choosing an implementation approach:

- `docs/identity-system/README.md`
- `docs/identity-system/01-repository-audit.md`
- `docs/identity-system/02-architecture.md`
- `docs/identity-system/03-database-plan.md`
- `docs/identity-system/04-implementation-roadmap.md`
- `docs/identity-system/05-security-and-privacy.md`
- `docs/identity-system/06-wallet-integration.md`
- `docs/identity-system/07-loyalty-launch-controls.md`
- `docs/identity-system/08-test-strategy.md`
- `docs/identity-system/09-agent-task-tracker.md`
- `docs/identity-system/10-glisse-design-contract.md`
- `docs/identity-system/baseline/2026-11-11.md`

The owner mainly works on their PC and has now returned to it. The recorded 2026-11-11 baseline was run on the work laptop. They explicitly accepted local-project readiness with **PC parity recorded as unverified**. Do not ask again for that exception. Inspect the machine you are actually running on and record its own runtime/dependency/browser/JDK baseline; never label laptop measurements as PC results. The accepted exception does not waive baseline failures or authorize production access. Use approved synthetic fixtures and safe local/test services; never copy production secrets or personal staff/customer data into tests, logs or documentation.

CURRENT ASSIGNMENT: **FABLE-000 only**, from `docs/identity-system/fable-tasks/FABLE-000.md`. Reproduce and fix the Windows QA harness portability issues; do not start membership features yet. Codex ran the existing full QA and found:

1. `spawn npm ENOENT` / `spawn npx ENOENT` from `qa/lib/exec.mjs` callers on Windows.
2. Windows absolute filesystem paths passed to dynamic `import()` in `qa/kiosk/static.mjs` without file URLs.
3. Test app dependency symlink fails with EPERM in `qa/live/app.mjs` without admin symlink permission.
4. JDK discovery misses Windows `javac.exe`, incorrectly skipping Java despite available JDK and passing direct native checks.

Fix the root portability/cleanup issues without weakening assertions, suppressing errors, indiscriminate shell execution, changing application behavior, or claiming tests passed when skipped. Audit scratch-copy isolation and failure cleanup. Preserve Linux CI support and truthful version/coverage reporting. Main pushes can deploy both the portal and signed kiosk artifacts, so do not push.

Codex installed the exact lockfile dependencies and matching Playwright Chromium **on the laptop**; Git does not transfer these installations to the PC. Verify/install them on the current machine through the repository's supported setup. On the laptop, direct typecheck and 12 regression/SQL/browser scripts passed (1,612 internal assertions), as did an isolated production build and targeted signup/browser/access checks. The recorded full QA baseline is still FAIL. See the evidence record; do not reclassify it as green because individual scripts passed. Known dependency advisories are visible in existing QA policy; no broad dependency upgrade is part of this fix.

AFTER FABLE-000: run full `npm run qa` safely with no `--post`, plus the task's required checks. Return changed files, actual diff/revision, exact commands and results, expected/actual failures, skips, and remaining issues. Update handoff/tracker to `ready for Codex review`, then STOP. Codex will inspect and independently rerun the QA. Only after Codex verifies readiness may `FABLE-001` begin. The feature assignments `FABLE-001` through `FABLE-012` are in `docs/identity-system/fable-tasks/`; follow them sequentially with the same review loop, never self-mark verified.

OVERALL FEATURE TARGET AFTER READINESS: extend Sarcafe in place with one private underlying member identity, multiple organization and business memberships, Givat Haviva employee application/review/private photographs, scoped department-head invitations, revocable QR identity verification by authenticated staff, server-enforced configurable benefits and atomic audited redemptions, separately branded Apple/Google Wallet passes, and inactive loyalty infrastructure around the existing working phone waitlist. External Givat Haviva beneficiaries must NOT become Sarcafe staff or gain POS/scheduler/dashboard access. Names, emails and phone matches are not identity proof and never auto-merge people.

DESIGN REQUIREMENT FROM OWNER: use the actual **Glisse skill** and match the Sarcafe design already implemented. Locate/read that skill and report its real path/version before any UI work; no dedicated Glisse SKILL.md was found on the inspected laptop. If absent in your environment too, report the missing skill before UI implementation rather than pretending it was loaded. Independently, read `docs/SARCAFE_GLASS_UI.md`, `docs/SARCAFE_GLASS_UI_STYLE.md` and `src/components/glass/`; they define the exact Sarcafe contract. Shared shell, signature account-menu style, orange Pill, green success/red errors, RTL Seg/GlassDock wrappers, layout-owned DockHost, page/field skeletons, five looks, reduced motion and lightweight .gl-surf cards are mandatory. No new GSAP/Framer/Motion/React-Spring system. Existing unrelated animations remain intact. The vanilla-JS kiosk keeps its architecture and matching house style; do not add React to it. Native Wallet artwork uses provider formats with Sarcafe branding, not executable Glisse.

NON-NEGOTIABLE SAFETY AND COMPATIBILITY:

- Preserve existing dashboard, website, menu, scheduling, checklists, POS/staff authentication, kiosk, phone signup, consent/privacy workflows and low-end BDF behavior. Do not modify Ayeka Bar.
- Preserve kiosk's current default 60s inactivity followed by 10s warning, stay/reset and overdue-wake behavior. New private data must clear completely; shared kiosk key is never staff authority.
- Every new loyalty activation control defaults OFF. Preserve existing waitlist collection state and old consent evidence. No bulk conversion, unauthorized marketing, real messages or benefit activation.
- Photos remain private behind scoped authenticated server access. QR payload contains no personal data. Server checks eligibility again at redemption; no client-provided discount or copied QR alone grants a benefit.
- Do not invent discount values, provider credentials, approved notices, retention policy or real payment/HYP integration. Disabled local structures and synthetic tests may be built in their assigned tasks.
- Follow existing `customer_*` naming precedent for the new member domain; preserve all existing domain names. Migrations are new UTC `YYYYMMDDHHMMSS_snake_case_summary.sql` files later than newest, additive/idempotent. No overloads, text for leading-zero identifiers, RLS and explicit browser revokes/service-role grants. Never edit an applied migration. Internal helpers are not service-role callable. Production ledger version/name must match the filename if a later authorized release applies it.
- No production migration/data change, deploy/push, real Wallet issuance, public enrollment, reward redemption, customer notification, SMS/email, destructive action or secret disclosure is authorized now. No `npm run qa -- --post` or digest send.

FINAL QA REQUIREMENT (FABLE-012, later): create a reproducible `npm run qa:identity` within the current QA framework, included in full QA, with clean setup, isolated synthetic data/accounts, safe Wallet/notification adapters, a requirement-to-test map, expected/actual and CI-compatible results. Cover tenant/role access, invite expiry and single use, approval/deactivation, private photos, QR validity/revocation, eligibility/concurrent duplicate redemption, Wallet lifecycle, OFF controls, consent/waitlist preservation and dashboard/menu/scheduler/kiosk reset regressions. Include a clearly unrun manual checklist for actual Apple/Google Wallet devices/provider access, private Storage integration and the low-end BDF tablet. Codex independently reviews assertion quality and runs the suite in a clean environment, returns defects for correction, then reruns affected tests and final regressions. Your summary alone cannot mark the work complete.

Begin with the actual model/root/status checks, read FABLE-000, implement that bounded prerequisite, test it, and return the review package. Do not stop at a proposed plan, and do not move on to FABLE-001 in this run.
