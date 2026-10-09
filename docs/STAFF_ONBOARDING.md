# Employee setup and Google linking

## Local successor update — 2026-10-09

The current workspace removes the unsafe employee-side free-text email path. An employee who signs in with employee number + PIN and still has no linked Google identity is redirected to `/staff/profile?setup=google`, where the existing current-PIN proof starts Google OAuth. The email used for access is accepted only from the server-verified Google identity and is written atomically with `auth_user_id`; typing a contact email never grants permissions. OAuth success and failure return to the profile with a clear result. These application changes and migration `20261009134321_onboarding_handover_owner_defaults.sql` are local and have **not** been applied or deployed as of this update.

The invitation and Google-linking baseline was implemented, migrated and deployed to production on 2026-10-08. The leading-zero HYP-code follow-up described below was applied to production on 2026-10-09 in `20261009120000_native_dashboard_shift_requests_employee_codes.sql`. Authenticated owner/employee and real iPhone pilots remain.

The owner opens `/owner/staff`, enters first name, last name and the employee's HYP number (1–5 digits), and chooses their branch/role. The number is manually matched to HYP; no cashier integration is present. It is stored as a digit string, so a leading zero is significant and preserved end to end (`0849` stays `0849` in setup, display and login). Creating the employee preserves one stable staff UUID and shows a copyable personal setup link. The app does not send messages. Contact details are optional. Existing owner-created drafts and manual/random PIN administration remain supported.

Links expire after seven days and can be used once. They put the random token in the URL fragment, so it is absent from HTTP request URLs and referrers. The owner sees the raw link only at creation, can regenerate it from the employee edit sheet, and can cancel an unused link. Regeneration immediately revokes the old link. If employee creation succeeds but link generation fails, the success screen retries link creation against the same employee rather than creating a duplicate.

The employee opens `/staff/onboarding`, chooses and confirms a six-digit PIN, then links a personal Google account. Weak/repeating/sequential PINs are rejected without consuming the invitation. PIN setup, invitation consumption, the first opaque employee session and a short-lived Google link proof commit in one database transaction. No password or OTP email service is involved. An existing browser Google session is cleared when setup changes the browser to the invited employee.

The employee number/PIN enables checklists and event POS. Personal Google sign-in opens the scheduling and quick-order experience. Google linking can be skipped during the invitation, but the next unlinked PIN login deliberately lands on the employee profile instead of continuing to another destination. Later linking verifies the current PIN again. `GoogleLinkButton` accepts `{ prepared?: boolean }`; only a fresh invitation completion uses `prepared: true`.

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
