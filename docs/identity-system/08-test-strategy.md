# 08 — Test strategy and independent Codex QA

Extend the **existing** `qa/` harness, Playwright, PGlite verification scripts and expected/actual report contract. Do not introduce a competing test framework. Baseline is in [baseline/2026-11-11.md](baseline/2026-11-11.md); its Windows harness failures must be corrected by FABLE-000 before features. A stand-in response is not proof of a database constraint or storage policy.

## Clean setup and safe execution contract

FABLE-000 documents supported Node/npm/JDK versions and makes `npm ci`, `npx playwright install chromium`, `npm run qa` work on the laptop. On Linux CI use the repository browser dependency setup. Keep pinned dependencies; do not mask failed private package installs. If the documented isolated widget fallback is used, report the a11y coverage skip. No automatic dependency-major upgrade as a portability fix.

FABLE-012 must deliver a real `npm run qa:identity` command (proposed; not present yet), using the existing harness and included in normal full `npm run qa`. A clean invocation must build the tested source against isolated synthetic data and safe Wallet/notification adapters, run SQL/API/UI cases, emit nonzero on failure, and leave no server/browser processes running. It must reject production targets, strip unrelated secret env, bind loopback, and avoid `--post` and digest sending. Test from a path containing spaces on Windows. Do not reuse a stale build after edits. Record commit, dirty-diff hash if applicable, dependency/runtime versions, commands, expected/actual, duration, retries/flaky status and skips.

Run real migrations/transaction/grant tests with PGlite or an explicitly isolated Postgres service. Use the existing stand-in for app flows and injected outages. Exercise real private Storage semantics in a separately approved local/test Supabase environment; mock storage cases do not satisfy that release test. Two businesses, two organizations/departments, multiple roles, duplicate-looking unmerged people, and a fixed/time-controlled clock are mandatory fixtures. No real employee/customer records.

## Requirements-to-tests map (planned IDs)

| Requirement | Required assertions | Layers / tasks |
|---|---|---|
| ID-01 Identity separation | Multi-business/member relationships; same phone/name does not merge; member never gains staff access | SQL + API, 001/003/008 |
| ID-02 Tenant isolation | A/B business and organization IDs swapped in read/write/list/photo/export/Wallet/redemption; cross-tenant FK insert refused; legacy owner only owns Sarcafe scope | SQL grants + API, 001/011 |
| ID-03 Role/session | Owner, org admin, department head, scanner, ordinary staff, scheduler delegate, quick session, revoked session, signed-out and kiosk key matrix | API + browser, 001–004/009 |
| ID-04 Invites | Valid, expired, revoked, reused, wrong purpose/recipient/department, malformed, rate-limited; simultaneous acceptance creates one grant | SQL concurrency + API, 002/003 |
| ID-05 Approval | Pending can't benefit/issue; reviewer scoped; no self-approval; rejection; photo/name change re-review; deactivation invalidates existing scans | SQL + API + UI, 003–005 |
| ID-06 Photo privacy | Public/list/cross-scope access denied; no-store on failures; streaming limit, magic/decode/dimension limits, metadata removal, orphan cleanup; no photo URL in pass/public config/log | unit + API + test Storage + UI, 003/011 |
| ID-07 QR | Invalid, expired, revoked, wrong audience/member/business; malicious decoded URL never navigated; screenshot requires visual match; privacy-minimal denial | unit + API + browser, 004 |
| ID-08 Verification | Bound actor/branch/credential/version, expiry, mismatch/cancel, consumed-once, deactivation between scan and redeem, replay by another cashier | SQL + API, 004/005 |
| ID-09 Benefit calculation | Draft/disabled/no policy; owner-configured synthetic percent/fixed cases, integer rounding, caps, SKU/branch/time eligibility, rejected negative/oversized amounts | unit + SQL, 005 |
| ID-10 Redemption | Same-key retry same result; changed payload conflict; fresh key same sale refused; concurrent quota consumption; atomic failure rollback; reversal does not erase evidence | real transaction SQL + API, 005 |
| ID-11 Wallet | Mock create/delivery/update/revoke/reissue, duplicate job, wrong secret, stale update, provider timeout, secret rotation strategy, old QR denied during outage | adapter + API + manual provider, 006/007 |
| ID-12 OFF defaults | Fresh and missing config OFF; direct API/RPC/worker bypass denied; concurrent OFF transition; stale client cannot redeem/issue; security revocation still runs | SQL + API + job tests, 008/009 |
| ID-13 Waitlist/consent | Before/after original records identical; language/version/source maintained; optional marketing, withdrawal/erase/12-month purge; no auto-link; duplicate no overwrite | SQL + web/kiosk UI, 008/010 |
| ID-14 No real messages | Egress blocked in QA; mock inbox only; customer gate + channel consent at enqueue and dispatch; existing staff signup alerts preserved | integration, 008/012 |
| ID-15 Glisse | Skill evidence; shared wrappers, five looks, RTL, menu long text, pills/tones, skeleton/dock, safe areas, reduced motion, no new motion library or GSAP use | source + browser screenshots, 002–011 |
| ID-16 Kiosk privacy | 60s inactivity then 10s warning, stay/reset, late response, hide/resume, both orientations; no photo/token/PII after reset, camera stopped; menu cache remains | existing kiosk checks + browser + manual BDF, 004/010 |
| ID-17 Existing features | Dashboard/navigation, menu editor/published menu, phone waitlist, scheduler/checklists, staff login/records, POS and kiosk ads/shift/admin/OTA remain functional | existing full suite, every task / 012 |
| ID-18 Recovery | DB/auth/storage/provider failures return safe errors; 503 vs missing-auth 401; retry no duplicate; no stale approval display or private cache | survival + API/UI, 011/012 |
| ID-19 Audit/erasure | Correct scope/actor/target/reason; no secrets/PII in logs; erase revokes and cleans private objects/jobs without destroying justified ledger | SQL + API, 003–012 |

For each ID, map exact test file/test identifier, fixture, command and expected result in the final suite. A regex asserting an endpoint has a guard name is useful static coverage but cannot substitute for calling it as the wrong actor. Assert business outcomes and state, not implementation spelling alone. Include intentionally broken-control sensitivity checks during suite review where practical; never turn genuine failures into unconditional skips.

## Regression commands

Keep full `npm run qa` plus the required migration checks: `npm run verify:schedule-sql`, `npm run verify:checklist-sql`, `npm run verify:onboarding-sql`, `npm run verify:waitlist-sql`. Relevant focused commands already exist: `check:loyalty-signup`, `check:kiosk-waitlist`, `check:kiosk-session`, `check:kiosk-menu`, `check:kiosk-content`, `check:kiosk-ui`, `check:kiosk-device`, `check:kiosk-ota`, `check:schedule`, `check:staff-access`, `check:security`, `check:app-layout`. The scroller uses the QA fixture/profile build; do not report a plain production Profiler result as measured.

Preserve dashboard and kiosk reports, per-test expected/actual and failure highlighting. Integrate identity cases into those stages or add explicitly included stages without changing the existing two-suite morning digest contract. No new automated production posts or schedules are needed for this assignment. Dependency audit known exceptions remain visible; new advisories fail until reviewed, not automatically allowlisted.

## Performance/visual evidence

Measure existing and new pages under the same Chromium/device emulation and 4x CPU throttle. Preserve the current QA threshold (worst scroll frame <600ms) and record p95/frame count and bundle delta; it is a regression ceiling, not proof of 60fps on a BDF tablet. Set justified new scan/interaction budgets from measured baseline before accepting them. Camera decoder loads on demand, bounded resolution/cadence; no idle camera or offscreen loop. Test 360/390/768/1280 widths, safe-area override, Hebrew RTL, en/ar where exposed, five looks and reduced motion. Screenshots use synthetic identities only.

## Manual checks (must stay pending until performed)

- Real iPhone: secure Apple pass install, update notification/fetch, offline stale pass, deactivation/reissue, lock-screen visibility and legibility; no private photo URL leakage.
- Real Android: Google demo/test-account save, update, revoke/reissue, stale saved card and cross-business scan denial.
- Actual BDF tablet and its installed WebView: camera permissions/capability if used, 60+10s reset, app sleep/resume, keyboard clearing, both orientations, lite mode, battery/thermal/scroll behavior and no lingering PII.
- Authorized test Supabase Storage: denied anonymous listing/download, scoped proxy, upload bounds, deletion/cleanup; production data is not a test fixture.
- Approved operator/department-head/member pilot: invitation delivery/identity proof, human photo comparison, intended discount and real sale attachment. No real messages/passes until explicitly authorized.

## Independent QA handoff

Fable's final report is evidence to inspect, not acceptance. Codex reviews the actual diff, SQL constraints, guards, fixture realism, assertion meaning and coverage map; performs fresh install/build/run in an isolated checkout of the reported revision; captures results; sends failures back to Fable; reruns affected cases and the full regression suite after corrections. Do not mark complete with unresolved security/tenant/redemption/privacy failures. Hardware/provider skips are listed separately and keep the relevant production release gate open. This session cannot run the future identity suite because it has not been implemented.
