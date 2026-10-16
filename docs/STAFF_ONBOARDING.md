# Employee setup and Google linking

## Round 3 (2026-10-16): app + notifications come FIRST, and the walk survives anything

**The order.** The employee's link used to open a welcome whose first button went to the main page, so people never installed the app or switched notifications on. Now the very first screen of the link is the **setup step** (`SetupGate` inside `StaffOnboarding.tsx`): *install to the Home Screen, then allow notifications*. Only after both are true does the walk go on: welcome → personal code → Google (skippable) → my details → tour → home. Nothing on the setup screen leads to the main page.

**One rule, used twice** (`src/lib/staff/gate-rules.ts`, pure and tested): `gateStep(env)` returns the ONE thing this device needs next: `browser` (open the link in Safari/Chrome: Instagram, WhatsApp, Facebook… in-app browsers cannot install or push; copy-link button) → `install` (iPhone/iPad: only the Home Screen app can receive push; the four taps are listed; Android/desktop: the install prompt or the browser menu) → `unsupported` → `blocked` (the exact settings path per platform) → `notifications` (the allow button) → `done`. It is a function of what the DEVICE says right now, never of stored progress, so it cannot get stuck and is re-checked on focus, visibility, `appinstalled` and every 30 s (coming back from the phone's settings moves the screen on by itself).

**The same gate guards the staff pages** (`NotificationsGate.tsx`, mounted by `src/app/staff/layout.tsx`). `gateModeFor`: employees = **hard** (no way past it), owner / developer / general manager / manager = **soft** ("continue without alerts", remembered for the tab, so dashboards are not interrupted), the owner's exemption or no identity = **off**. The onboarding page runs its own gate (`gateAppliesTo` excludes `/staff/onboarding*`).

**Registering a phone before the person has a code.** The Home Screen app has its own storage and no session yet, so the first registration is made with the *invite link* as the identity: `/api/staff/onboarding` actions `push` / `push_status` (token + subscription / endpoint; rate-limited per IP and per link). After the code exists the session registrar (`/api/staff/push`) takes over. Both live in `src/lib/push/client.ts` (`enablePush`, `reconcilePush`); `reconcilePush` re-files a phone silently when permission is already granted but the server forgot it.

**Survival and recovery (what each failure does).**
| What happens | What the person sees |
|---|---|
| link opened in a messaging app | "open in a browser" + copy-link; nothing else |
| link opened in a Safari tab | install steps with the link still in the address bar (the icon is saved WITH it) and remembered in localStorage (`sarcafe:invite:v1`, 7 days, cleared once the code is set) |
| installed app opened without the link | the remembered link is used; else "איפה הקישור שלך?": paste the message or the link (the code is found inside any text) or use the employee number + code sign-in. Never a button to the main page |
| link used up / expired / replaced | the dead link is forgotten, a sentence says so, paste another or sign in with the code |
| permission refused | the exact path in the phone/browser settings; fixing it and coming back moves on with no button |
| server unreachable | state is `unknown`, not "off": nobody is locked out by a network problem, and the next check retries |
| code set but the walk never finished (app closed, phone changed) | the next visit resumes it: `staff.onboarding_done_at` is null → `/staff` redirects to `/staff/onboarding`; the owner regenerating a link resets it |
| walk finished | opening the icon goes to `/staff`; `?tour=1` replays the tour |
| a phone that truly cannot do push | the owner switches on **מותר להיכנס בלי התראות** for that person (staff edit sheet, `staff.push_gate_exempt`), the gate is then off for them |

`src/lib/staff/gate-state.ts` reads `onboarding_done_at` / `push_gate_exempt` apart from the session and tolerantly: a missing column or a failed read gives quiet defaults (nobody is signed out or locked in), so the code is safe to start before the migration, but the features need it. Migration: `20261016140000_onboarding_progress_event_parent.sql` (existing staff are marked "done" once, when the column is created, so nobody already working is sent through the wizard).

**Link sharing.** `InvitationLink` has an always-visible primary **שיתוף** button: the phone's share sheet when there is one (text only, the link once), otherwise it copies the whole message ("ההודעה הועתקה, אפשר להדביק"), so it is never a dead end. The message now says what the link does (Home Screen, notifications, code, shifts). Copy-link and SMS stay as secondary buttons.

**Tests.** `npm run check:notifications-gate` (47: the rules, the modes, the tolerant reads), `npm run check:onboarding-wizard` (86, including the invite parsing from `window.location.hash`, which once silently never matched). Browser-verified in a scratch copy with a faked push stack (53 checks: iPhone tab, in-app browser, installed, denied, offline, paste, remembered link, dead link, hard/soft/off, share fallback, share sheet, branch slider, POS tab, dev slider). **Not verified:** a real iPhone Home Screen install, a real push permission prompt, a real push delivery to a phone registered with an invite link.

## The wizard, aligned with Ayeka Bar — 2026-10-16

The invite link now opens a **walk**, one screen at a time with a progress strip: welcome → choose a personal code → connect Google (can be skipped) → **my details** (name, phone, emoji; opens filled in) → a **short tour** (the "demo": a miniature of the real home screen with the row each slide is about lit; six slides: overview, checklists, schedule + אילוצים, orders, profile + payslips, phone alerts) → the employee home. The security chain is unchanged (a one-time link sets a code; Google is linked only with that code as proof). Files: `StaffOnboarding.tsx` (the walk), `StaffProfileStep.tsx`, `StaffTour.tsx`, pure `src/lib/staff/{onboarding-wizard,profile,tour}.ts`, `PATCH /api/staff/profile` (edits only the signed-in person's name, phone and `avatar_emoji`; colour is not chosen: the scheduler derives it from the roster).
- **Google returns to the wizard.** The wizard's button starts Google with `back: 'onboarding'`; `/api/staff/google-link` remembers that in an HttpOnly cookie (`sarcafe_link_back`, path `/auth/callback`, 15 minutes) and `/auth/callback` sends the person to `/staff/onboarding?linked=1` (continue at "my details") or `/staff/onboarding?error=…` (back to the Google step with a sentence). Google's own return URL is exactly what it was. Without the cookie the old return (the profile) is unchanged.
- **Creating an employee (aligned with the Ayeka Bar roster):** after the owner creates someone (and closes the link sheet) the roster reloads, clears the search and branch filter so the row can be seen, scrolls the new person to the middle and rings their row for about 3.4 s (no smooth scroll for reduced motion; the toast also says who was added). The new person gets a random emoji (`avatar_emoji`, the least used among active staff) which the roster shows and the wizard's details step starts from. `StaffManager.tsx` (`flashId`), `.sch-staffrow--flash`, `POST /api/owner/staff`.
- **A plain visit** by someone already set up shows the short summary, with "סיור קצר באפליקציה" (`?tour=1`) to watch the tour again.
- **Link sharing** (`InvitationLink`, shown when the owner creates the employee or regenerates the link): copy, "שליחה בהודעה" (SMS app with the message filled in) and the phone's share sheet. The message ends with the link and the share sheet is given the text only (giving it the link as well made WhatsApp print it twice). No WhatsApp button (it did not work on Ayeka Bar). It says the link works once, until when, is shown only now, and can be replaced.

## Local successor update — 2026-10-09

The current workspace removes the unsafe employee-side free-text email path. An employee who signs in with employee number + PIN and still has no linked Google identity is redirected to `/staff/profile?setup=google`, where the existing current-PIN proof starts Google OAuth. The email used for access is accepted only from the server-verified Google identity and is written atomically with `auth_user_id`; typing a contact email never grants permissions. OAuth success and failure return to the profile with a clear result. These application changes and migration `20261009134321_onboarding_handover_owner_defaults.sql` are local and have **not** been applied or deployed as of this update.

The invitation and Google-linking baseline was implemented, migrated and deployed to production on 2026-10-08. The leading-zero HYP-code follow-up described below was applied to production on 2026-10-09 in `20261009120000_native_dashboard_shift_requests_employee_codes.sql`. Authenticated owner/employee and real iPhone pilots remain.

The owner opens `/owner/staff`, enters first name, last name and the employee's HYP number (1–5 digits), and chooses their branch/role. The number is manually matched to HYP; no cashier integration is present. It is stored as a digit string, so a leading zero is significant and preserved end to end (`0849` stays `0849` in setup, display and login). Creating the employee preserves one stable staff UUID and shows a copyable personal setup link. The app does not send messages. Contact details are optional. Existing owner-created drafts and manual/random PIN administration remain supported.

Links expire after seven days and can be used once. They put the random token in the URL fragment, so it is absent from HTTP request URLs and referrers. The owner sees the raw link only at creation, can regenerate it from the employee edit sheet, and can cancel an unused link. Regeneration immediately revokes the old link. If employee creation succeeds but link generation fails, the success screen retries link creation against the same employee rather than creating a duplicate.

The employee opens `/staff/onboarding`, chooses and confirms a six-digit PIN, then links a personal Google account. Weak/repeating/sequential PINs are rejected without consuming the invitation. PIN setup, invitation consumption, the first opaque employee session and a short-lived Google link proof commit in one database transaction. No password or OTP email service is involved. An existing browser Google session is cleared when setup changes the browser to the invited employee.

The employee number/PIN enables checklists and event POS. Personal Google sign-in opens the scheduling and quick-order experience. Google linking can be skipped during the invitation. **Updated 2026-10-13:** an unlinked PIN login is no longer forced onto the profile; it lands where it was asked to (the home page by default), and the staff home shows a "link your Gmail" card (`GoogleLinkPrompt`, a notification dot, an animated three-step walkthrough ending in `GoogleLinkButton`) until a Google account is linked. The checklist screen keeps its own link prompt, and `/staff/profile?setup=google` still exists as the return page of the OAuth flow. Later linking verifies the current PIN again. `GoogleLinkButton` accepts `{ prepared?: boolean }`; only a fresh invitation completion uses `prepared: true`.

The Google proof expires after fifteen minutes, uses an HttpOnly, SameSite=Lax cookie, and is independently bound to Supabase's PKCE OAuth exchange. The callback URL contains the proof's hash, not its bearer value. Callback linking requires a server-verified Google user and a confirmed email from Auth's server-controlled provider metadata. The atomic binding refuses expired/revoked/consumed proofs, inactive staff, changed PINs, changed account bindings, another employee's Google identity/email, or rebinding an existing employee to a different Google user. It writes the verified email and Auth UUID to the original staff row, preserving branch, role, HYP number, checklists, shifts and orders. Browser-editable `user_metadata` is never used for authority.

Token-invited employees cannot be claimed through the legacy email-only matching function. That fallback remains only for older records never issued a setup link. Deactivation revokes setup and Google-link tokens; reactivation never restores old links. PIN changes invalidate pending Google proofs. Owner cancellation also revokes unconsumed Google proofs.

All invitation/proof tables enable RLS, deny `anon`/`authenticated` table access, and expose their RPCs to service role only. Owner APIs independently require full owner authentication. Credential routes use strict same-origin JSON parsing, fail-closed IP/token limits and private/no-store responses including errors. Tokens are 32 random bytes; only SHA-256 hashes are stored. PINs, bearer links and credential bodies are never logged.

API contract:

- `POST /api/owner/staff`: additive `employeeNo` and `generateInvite`; generated invitations require both names and number. Response contains only a safe staff summary and the new invitation URL/expiry.
- `GET|POST|DELETE /api/owner/staff/[id]/invite`: latest nonsecret status, regenerate, revoke.
- `POST /api/staff/onboarding`: `{ action: 'inspect', token }` or `{ action: 'complete', token, passcode }`.
- `GET /api/staff/onboarding`: authenticated employee's setup summary.
- `POST /api/staff/google-link`: `{ action: 'prepare', passcode }` followed by `{ action: 'start' }`.
- `/auth/callback`: explicit Google binding before legacy claim; successful Google linking returns to `/staff/profile`, revokes the browser's opaque employee session and shows the result. A validated event-station return path survives normal login only for an already-linked employee.

Verification: `node scripts/verify-onboarding-sql.mjs` runs the real local PostgreSQL workflow for expiry, replay, regeneration, PIN strength, atomic setup, Google conflicts, unchanged authority, invalidation and browser denial. These are isolated fixtures, not production writes. TypeScript and production build are checked by the root session. A real owner/employee Google sign-in and iPhone Home Screen pilot remain required before release confidence.

Employee records, payslip privacy and staff notifications are documented separately in [STAFF_RECORDS.md](./STAFF_RECORDS.md). Scheduling rules remain in [STAFF_SCHEDULING.md](./STAFF_SCHEDULING.md); checklist behavior in [STAFF_CHECKLISTS.md](./STAFF_CHECKLISTS.md).

## Push notifications step — 2026-10-12

The wizard final screen now shows the home-screen + notifications card (`StaffPushCard`, variant `wizard`), replacing the old one-line iPhone install note. See `docs/STAFF_PUSH.md`.
