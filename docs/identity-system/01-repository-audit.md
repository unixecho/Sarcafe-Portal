# 01 — Repository audit

## Evidence and scope

Inspected 2026-11-11 in `C:\Users\nikol\OneDrive\Desktop\Programs\Projects\Sarcafe-Portal`. Initial working tree clean; branch `main`; HEAD `2a18889f1419334ba1a5eabfade6347cd1507193`. No checkout reset, remote pull, production query, production write, push, deployment, or customer notification was performed. Root `handoff.md`, `AGENTS.md`, `CLAUDE.md`, `chatGPT/README.md` and its referenced checklist planning/findings were read before application discovery. Older records are historical: for example the October checklist findings do not describe today's authentication implementation.

The user explicitly accepts **local-project readiness instead of verified PC parity**. No current inventory from the main PC is available. References to another Windows user's SDK/signing paths are historical evidence, not proof that the PC still has those versions or credentials. Local baseline results are in [the evidence record](baseline/2026-11-11.md).

## Laptop versus repository requirements

| Item | Inspected laptop | Repository / CI expectation | Assessment |
|---|---|---|---|
| OS / shell | Windows build 26200; PowerShell 7.6.5 | QA CI uses Ubuntu | Portability gaps reproduced |
| Git | 2.53.0.windows.1 | Git working tree / tracked-file security checks | Available |
| Node / npm | 24.13.0 / 11.6.2 | `.github/workflows/qa.yml` uses Node 22; no `engines`, `packageManager`, `.nvmrc` or `.node-version` pin found | Record difference; FABLE-000 must define/test supported matrix, not silently rewrite the lockfile |
| Install | `npm ci` passed, 420 packages installed | `package-lock.json`; CI has an exceptional private-widget fallback | Real `a11y-widget` installed; fallback not used |
| Browser | Playwright 1.64.0; matching Chromium v1248 installed | CI installs matching Chromium with system dependencies | Browser smoke runs locally; not a real tablet |
| JDK | Temurin 21.0.7, `javac` available, `JAVA_HOME` set | QA CI Temurin 17; native Windows build hardcodes JDK 21.0.7 | QA helper misses Windows `.exe`; false no-JDK skip |
| Android | SDK platform android-36 and build-tools 36.1.0 present; SDK `platform-tools/adb.exe` exists | `prototypes/sarcafe-kiosk-app/build.ps1` / `build.sh`; min SDK 24, target SDK 30 | No device attached/tested; old PC adb path does not exist here; signing access not verified |
| Containers | Docker CLI 29.2.0; daemon unreachable | Existing QA uses in-process stand-in and PGlite, not Docker | Not needed for existing baseline; real Supabase storage integration still unverified |
| WSL | Only docker-desktop distribution observed | No documented Linux dev distribution | Not an available substitute test environment |
| Supabase CLI | Not on PATH; project MCP server name configured | Existing local SQL verifiers use PGlite | No remote credentials needed for baseline; no remote migration performed |
| Vercel CLI | 57.0.0 | Deployment is Git-linked; setup in `DEPLOYMENT.md` | Availability only; no account/deployment verification claimed |
| Claude Code | 2.1.220 at `C:\Users\nikol\.local\bin\claude.exe`, outside PATH | User-designated Fable 5.2 | CLI discovered, provider access not probed; user will invoke manually |
| Environment | Only `.env.example` in checkout; no application `.env.local` found | Server-only service credentials for real app, synthetic loopback values for QA | No production env pulled or copied |

Lockfile resolutions: Next 15.5.28, React 19.3.0, TypeScript 5.9.3, `@supabase/ssr` 0.5.2, `@supabase/supabase-js` 2.116.0, Glisse 0.5.0, GSAP 3.15.0, PGlite 0.5.8, Playwright 1.64.0, a11y-widget 1.2.1. These are inspected resolutions, not suggested upgrades. No manifest/lockfile changes were made.

Environment names, never values: application requires `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; waitlist uses `KIOSK_SIGNUP_KEY` and `RATE_LIMIT_KEY_SECRET` (web signing falls back to the service-role key); cron uses `CRON_SECRET`; push uses `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. QA has `QA_OIDC_ISSUER`, `QA_REPORT_SECRET`, `QA_REPORT_URL`, `QA_TESTS`, browser/JDK selectors. OTA workflows reference `KIOSK_KEYSTORE_B64`, `KIOSK_KS_PASS`, `KIOSK_KS_ALIAS`, `KIOSK_OTA_PEM`. Availability of real credentials is **not verified**. Baseline uses only the repository's synthetic test environment; never use `--post` or the digest sender for local QA.

## Verified application architecture and integration points

| Area | Actual source | Finding / reuse boundary |
|---|---|---|
| Application | `package.json`, `src/app`, `src/middleware.ts`, `next.config.mjs` | Next App Router, TypeScript strict mode, React, Tailwind, Zod; route handlers mediate privileged reads |
| Supabase clients | `src/lib/supabase/server.ts` | Cookie-aware SSR client plus service-role server client; service-role bypass means application authorization is essential |
| Operator identity | `src/lib/staff/session.ts`, `src/lib/staff/access.ts`, `src/lib/owner/guard.ts` | Google sessions and opaque employee sessions coexist; owner management rejects quick sessions; active staff/branch scope checked server-side |
| Legacy helper caveat | `src/lib/staff/guard.ts` | Older Google-only helper; use current session resolver plus explicit new capability checks, not a blind copy of its POS-oriented wording |
| Middleware | `src/middleware.ts` | Owner/menu/staff route lists, cross-site write checks, quick-session restrictions; cookies choosing a branch do not authorize it |
| Dashboard | `src/app/owner/dashboard`, `src/app/staff`, `src/components/glass`, `src/lib/tools/index.ts`, `src/lib/nav/dock.ts` | Reuse shells, tool role index, layout dock, skeletons; protect existing tool categories |
| Glisse | `docs/SARCAFE_GLASS_UI.md`, `docs/SARCAFE_GLASS_UI_STYLE.md`, `GlassMotion.tsx`, `Seg.tsx`, `GlassDock.tsx`, `glass.css` | Glisse 0.5.0; RTL wrappers; static cards avoid SVG refraction; settle on scroll/switch; five looks |
| Existing animation mismatch | `src/components/app/AppMotion.tsx`, `package.json` | GSAP is already installed and used; new identity code must not add/use it. Preserve existing screens; no unrelated global rewrite |
| Waitlist web | `src/app/loyaltysignup`, `src/app/api/loyaltysignup/route.ts`, `src/lib/loyalty` | he/en/ar; same-origin JSON; 2 KB; HMAC form age; strict schema; separate optional marketing; generic duplicate success |
| Waitlist kiosk | `src/app/api/kiosk/waitlist/route.ts`, `src/lib/kiosk/waitlist.ts`, `prototypes/sarcafe-kiosk-app/overrides/kiosk-signup.js` | Shared kiosk key, 4 KB body cap, language-specific notice versions, no offline PII queue; duplicate returns 409 |
| Waitlist persistence | `20261027150000_customer_waitlist.sql`, `20261028150000_customer_waitlist_no_repeat.sql`, `20261104150000_customer_waitlist_web_source.sql` | Contacts, consent events, attempt hashes; one 10-argument registration RPC with default kiosk source; duplicate phone doesn't update name/consent |
| Waitlist operations | `src/app/owner/waitlist/page.tsx`, `src/app/api/owner/waitlist/route.ts`, `export/route.ts`, `src/app/api/cron/cleanup-feedback/route.ts` | Full-owner listing/actions/export; formula-safe CSV; 12-month purge; existing staff alerts carry no customer data |
| Photos precedent | `src/lib/staff/records.ts`, `src/app/api/owner/staff/[id]/payslips/route.ts` | Private response headers and private bucket patterns. Benefits photos need a separate bucket and bounded image decoding; do not reuse staff payslip ACLs/storage |
| QR precedent | `src/components/orders/QrScanner.tsx` | Lazy `jsqr`, 400px decode frames, camera cleanup, fixed token parsing rather than navigating scanned URLs. Order QR is not a membership credential |
| POS | `src/lib/pos`, `src/app/api/pos`, `docs/POS_BLUEPRINT.md` | Existing order/cart flows; terminal amount can differ. No inspected member-discount engine or automatic HYP integration |
| Scheduler | `src/lib/shifts`, `src/app/owner/schedule`, `docs/STAFF_SCHEDULING.md` | Existing branch-scoped workflow and `sched_*` RPCs; benefits affiliation must not enter this staff roster |
| Kiosk | `prototypes/sarcafe-kiosk`, `prototypes/sarcafe-kiosk-app`, `scripts/assemble-kiosk-bundle.mjs`, `src/lib/kiosk`, `src/app/api/kiosk` | Native Java WebView shell + plain JS bundle, not React; signed OTA, live menu, ads, shift strip, remote admin |
| Privacy controller | `prototypes/sarcafe-kiosk-app/overrides/kiosk-session.js` | Default 60s inactivity **then** 10s warning; bounded in-flight hold, generation guard, reset on overdue wake. Not an unconditional wipe at exactly second 60 |
| QA | `qa/run.mjs`, `qa/lib`, `qa/standin`, `qa/stages`, `qa/live`, `qa/kiosk`, `scripts/verify-*.mjs` | Separate dashboard/kiosk reports, expected/actual checks, retry reported as flaky; stand-in doesn't prove PostgreSQL/storage semantics |
| Deployment | `.github/workflows/qa.yml`, `.github/workflows/kiosk-release.yml`, `vercel.json`, `DEPLOYMENT.md` | Main pushes trigger QA/report posting and can trigger signed kiosk release and Vercel production. No push is an innocuous sharing step |

Searches of `src`, migrations, dependencies and docs found **waitlist only**, no reusable hybrid membership schema, Wallet provider integration, employee-benefit entitlement service, or member redemption ledger. `pos_point_staff` membership means operator point access, not customer membership. These are repository findings, not a production-schema inventory.

Latest migration filename inspected: `20261107000000_kiosk_pairings.sql`. Its handoff entry says not applied; no fresh production ledger check was made. Recheck the newest filename and remote ledger only in an authorized release session.

## Model and skill discovery

Claude CLI `--help` confirms `--model` and print/JSON modes exist. [Anthropic's model configuration documentation](https://support.claude.com/en/articles/11940350-claude-code-model-configuration) names `claude-fable-5-2`; the user confirms Fable 5.2 appears in their account and explicitly chooses manual execution. No model request was sent, no fallback selected, no agent spawned, and no CLI/account access claim is made. Fable must report the actual provider-resolved identity before work, not infer it from a flag or from its own generated text.

A search of the repo and installed laptop `.claude` / `.codex` skill files found no dedicated Glisse `SKILL.md`. The authoritative in-repo design sources exist and are mandatory. Claude must also locate/read the user's Glisse skill in its environment; if missing, report the missing skill before UI implementation. Do not pretend a skill was loaded. See [10](10-glisse-design-contract.md).

## Readiness conclusion

Dependencies installed; direct SQL/type/regression checks pass; full `npm run qa` fails in its Windows harness. [Baseline record](baseline/2026-11-11.md) distinguishes successful checks from harness-blocked stages. FABLE-000 is a prerequisite correction assignment; no identity implementation is authorized to skip the readiness/review gate. PC parity is an accepted gap. Provider credentials, real Wallet devices, real BDF tablet behavior, production migration state, and discount business values remain unverified or undecided.
