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
| Organization administrator | `/benefits/manage`, `/api/benefits/manage/organizations/[id]/*` | a session that is a proven Google sign-in (see "Current-session proof" below) with a live `organization_admin` grant on exactly that organization (`requireOrganizationAdmin`). No staff row needed, none created |
| Anyone signed in | `/api/benefits/manage/scopes`, `/api/benefits/invite/status`, `/api/benefits/invite/accept` | a session that is a proven Google sign-in (`requireBenefitsUser`): says who is asking, gives nothing |
| Public | `/benefits` (sign-in door), `/benefits/invite` (page), `/api/benefits/invite/exchange` | nobody yet: these say nothing about any invitation |

Behind every route the `customer_*` function rechecks the same actor for the same scope, so a route guard is never the only lock.
The owner family also needs the proven Google session: `requireOwnerBusiness` asks `requireIdentityAccess`, which applies the same
current-session rule after the unchanged `requireOwner`.

### Current-session proof (review R1, 2026-11-13)
Every identity guard asks how THIS session signed in, not what the account has (`src/lib/identity/session-proof.ts`, used by
`server/session.ts`; one refusal rule, `sessionRefusal` in `access.ts`, for both families):
1. the auth server returns the user for the session (`auth.getUser()`), and the installed SDK validates the current access token's
   claims (`auth.getClaims()`: the signature against the project's keys, or, for a symmetric key, the auth server itself);
2. the claims belong to that user (`sub` equals the user id) and name their session (`session_id`); not anonymous;
3. the session's `amr` (Supabase's documented `[{ method, timestamp }]`) contains `oauth`, and every other entry is neutral
   (`token_refresh` or a second factor: `totp`, `mfa/*`). Anything that signs a person in another way (password, otp, magiclink,
   recovery, invite, email/signup, email_change, anonymous, sso/saml, web3, `oauth_provider/authorization_code`, an unknown method)
   disqualifies; a missing, empty or malformed `amr` (including the plain-string form) disqualifies;
4. the account holds a Google identity whose own address Google verified and that equals the account's confirmed address
   (`verifiedGoogleEmail`).
A session passing all four is `via: 'google'`. A quick six-digit session is `quick` (asked by the claims' own `session_id`, before
anything else), an auth-user session failing any step is `other`, the employee-code cookie is `employee_code`. Refusals carry a
code the screens act on: `403 google_session_required`, `403 quick_session`, `403 full_session_required`; `401` signed out. The auth
server not answering, or the quick-session lookup failing, is `503` (never access). The verified address is returned only on a
`google` session. `user_metadata`, `app_metadata.provider(s)` and the identity list are never read as proof of the session.

**What `amr` cannot say:** `oauth` does not name the provider. Steps 3 + 4 mean "an OAuth sign-in on an account whose Google
identity is verified"; that equals "a Google sign-in" only while **Google is the only OAuth provider enabled** in the project's Auth
settings. That setting and **one real Google round trip** (sign in on a preview, open `/benefits/manage`, accept an invitation) are
release prerequisites. Enabling any other OAuth provider requires a provider-specific provenance review first.

**Reauthentication:** a signed-in session that is not `google` sees `BenefitsReauth` on `/benefits/manage` and `/benefits/invite`:
what is needed, and one "sign in again with Google" button that returns to the same page (the invitation cookie survives). Nothing
redirects by itself (the middleware still sends a signed-in visitor of `/benefits` to `/benefits/manage` once, and that page never
redirects a signed-in session), so there is no loop; signing out stays in the top bar's menu. The staff app is unchanged: the staff
session resolver, `requireOwner`, POS and employee-code login do not use this rule.

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
- **A switched-off organization stays with its administrator (review R2).** `customer_manage_scopes` lists every organization the
  person holds a live `organization_admin` grant on, active or not, with its `state`; `/benefits/manage` shows it marked off (red
  note, "כבוי" in the chooser) with the button that switches it back on, also after a reload. While it is off only looking,
  renaming, switching it on and taking authority away are accepted (`customer_org_manage_check(..., true)`); new departments,
  department changes and invitations are refused, and the screen does not offer them. Department heads see departments only in
  active organizations and active departments, and acceptance refuses both. Nobody without a live administrator grant lists it.
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
  the authority to invite** (an invitation carries no more authority than its issuer has NOW: it cannot be used while the issuer
  lacks that authority, for example once the organization has its own administrator after a business invited in setup. It is
  **not revoked** by that: if the authority returns before it expires (the last administrator is revoked, so setup returns), it
  is usable again. Codex verified this lifecycle and it is kept; the future appoint-administrator screen must explain it), the
  user's principal is not switched off. Then the
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
- `/benefits`, `/benefits/manage` and `/benefits/invite` are private administration pages without the customer accessibility
  widget and skip link (D2, decided by Codex 2026-11-13, for exactly these three); component accessibility (keyboard, focus,
  contrast in five looks, RTL, reduced motion) still applies. Any new benefits page needs its own classification.
- The current-session proof depends on Google being the only OAuth provider; a real Google round trip was not made (see above).
- Not built on purpose: e-mail or SMS delivery, organization-administrator invitations, switching a principal off, erasure.

### Review continuation, 2026-11-13 (Claude Opus 5.5, owner-authorized replacement for Fable; not a Codex verification)
- **Both write DELETEs check the Origin themselves** (`deleteInvitation`, `deleteHead` in `server/org-handlers.ts`); before, they
  relied on the middleware alone. QA `identity.cross-site-writes` sends every management write of both families from another
  site (403, nothing written) with same-origin controls.
- **Open decision D1 (setup authority), behaviour pinned, not approved:** `verify:identity-org-sql` section "under review (D1)".
  While an organization has no live administrator, ANY business with a draft/active agreement can revoke the other business's
  invitations, end heads it invited and switch the organization off/on; a suspended agreement loses that at once; the bootstrap
  ends it for both businesses and makes setup-era invitations unusable while an administrator exists (corrected wording: they are
  not revoked, and work again if setup returns before they expire); heads accepted during setup keep their grant. In practice only the
  creating business has an agreement (no function attaches a second business), so the cross-business case needs data written
  outside this slice.
- **Open decision D2 (`/benefits` private):** `check:a11y-scope` now classifies `/benefits` subpages one by one (`invite`,
  `manage`); a new one (the planned `/benefits/register` for invited employees) fails the check until it is decided on purpose.
- **Identity proof, residual risk for review (SUPERSEDED by review R1 below):** the recipient check proves the *account* holds a Google identity with that verified
  address; it does not check that the *current session* was made through Google (the JWT `amr`). If the hosted project allows
  e-mail/password sign-up without confirmation, or manual identity linking, a pre-created account could later absorb the victim's
  Google identity. Hosted Auth settings must be checked (see handoff); an `amr` check was not added because it cannot be verified
  without a real Google sign-in.
- QA `identity.ui-keyboard`: the invitation page's states in all five looks (contrast) and keyboard-only acceptance with a visible
  focus ring.

## Codex review decision, 2026-11-13 (`82e2deb`)

FABLE-002 has **CHANGES REQUESTED**, not verification. The existing full QA suite passed, but independent API/browser probes found two missing cases: non-OAuth sessions pass the identity guards (including password acceptance of an invitation on a Google-linked account), and deactivating an organization removes it from its administrator's management list, hiding reactivation. Correct both and add regressions before FABLE-003.

- **Current-session policy:** for identity management/acceptance, require validated OAuth session evidence and the account's matching confirmed Google-verified identity, with quick/code sessions still denied. Supabase AMR says `oauth`, not `google`, and is not provider-specific. Google-only OAuth provider configuration and a real Google round trip are explicit release prerequisites; any additional provider requires a provider-specific provenance review. Linked identities or user-editable metadata alone are insufficient. Hosted account takeover was not reproduced.
- **D1 accepted for this slice:** setup follows the current no-live-administrator plus draft/active-agreement rule, including its tested shared-business consequences. Administrator appointment must be available before release; revisit/restrict setup authority before a later attach-business feature. **Bootstrap does not permanently revoke pending setup invitations:** they are unusable while their issuer lacks authority and can become usable again if that authority returns before expiry. An independent SQL probe verified that revival after the last administrator is revoked. The appointment flow must explain this rule; no silent lifecycle change is authorized by the correction.
- **D2 accepted for the current three pages:** `/benefits`, `/benefits/manage`, `/benefits/invite` are private administration pages without the customer widget/skip link, retaining component accessibility requirements. Future member-facing registration needs its own classification.
- **Evidence and exact corrections:** newest Codex entry in root `handoff.md`; FABLE-002 remains changes requested and FABLE-003 unauthorized. Both identity migrations remain NOT APPLIED TO PRODUCTION.

## Review corrections R1 / R2, 2026-11-13 (Claude Opus 5.5, owner-authorized; ready for Codex review, not verified)

- **R1, current-session authentication:** see "Current-session proof" above. Files: `src/lib/identity/session-proof.ts` (new, pure),
  `server/session.ts` (labels from the validated claims; the old code labelled every auth user `google`), `types.ts` (`via` is now
  `google | quick | other | employee_code`; denial `google_session_required`), `access.ts` (`sessionRefusal`), `server/guard.ts`
  (coded 403s), `components/identity/BenefitsReauth.tsx` (new), `BenefitsManage.tsx`, `InvitationAccept.tsx`,
  `app/benefits/manage/page.tsx`. QA stand-in: seeded sessions carry `amr: [{ method: 'oauth' }]` like a real Google sign-in;
  `tokenForMethod` mints the others.
- **R2, inactive-organization recovery:** `customer_manage_scopes` in `20261112162132_customer_org_management.sql` (edited in place:
  the migration was never applied anywhere but in-memory/disposable databases) lists inactive organizations for their live
  administrators with `state`; `ManageScopes.organizations[].state`; `BenefitsManage` keeps the open organization and marks the
  chooser; `OrganizationManager` says the organization is off (red) and stops offering department work while it is.
- **D1 / D2 as decided by Codex**, wording corrected above (setup invitations are unusable, not revoked, after appointment).
- **Tests added:** unit `identity-session-proof` (both reproduced cases and 30 other sessions, with the reason for each),
  `identity-session-resolver` (the real resolver transpiled with the SDK mocked: labels, fail-closed lookups), five new rows in
  `identity-guard`; `verify:identity-org-sql` section "review R2" (single and two organizations, off / fresh read / on, head and
  invitation stay off, six outsiders refused, expired / revoked / switched-off administrators) and the D1 revival check (162 →
  183 checks); QA identity `session-method` (both reproduced HTTP cases with Google controls, eight other sessions on four doors,
  owner family, quick and code codes, staff dashboard unchanged), `org-recovery` (API), `ui-reauth` (no loop, five looks, invite
  page then Google acceptance), `ui-recovery` (switch off → still there → reload → switch on, two organizations, five looks).

## FABLE-003: employee registration, private photos and review

Status: **built and tested locally (2026-11-24, Claude Opus 5.5, owner-authorized while FABLE-002 waits for Codex); NOT reviewed by
Codex; migration `20261124074218_customer_employee_registration.sql` is NOT applied to production.** It is built ON TOP of the
FABLE-002 corrections that Codex has not verified yet: if Codex changes FABLE-002, this slice may need to follow.

### What it adds
- Six tables: `customer_notices` (the versioned text a person accepts, with the retention the business decided), `customer_registration_invites`
  (single-use links, digests only), `customer_registration_sessions` (short, bound to one link AND one signed-in user),
  `customer_member_profiles` (first / last name and nickname, as THIS organization holds them), `customer_member_photos` (facts of a photo;
  the image is in private storage), `customer_consent_events` (append-only evidence). One unique index on `customer_org_memberships
  (organization_id, id)` for the scoped foreign keys; no other earlier object changes (the verifiers compare every earlier identity function
  byte for byte).
- Fourteen `customer_*` functions (service role only, one signature each) and two trigger functions; a private bucket
  `customer-identity-photos` (public = false, JPEG only, 2 MB) with a RESTRICTIVE storage policy that denies every browser role.
- API: `/api/benefits/register/*` (the employee), `/api/benefits/me/*` (the employee's own applications),
  `/api/benefits/manage/organizations/[o]/departments/[d]/{registrations,members}/*` (a reviewer), `/api/cron/identity-photo-cleanup`
  (CRON_SECRET; **not scheduled**). Pages: `/benefits/register` (new), and `/benefits/manage` gains "הבקשות שלי" and the department's employees.

### Who may do what
| Who | May |
|---|---|
| The department's head (live `department_head` grant on exactly that pair) | make / end that department's registration links, list its applications and members, see their photos, approve / reject / deactivate / reactivate |
| An administrator of the organization | the same, for every department of it |
| The employee (a proven Google session, `requireBenefitsUser`) | open a link into a registration session, upload one photo, submit one application per organization; see and change their own applications; see their own photo |
| A business owner (also in setup), a general manager, a head of another department, another organization, anyone else | nothing here (`403`, the same answer for "not yours" and "does not exist") |

`customer_dept_review_check` is the one rule (both the organization and the department must be on). **Owners never review an
organization's employees and never see their photos** (decision for Codex, D4 below). The route names the organization and
department; the review and photo functions refuse a membership of another department even for someone who reviews both.

### The flow
1. **A link.** A reviewer makes a link (`er1_` + 32 random bytes; 3 / 7 / 14 days; at most 100 open per department). Only
   `sha256("sarcafe:identity:registration:link:v1:" + token)` is stored. It is answered once and copied by hand; nothing is sent.
   `<origin>/benefits/register#<token>`: the token is in the fragment.
2. **The page** removes the fragment at once and posts the token to `/api/benefits/register/exchange` (public, format check only,
   fail-closed limiter), which sets an HttpOnly cookie for `/api/benefits/register` (30 minutes).
3. **Google sign-in** (return page `/benefits/register` added to `BENEFITS_RETURNS`). Then `/open` (`customer_registration_open`):
   the link must be open, its department and organization on, its issuer still a reviewer of that department (a link carries no
   more authority than its issuer has now; it is usable again if that authority returns before it expires, like FABLE-002's
   invitations), the person not the issuer, not already registered in that organization ('conflict'), and **a notice must be
   published** ('closed' otherwise). It makes a registration session (`rs1_` secret in a second HttpOnly cookie, one hour; the table
   refuses more than two) bound to the link and the person, ending their earlier one on the same link. At most ten opens per link.
4. **The photo** (`/photo`, the raw file, at most 8 MB, read as a bounded stream): `src/lib/identity/server/photo.ts` checks the
   bytes' own signature (JPEG / PNG / WebP), decodes it completely with sharp 0.35.5 (now a pinned dependency) within 40 megapixels,
   refuses SVG / HTML / PDF / GIF / HEIC, a lying signature, animation, truncation, less than 200 px, then turns it upright and makes
   a NEW JPEG of at most 1024 px with no metadata at all (no EXIF, GPS, camera, ICC, XMP), and checks the result once more. The row is
   written first (`customer_photo_intent`, state `uploading`; the DATABASE makes the object path `org/<organization>/<photo id>.jpg`),
   then the object is uploaded (never overwriting).
5. **The application** (`/submit`, `customer_registration_submit`, one transaction): the notice the person accepted must be the one
   published now ('stale'); the principal is created when they have none (with a member), an operator principal (a head, an
   administrator) gets a separate member for the application; a PENDING membership of that department, the names, the photo linked,
   the consent event, the link consumed, the session used, the audit (ids only). The same session or link cannot submit twice.
6. **Review** (`customer_membership_review` with the version the screen showed): approve (pending → approved; the waiting photo
   becomes THE photo), reject (reason required), deactivate (reason required, at once), reactivate. Nobody reviews their own
   application (checked by principal AND by auth user). Every decision bumps the version and writes `membership.<decision>`. That
   version is the extension point for later credentials and Wallet passes: they bind to it, so a decision invalidates them at once.
7. **Changes by the employee** (`/api/benefits/me/[id]`, `customer_membership_resubmit`): a changed first / last name, nickname or a
   new photo sends the membership back to PENDING (version + 1); the approved photo is kept until its replacement is approved. An
   inactive membership is changed only by a reviewer. A rejected one may be corrected and sent again.

### Photos stay private
- Read only through the proxy routes, after `customer_photo_open` rechecks the viewer (a reviewer of THAT department, named in the
  path, or the applicant), and every read is an audit row `photo.read`. No signed URL, no public URL, no listing, ever.
- The proxy recomputes the stored object's sha-256 and refuses one that does not match the database (a swapped object is not shown).
- Responses: `image/jpeg`, `private, no-store`, `Pragma: no-cache`, `no-referrer`, `nosniff`, `Cross-Origin-Resource-Policy: same-origin`,
  `Content-Security-Policy: default-src 'none'; sandbox`. Refusals are JSON with the same private headers (`next.config.mjs` covers
  `/api/benefits/*`). The service worker (`public/sw.js`) has no fetch handler, so it caches nothing.
- The screens fetch the photo with `cache: 'no-store'`, show it from an object URL that is revoked when it leaves the screen (closed,
  another person, a decision, the page hidden, unmount); a late answer for a photo no longer asked for is dropped. No `next/image`.

### Notice and retention (nothing invented)
**Collection is closed until the business publishes a notice.** No notice is seeded and there is no screen for it yet: the text and
the retention must be written and approved by the business, then inserted as `published` (SQL editor, or a later owner tool). The
retention is stored WITH the notice (`{ "rejected_days": n, "replaced_photo_days": n }`); a missing key means nothing of that kind is
deleted by age. The cleanup job (when scheduled) deletes uploads that never became an application after one hour (always), and
rejected / replaced photos and rejected applications' names after the published number of days.

### Tests
- `npm run verify:identity-registration-sql` (PGlite, part of `npm run qa`): 185 checks — the migration (newest, idempotent, exactly six
  tables and sixteen functions, every earlier identity function byte for byte, no earlier privilege changed), privileges and the bucket,
  who reviews (16 cases, an owner in setup included), links, the session (closed, draft, expiry, revoked, switched off, issuer without authority and back, limits),
  photos (the path made by the database, limits, another tenant refused by the table), the application (stale notice, names,
  replay, one per organization, two people with the same names stay two, an operator applying), review (self-review, ID swaps,
  stale, conflicts, every decision, retention dates), the list, photo reads (scope, self, rejected), changes sent back to review,
  own data, cleanup, the rows' own rules, nobody became staff.
- Negative controls (2026-11-24, a scratch copy, never the repository): seven deliberate breaks of the migration each make
  `verify:identity-registration-sql` fail: self-review allowed, a stale notice accepted, collection open without a notice, review not
  matched to the route's department, a photo read across departments, an owner in setup reviewing, a change keeping the approval.
- `npm run check:identity-photo` (part of `npm run qa`): 27 checks on crafted images with the real sharp.
- `verify:identity-sql` and `verify:identity-org-sql` now measure their own migration's additions at the moment it was applied (later
  identity migrations may follow); counts unchanged (229, 183).
- QA stage `registration` (`qa/live/identity-registration.mjs`): closed collection, the reviewer matrix, the link and the session over
  HTTP, photo checks over HTTP (stored bytes inspected), review with the proxy's headers, a tampered object, the employee's own
  changes, an approved employee is not staff, storage outage and the cleanup job, a missing migration; the screens in a real browser
  (registration, review with the photo, five looks, 360 px).

### Decisions for Codex (FABLE-003)
- **D3, employees sign in with Google.** The plan's registration session is kept (short, one link, one person), and the applicant must
  also hold a proven Google session. It is what makes "nobody reviews their own application" checkable, and gives the employee a way
  back to their own application and photo. Without it, a department head could register and approve themselves. Cost: an employee
  needs a Google account.
- **D4, owners do not review employees.** Only the organization's own people (its administrator, the department's head) see employees'
  names and photos; Sarcafe owners do not, also in setup.
- **D5, `/benefits/register` is private for now** (no customer widget or skip link, like the three administration pages of D2). It was
  first made customer-facing; the widget's own start-up toast then measured 3.3:1 in the light "crema" look of the /benefits look
  system. The page itself is tested for contrast in five looks, keyboard use and RTL. Employees are members of the public, so this
  should be revisited (adapt the widget's colours to the five looks, then classify it customer-facing).
- **D6, a change of details sends an approved membership back to pending at once** (it gives nothing until re-approved), rather than
  keeping the old approved details active beside the pending ones. The approved photo is kept for the reviewer to compare.

### Limits of this slice
- The notice text, its language set (Hebrew only today) and the retention durations are business inputs; nothing collects until then.
- The cleanup route is not scheduled (no `vercel.json` entry): schedule it with the release.
- Real Supabase Storage semantics (bucket policy, service-role-only download) are not proven by the stand-in; a test project is needed.
- The reviewer list shows at most 100 people per state on one page (no paging control in the screen yet).
- A registration link is not bound to a person (employees may have no address known to the head); the reviewer's visual check is the
  authority. A forwarded link lets someone else apply, and the head rejects them.
- Switching a department off does not revoke its registration links (they stop working while it is off, like FABLE-002's invitations).
- No erasure on request yet (rejected / replaced data is removed only by the published retention).

## Before it is applied to production (not done, not authorized)

Three migrations, in this order: `20261112125033_customer_identity_foundation.sql`, `20261112162132_customer_org_management.sql`, then
`20261124074218_customer_employee_registration.sql` (run the "Check after applying" query at the end of each and record each ledger
row). Before that: `npm run verify:identity-sql`, `verify:identity-org-sql`, `verify:identity-registration-sql`, `verify:schedule-sql`,
`verify:checklist-sql`, `verify:onboarding-sql`, and a duplicate-name check in `pg_proc`.


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
