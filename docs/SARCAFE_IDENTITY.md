# Sarcafe identity foundation (FABLE-001)

Status: **built and tested locally; the migration is NOT applied to production; nothing uses it yet.** Plan and later slices:
`docs/identity-system/`. This file describes what exists in the code.

## What it is

The service-only base of the hybrid identity system: who a person is, what they belong to, and what a signed-in user may
administer. It has no screen, no API route, no Wallet, no discount, no invitation and no link to the customer waitlist. Existing
sign-in, owner, staff, scheduler, checklist, POS, kiosk and waitlist behaviour is unchanged: no existing file under `src/` was edited.

Three things are kept apart, on purpose:

| | Table(s) | Holds | Never |
|---|---|---|---|
| Identity | `customer_members` | a private UUID and a state | a name, phone or e-mail (so it cannot be a directory or be matched on) |
| Affiliation | `customer_org_memberships`, `customer_business_memberships` | a member's relation to ONE organization (in ONE department) or ONE business, with the name THAT scope uses | a staff row, a POS or scheduler right |
| Authority | `customer_principals`, `customer_access_grants` | a verified auth user, and one capability in one exact scope | a global grant, a grant inferred from an e-mail |

Around them: `customer_businesses` (Sarcafe is the seed), `customer_business_branches` (which business an existing branch belongs
to), `customer_organizations`, `customer_departments`, `customer_business_orgs` (an explicit business–organization agreement,
`draft` by default) and `customer_identity_audit` (append-only, ids only).

Rules that hold by construction:

- **No automatic matching or merging.** Two people with the same name are two members. One person is in two places only through
  explicit rows carrying the same member id. There is no merge function.
- **Nobody becomes staff.** Nothing here writes `staff`, `auth.users` or the waitlist. An organization's administrator has a
  principal and a grant and no staff row, so every existing guard keeps refusing them.
- **Legacy owners reach Sarcafe only.** A staff owner administers the one business flagged `legacy_owner_access` without a stored
  grant. A unique index allows a single such business, so a future business never inherits the owners; it needs explicit grants.
- **Every new operation names its exact scope**: one business, one organization, or one department inside its organization.

## Scope is enforced by the database, also against the service role

RLS is on for all eleven tables with no policy, and browser roles (`anon`, `authenticated`) hold no privilege. That alone would not
protect anything from server code, which uses the service role and bypasses RLS, so the schema itself refuses wrong-tenant rows:

- composite foreign keys `(organization_id, department_id)` keep a membership's and a grant's department inside its organization;
- `customer_access_grants_scope_check` allows exactly three shapes (business / organization / department, each with its own
  capability) and no global one; `customer_identity_audit_scope_check` requires exactly one scope;
- the `customer_keep_columns` trigger refuses to re-point an existing grant, membership, department, agreement, branch mapping or
  principal at another scope or person;
- the audit refuses update and delete; the service role has no `delete` on any identity table;
- `customer_access_grant` / `customer_access_revoke` recheck the acting user's authority for the target scope inside the
  transaction, so holding the service key is not enough to grant across tenants through them.

## Capabilities

| Capability | Scope | Passes when |
|---|---|---|
| `business_admin` | one business | a live grant, or a legacy owner on the flagged business |
| `organization_admin` | one organization | a live grant |
| `department_head` | one department of one organization | a live grant for exactly that pair |

A live grant is not revoked, not expired, of an active principal, on an active target. Capabilities do not imply each other: an
organization administrator is not a department head and administers no business. Who may give what (`customer_access_grant`):
a business administrator gives `business_admin` on that business and appoints the first `organization_admin` of an organization
the business has a `draft` or `active` agreement with; an organization administrator gives `organization_admin` and
`department_head` in that organization; a department head gives nothing; nobody grants to themselves.

## Code

| File | What |
|---|---|
| `supabase/migrations/20261112120000_customer_identity_foundation.sql` | the eleven tables, constraints, triggers, three functions, the Sarcafe seed |
| `src/lib/identity/types.ts`, `rules.ts` | pure types and rules (scope shapes, capability ↔ scope, full-session rule); each has its SQL twin |
| `src/lib/identity/access.ts` | `authorizeIdentityAction(session, { capability, scope }, check)`: the decision, with the database question injected |
| `src/lib/identity/server/session.ts` | `resolveIdentitySession()`: wraps the existing `resolveStaffIdentity()` and adds a verified auth user who is not staff |
| `src/lib/identity/server/guard.ts` | `requireIdentityAccess(capability, scope)` for future routes |
| `src/lib/identity/server/repository.ts` | the only code that calls the `customer_*` functions (service role) |

The guard's answers: signed out 401; an employee-code session 403 `full_session_required`; a quick Google session 403
`quick_session`; a malformed or over-wide scope 400; anything the database refuses 403 (the same for "does not exist" and "not
yours"); the database not answering 503. An unexpected answer is a refusal.

## Tests

- `npm run verify:identity-sql` (real Postgres via PGlite, synthetic two-business / two-organization world, 173 checks): applies
  in order and twice more with an identical schema snapshot; scoped foreign keys and ID swaps as the table owner and as the service
  role; one shared identity and duplicate-looking people; uniqueness; the access matrix for every role; revoked / expired /
  switched-off; grant and revoke with the actor recheck; nobody became staff and `is_op()` is unchanged; RLS, grants and real
  attempts as `anon` / `authenticated`; no duplicate function names; then the real `access.ts` deciding with the real SQL function
  for every session class. It runs inside `npm run qa` (the `checks` stage runs every `verify:*` script).
- `qa/stages/unit.mjs`: `identity-scope`, `identity-guard`, `identity-isolated` (no file outside `src/lib/identity` imports it or
  touches its tables; the server files are `server-only`; the pure files reach no server, secret or database).

## Before it is applied to production (not done, not authorized)

Run `verify:identity-sql` with the three mandatory verifiers and `verify:waitlist-sql`, check `pg_proc` for duplicate names, run the
"Check after applying" query at the end of the migration, and record the ledger row `20261112120000` /
`customer_identity_foundation`. Applying it creates the Sarcafe business row and maps the existing branches; it creates no member,
principal, grant or membership. A branch created later is not mapped automatically.

## Known limits

- No route calls the guard yet, so `server/session.ts`, `server/guard.ts` and `server/repository.ts` are covered by the type check,
  the production build and the isolation test, not by a live request. The decision they delegate to is tested against real SQL.
- PGlite is real Postgres, not Supabase: the default privileges Supabase gives the service role are imitated by the verifier; the
  production grant state was not queried.
- A principal's `member_id` cannot change after creation (a later slice that links an operator to a member must do it on purpose).
- Capabilities for scanning, invitations, photos, credentials, consent, Wallet and benefits belong to later slices.
