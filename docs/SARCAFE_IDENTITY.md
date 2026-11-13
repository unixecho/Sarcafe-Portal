# Sarcafe identity: the foundation (FABLE-001) and organization management (FABLE-002)

Status: **built and tested locally; corrected after Codex review round 1 (R1–R5, 2026-11-12); the migration is NOT applied to
production.** FABLE-002 (organizations, departments and department-head invitations: the first routes and screens that use the
foundation) is described in its own section below; the sections before it describe the foundation as FABLE-001 left it. Plan and later slices:
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
- every foreign key is `on delete restrict` (the one exception is the branch mapping, which follows its branch). In particular
  an auth user that is a principal cannot be deleted, and a principal that holds a grant or reviewed a membership cannot be
  deleted: authority ends through `revoked_at` / `state` with its audit row, never by a row disappearing. A privacy-erasure or
  deprovisioning flow is a later, explicit, audited design and does not exist yet;
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
a business administrator gives `business_admin` on that business; an organization administrator gives `organization_admin` and
`department_head` in that organization; a department head gives nothing; nobody grants to themselves.

**The first organization administrator (bootstrap).** An organization starts with no administrator, so someone outside it has to
appoint the first one. A business administrator may do that only when all of these hold: the organization is active, the business
has a `draft` or `active` agreement with it, and the organization has **no live administrator** (no active principal holding an
unrevoked, unexpired `organization_admin` grant). As soon as one exists, every business is refused, including the one that
appointed them and any other business with an agreement: from then on only the organization's own administrators add or revoke
administrators (anyone may still give up their own grant). If every administrator is later revoked, expired or switched off,
bootstrap reopens. Under the same rule, and only then, a business administrator may end a dead leftover administrator grant.
Both functions lock the organization row (`for update`) before they decide, in the same order (organization, then grant), so
two bootstraps at the same moment cannot both pass and no deadlock is possible between them. The audit row of a bootstrap carries
`detail.bootstrap_business_id` and `detail.bootstrap_grant_id` (null when a legacy owner acted; `actor_staff_id` names them).

**Refusals say nothing.** The three functions answer `bad_request` for a malformed call and `denied` for everything else. A grant
to an unknown principal, a switched-off principal or the actor's own principal is `denied`, exactly like an actor with no
authority, so an answer never reveals whether a principal, business, organization, department or grant exists.

## Code

| File | What |
|---|---|
| `supabase/migrations/20261112125033_customer_identity_foundation.sql` | the eleven tables, constraints, triggers, three functions, the Sarcafe seed |
| `src/lib/identity/types.ts`, `rules.ts` | pure types and rules (scope shapes, capability ↔ scope, full-session rule); each has its SQL twin |
| `src/lib/identity/access.ts` | `authorizeIdentityAction(session, { capability, scope }, check)`: the decision, with the database question injected |
| `src/lib/identity/server/session.ts` | `resolveIdentitySession()`: wraps the existing `resolveStaffIdentity()` and adds a verified auth user who is not staff |
| `src/lib/identity/server/guard.ts` | `requireIdentityAccess(capability, scope)` for future routes |
| `src/lib/identity/server/repository.ts` | the only code that calls the `customer_*` functions (service role) |

The guard's answers: signed out 401; an employee-code session 403 `full_session_required`; a quick Google session 403
`quick_session`; a malformed or over-wide scope 400; anything the database refuses 403 (the same for "does not exist" and "not
yours"); the database not answering 503. An unexpected answer is a refusal.

## Tests

- `npm run verify:identity-sql` (real Postgres via PGlite, synthetic two-business / two-organization world, 228 checks): applies
  in order and twice more with an identical schema snapshot; scoped foreign keys and ID swaps as the table owner and as the service
  role; one shared identity and duplicate-looking people; uniqueness; the access matrix for every role; revoked / expired /
  switched-off; grant and revoke with the actor recheck; nobody became staff and `is_op()` is unchanged; RLS, grants and real
  attempts as `anon` / `authenticated`; no duplicate function names; then the real `access.ts` deciding with the real SQL function
  for every session class. It runs inside `npm run qa` (the `checks` stage runs every `verify:*` script). Since review round 1 it
  also covers: bootstrap with two businesses and one organization (first administrator, the other business refused to add or
  revoke, an organization administrator adding another, recovery after revoked / expired / switched-off, suspended and ended
  agreements, the audit detail); proof that every path takes the organization row lock; 14 refusals that must be one identical
  answer; a refused auth-user deletion with principal, grant and audit intact; and a check that every foreign key has a usable
  supporting index (with a control that removes two indexes and must find exactly those two).
- `npm run identity:concurrency-docker` (**not** part of `npm run qa`: it needs Docker and the local `postgres:16` image, and
  never pulls one). PGlite has a single connection, so two real sessions are raced here against a throwaway Postgres 16 container
  with every migration applied: a held transaction makes the second business wait and then be refused; 12 simultaneous races end
  with exactly one winner each; a revoke of the last administrator makes a bootstrap wait and then succeed. `--without-lock`
  removes the lock inside the throwaway database and must fail. Exit 2 means "not run" (no Docker or no image), never "passed".
- `qa/stages/unit.mjs`: `identity-scope`, `identity-guard`, `identity-isolated` (no file outside `src/lib/identity` imports it or
  touches its tables; the server files are `server-only`; the pure files reach no server, secret or database).

## FABLE-002: organizations, departments and department-head invitations

Status: **built and tested locally (2026-11-12); waiting for Codex review; migration `20261112162132_customer_org_management.sql` is
NOT applied to production.** Everything above this section is the foundation and is unchanged: its three functions, its tables
and its bootstrap rule are byte for byte what Codex verified (`verify:identity-org-sql` compares the function bodies).

### What it adds
- One table, `customer_invitations`, and thirteen `customer_*` functions (service role only, security invoker, empty search path,
  `p_` parameters, one signature each).
- Two API families and four pages:

| Surface | Path | Who (guard) |
|---|---|---|
| Owner | `/owner/members`, `/api/owner/members/*` | a FULL owner session (the existing `requireOwner`, unchanged) AND `business_admin` on the Sarcafe business, asked from the database (`requireOwnerBusiness`). The business is this deployment's constant (`OWNER_BUSINESS_SLUG`), never a value from a request or a cookie |
| Organization administrator | `/benefits/manage`, `/api/benefits/manage/organizations/[id]/*` | a verified full Google sign-in with a live `organization_admin` grant on exactly that organization (`requireOrganizationAdmin`). No staff row needed, none created |
| Anyone signed in | `/api/benefits/manage/scopes`, `/api/benefits/invite/status`, `/api/benefits/invite/accept` | a verified full Google sign-in (`requireBenefitsUser`): says who is asking, gives nothing |
| Public | `/benefits` (sign-in door), `/benefits/invite` (page), `/api/benefits/invite/exchange` | nobody yet: these say nothing about any invitation |

Behind every route the `customer_*` function rechecks the same actor for the same scope, so a route guard is never the only lock.

### Who may manage an organization (`customer_org_manage_check`)
One rule for departments, invitations, department heads and the organization's own name and state:
1. an **organization administrator** (an active principal with a live `organization_admin` grant on it); or
2. **setup**: only while the organization has **no live administrator**, a business administrator of a business that has a
   `draft` or `active` agreement with it.

Setup is the foundation's first-administrator bootstrap condition, reused word for word: before an organization has its own
administrator, the business that brought it in sets it up; once one exists every business is refused (also the one that appointed
them) and the organization runs itself; if all its administrators are revoked, expired or switched off, setup reopens. A general
manager, a schedule delegate, an employee, a department head and a business without an agreement never pass. Nothing is inherited
from a badge or from schedule delegation.

**A decision Codex should confirm.** The foundation said "a department head is granted by an organization administrator". The
assignment says the owner manages organizations and departments "within explicit administration / agreement scope". Both are kept
by letting a business manage an organization's departments and head invitations **only in setup**, never next to an organization's
own administrator. `customer_access_grant` / `customer_access_revoke` are untouched (a direct department-head grant still needs
an organization administrator); the setup path exists only in the new functions. The stricter alternative (organization
administrators only) would leave the owner unable to do anything in a new organization, because no screen appoints an
administrator yet.

Every function that changes something locks the organization row first (the same lock the bootstrap takes), then the invitation,
then the principal, then the grant. So "is there a live administrator?" cannot interleave with a bootstrap, and two acceptances
of one invitation happen one after the other.

### Organizations and departments
- `customer_org_create`: a business administrator creates an organization **together with a draft agreement** to that business.
  A new organization is never unattached and cannot be attached to a business the actor does not administer; no route attaches
  an existing organization to another business.
- `customer_org_update`, `customer_department_create`, `customer_department_update`: rename, switch off, switch on. Switching
  off revokes the open invitations (audited with the count). Grants are kept and stop working while the department or the
  organization is off (`customer_access_check` needs both active), and work again when it is switched back on.
- A department is always named together with its organization: a department id from another organization is refused exactly like
  one that does not exist.
- `customer_department_head_revoke`: whoever may manage the organization ends a department head's grant. It refuses any grant
  that is not a department grant; organization and business grants stay under `customer_access_revoke` and its rules.
- A department head manages nothing in this slice: they see their own department (`customer_manage_scopes`), only theirs.

### Invitations
- **The token.** `dh1_` (purpose and version) + 32 random bytes in base64url. The server makes it, answers it once in the private
  response of the create call, and never stores or logs it. The database holds `sha256("sarcafe:identity:invitation:department_head:v1:" + token)`,
  so a token of one purpose can never match a row of another.
- **The intended recipient.** The issuer types the address of the person they mean. It is stored as a digest
  (`sha256("sarcafe:identity:recipient:v1:" + normalized address)`) and a masked hint (`d***@example.org`); the address itself is in
  no table and no audit row. Normalizing is trim and lower-case only: two different addresses are never guessed to be one person.
- **Delivery.** A private link the issuer copies: `<origin>/benefits/invite#<token>`. Nothing is sent: no e-mail, no SMS, no push.
- **The token never reaches a URL a server sees.** It is in the fragment. The invitation page removes it from the address bar at
  once (`history.replaceState`) and posts it to `/api/benefits/invite/exchange`, which sets an HttpOnly, SameSite=Lax cookie scoped
  to `/api/benefits/invite` for 30 minutes. The exchange asks the database nothing and answers every well-formed token the same.
- **Sign-in.** Google, through the same Supabase project, with `redirectTo = /auth/callback?next=/benefits/invite`. The callback
  accepts exactly two benefits return pages (`BENEFITS_RETURNS`, an exact list), returns there before anything that concerns staff
  (it claims no staff invitation and reads no staff row), and sends a failed benefits sign-in to `/benefits`, not to the staff login.
- **What proves the recipient.** `verifiedGoogleEmail(user)`: the auth server lists a Google identity whose own address Google
  marked verified, and it is the account's confirmed address. `user_metadata`, a typed address, a name or another kind of account
  prove nothing. The server computes the digest from the auth server's answer; nothing the browser sends is used.
- **Acceptance** (`customer_invitation_accept`), in one transaction: the invitation is open (not used, not revoked, not expired),
  the recipient digest matches, the user is not the issuer, the department and organization are active, the **issuer still has
  the authority to invite** (an invitation carries no more authority than its issuer has now: it dies when their grant ends, or
  when the organization gets its own administrator after a business invited), the user's principal is not switched off. Then the
  principal is created if the user has none (audit `principal.create`), the `department_head` grant is written (audit
  `access.grant`) or an existing live one is kept, the invitation is marked used with that principal and grant, and
  `invitation.accept` is written.
- **Refusals** are one answer (`denied`): unknown, used, revoked, expired, wrong recipient, switched off, issuer without authority.
  A wrong recipient leaves one audit row (`invitation.refuse`, at most ten per invitation) with no address in it.
- **Single use is a fact of the row.** A trigger refuses any change to a used or revoked invitation, also by the service role and
  the table owner; the scope, the digests and the expiry of an open one cannot be changed either.
- **One open invitation per department and recipient**: a new one supersedes the old link. At most 20 open per department, at most
  30 days (the screen offers 24 hours, 3 days, a week).

### Principals
This slice creates a principal in exactly one place: an accepted invitation (authorized by the invitation and its issuer's
live authority, audited, under the organization lock, with `on conflict` for the same person accepting two organizations'
invitations at once). **It introduces no way to switch a principal off or on.** A switched-off principal cannot accept.

### Screens (glass)
No Glisse skill exists in this environment (searched every skill location on 2026-11-12: there is no Glisse `SKILL.md`; what exists
is the `glisse` 0.5.0 package and the project's own glass documentation). The screens are built only from the shared pieces
under `docs/identity-system/10-glisse-design-contract.md`: `GlassDashboardShell` (owner page), `GlassPage` + a top bar of their own
for `/benefits` (the people there are not staff: no notifications, branch switch, finder or dock), glisse `Button` / `Input` /
`Menu`, `Seg`, `Pill`, `glassToast`, `.gl-surf` cards, `.sk` skeletons and a `loading.tsx` per route (`GlassSkeleton kind="members"`,
`BenefitsSkeleton`). `/benefits` has its own look wrapper (`src/app/benefits/layout.tsx`: `data-staff-theme`, no staff shell and no
motion code). No motion library, no direct `SegmentedControl` / `TabBar`, no hard-coded colour, no browser storage: the QA test
`identity.ui-contract` reads the source for exactly that.

### Code
| File | What |
|---|---|
| `supabase/migrations/20261112162132_customer_org_management.sql` | the table, the trigger, the thirteen functions |
| `src/lib/identity/invitations.ts` | pure: token shape, link, cookie, expiry choices, return pages, address rules, `verifiedGoogleEmail` |
| `src/lib/identity/server/invitations.ts` | the token and the two digests (`node:crypto`) |
| `src/lib/identity/server/organizations.ts` | one typed wrapper per function; a failed call is 503, never access |
| `src/lib/identity/server/guard.ts` | `requireOwnerBusiness`, `requireBenefitsUser`, `requireOrganizationAdmin` (added; `requireIdentityAccess` unchanged) |
| `src/lib/identity/server/http.ts` | private headers, same-origin strict JSON bodies, the refusal vocabulary, the two throttles |
| `src/lib/identity/server/org-handlers.ts` | the organization-scoped operations, written once, served by both families |
| `src/app/api/owner/members/**`, `src/app/api/benefits/**` | the routes (each names its guard) |
| `src/app/owner/members`, `src/app/benefits/**`, `src/components/identity/*` | the pages and screens |
| `src/app/auth/callback/route.ts`, `src/middleware.ts`, `src/lib/tools/index.ts` | one branch, two entries, one tool (see below) |

Changes to existing files, all additive: the auth callback gets one branch for the two benefits return pages (every other path
through it is as before); the middleware adds `/owner/members` to the owner-only list and sends a signed-out visitor of
`/benefits/manage` to `/benefits` and a signed-in visitor of `/benefits` on to `/benefits/manage` (`/benefits` is in none of the staff
lists on purpose); the tool finder gets one owner-only
entry (the home lists are unchanged); `GlassSkeleton` gets one more shape; `resolveIdentitySession` also returns the verified address.

### Throttles
Ordinary writes use the general limiter (fails open; the database rechecks every actor anyway). Making, trading, looking at and
accepting an invitation use the credential limiter, which **fails closed**: when it cannot be asked the answer is 429 and nothing
is created or consumed.

### Tests
- `npm run verify:identity-org-sql` (PGlite, part of `npm run qa`): the migration (newest, idempotent, exactly one table and
  fourteen functions, the foundation's functions byte for byte the same), privileges, and every function as the service role in a
  world of two businesses: creation only inside one's own business, setup and its end, departments and ID swaps, invitations
  (digests only, superseding, the 20 limit), peek, acceptance (wrong recipient, issuer, expired, revoked, switched off, issuer
  without authority, replay, an existing head), the row's own constraints, switching off and on, ending a head, the reads, the
  organization lock on every changing function (with controls), nobody became staff.
- `npm run verify:identity-sql` still checks the foundation, now with this migration applied after it.
- `npm run identity:concurrency-docker` (not part of `npm run qa`: needs Docker): sections 4-8 race real sessions on Postgres 16:
  eight sessions accept one invitation (exactly one wins, the others get a plain refusal); one new user accepts two organizations'
  invitations at once (one principal); an acceptance races a revocation (one consistent outcome); an acceptance waits for a
  bootstrap that ends its issuer's authority and is then refused; and the other way round. `--without-lock` must fail.
- `npm run qa`, stage `identity` (`qa/live/identity.mjs`): the production build against the stand-in, whose identity functions
  are answered by a **real Postgres with the real migrations** (`qa/standin/identity-db.mjs`). The role, session and tenant matrix
  of both families, the invitation's whole life over HTTP, six simultaneous acceptances, the limiter failing closed, database
  outages and a migration that is not applied (503, nothing consumed, recovery), private headers, the sign-in return and the
  middleware (an external person never reaches a staff, owner or POS page or API), and the screens in a real browser: the owner's
  flow, the invitation page (the token leaves the address bar, is in no request URL and in no script-readable storage), the head's
  page, five looks measured for contrast, three widths, iPhone edges, reduced motion.
- Unit stage: `identity-invitations` (the pure rules) and `identity-isolated` (only the listed routes and screens import the
  module; nothing else touches an identity table or function).

### Limits of this slice
- No screen appoints an organization administrator yet (the database rule and the benefits family are tested with one written
  directly into the test database). Until one exists, an organization created by the owner stays in setup.
- Real concurrency is proven only by the Docker script, which is not in `npm run qa` or GitHub Actions.
- The stand-in's identity database is PGlite: real SQL, one connection, not hosted Supabase. Production grants were not queried.
- A real Google sign-in was not exercised (the suite signs people in with the stand-in's sessions). The redirect address
  `/auth/callback?next=/benefits/…` uses the same callback path as the staff sign-in; whether the project's allow-list accepts it
  with that query must be checked on a preview before release.
- The invitation cookie holds the token for up to 30 minutes on the recipient's device (HttpOnly, never readable by a script).
- A department head has nothing to do yet beyond seeing their department: registration and approval are FABLE-003.
- `/benefits` is classified as a private (administration) route in `scripts/check-a11y-scope.mjs`, so the customer accessibility
  widget and skip link are not drawn there. The people there are not staff and not customers; the owner may decide otherwise.
- Not built on purpose: e-mail or SMS delivery, organization-administrator invitations, switching a principal off, erasure.

### Review continuation, 2026-11-13 (Claude Opus 5.5, owner-authorized replacement for Fable; not a Codex verification)
- **Both write DELETEs check the Origin themselves** (`deleteInvitation`, `deleteHead` in `server/org-handlers.ts`); before, they
  relied on the middleware alone. QA `identity.cross-site-writes` sends every management write of both families from another
  site (403, nothing written) with same-origin controls.
- **Open decision D1 (setup authority), behaviour pinned, not approved:** `verify:identity-org-sql` section "under review (D1)".
  While an organization has no live administrator, ANY business with a draft/active agreement can revoke the other business's
  invitations, end heads it invited and switch the organization off/on; a suspended agreement loses that at once; the bootstrap
  ends it for both businesses and kills setup-era invitations; heads accepted during setup keep their grant. In practice only the
  creating business has an agreement (no function attaches a second business), so the cross-business case needs data written
  outside this slice.
- **Open decision D2 (`/benefits` private):** `check:a11y-scope` now classifies `/benefits` subpages one by one (`invite`,
  `manage`); a new one (the planned `/benefits/register` for invited employees) fails the check until it is decided on purpose.
- **Identity proof, residual risk for review:** the recipient check proves the *account* holds a Google identity with that verified
  address; it does not check that the *current session* was made through Google (the JWT `amr`). If the hosted project allows
  e-mail/password sign-up without confirmation, or manual identity linking, a pre-created account could later absorb the victim's
  Google identity. Hosted Auth settings must be checked (see handoff); an `amr` check was not added because it cannot be verified
  without a real Google sign-in.
- QA `identity.ui-keyboard`: the invitation page's states in all five looks (contrast) and keyboard-only acceptance with a visible
  focus ring.

## Before it is applied to production (not done, not authorized)

Two migrations, in this order: `20261112125033_customer_identity_foundation.sql`, then `20261112162132_customer_org_management.sql`
(run the "Check after applying" query at the end of each and record both ledger rows). Before that: `npm run verify:identity-sql`,
`verify:identity-org-sql`, `verify:schedule-sql`, `verify:checklist-sql`, `verify:onboarding-sql`, and a duplicate-name check in `pg_proc`.


Run `verify:identity-sql` with the three mandatory verifiers and `verify:waitlist-sql`, check `pg_proc` for duplicate names, run the
"Check after applying" query at the end of the migration, and record the ledger row `20261112125033` /
`customer_identity_foundation`. Applying it creates the Sarcafe business row and maps the existing branches; it creates no member,
principal, grant or membership. A branch created later is not mapped automatically.

## Known limits

- No route calls the guard yet, so `server/session.ts`, `server/guard.ts` and `server/repository.ts` are covered by the type check,
  the production build and the isolation test, not by a live request. The decision they delegate to is tested against real SQL.
- PGlite is real Postgres, not Supabase: the default privileges Supabase gives the service role are imitated by the verifier; the
  production grant state was not queried.
- A principal's `member_id` cannot change after creation (a later slice that links an operator to a member must do it on purpose).
- The migration file was renamed once before it was ever applied (`20261112120000` → `20261112125033`, its real UTC creation
  time, review R4). No database has the old version.
- An auth user that is a principal cannot be deleted at all (review R2). Until an erasure flow is designed, removing such an
  account from Supabase Auth fails with a foreign-key error; that is intended.
- The two-session test needs Docker, so it does not run in `npm run qa` or in GitHub Actions; the lock is otherwise covered by the
  single-connection lock checks in the verifier.
- Capabilities for scanning, invitations, photos, credentials, consent, Wallet and benefits belong to later slices.
