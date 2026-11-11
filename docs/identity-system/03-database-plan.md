# 03 — Proposed database and migration plan

No schema changes have been implemented or applied. Names below are **proposed**. The existing `customer_waitlist_*` domain is the naming precedent; extend `customer_*` rather than putting external beneficiaries in `staff_*` or inventing unprefixed platform tables. Preserve `sched_*`, `pos_*`, `staff_*`, `checklist_*`, `order_*` domains and all existing signatures.

## Logical tables

| Proposed table | Key data and integrity |
|---|---|
| `customer_members` | Private global UUID, lifecycle state, created/updated timestamps; no global unique phone/name or public directory |
| `customer_principals` | Verified auth subject binding to member/actor; unique provider subject; never inferred from email text; operator binding separately validated |
| `customer_businesses` | UUID, unique slug, active state, timezone; Sarcafe is explicit seed/config, future businesses isolated |
| `customer_business_branches` | Business-to-existing-branch map; unique branch assignment; no destructive change to `branches` |
| `customer_organizations` | Independent organization UUID, name, state; not an authorization synonym for business |
| `customer_business_orgs` | Explicit business/organization agreement, state, allowed purpose; unique pair |
| `customer_departments` | Organization FK, name, active; unique `(organization_id,id)` for scoped composite references |
| `customer_access_grants` | Principal, role/capability, exact business OR organization/department scope, expiry/revocation; CHECK prevents ambiguous global scope |
| `customer_org_memberships` | Member, organization, department, pending/approved/rejected/inactive state, approval actor/time/reason, version; composite FK keeps department in organization |
| `customer_business_memberships` | Business, member, enrollment source, state, version, scoped profile/contact projection; unique `(business_id,member_id)` |
| `customer_invitations` | Organization/department, purpose, recipient binding, token digest, expiry, consumed/revoked time, issuer; token unique; no plaintext token |
| `customer_registration_sessions` | Token digest, invite, narrow scope, expiry/revocation; cannot become a staff session |
| `customer_member_photos` | Scoped membership FK, opaque private object path, sanitized MIME/dimensions/size, state/version, uploader; no public URL |
| `customer_member_contacts` | Scoped membership contact, verification evidence/time and consent purpose; phone stored as text; no global auto-merge |
| `customer_consent_events` | Member and scope, purpose/channel, notice/language/version, grant/withdraw, time, actor; append-only evidence with erasure minimization |
| `customer_waitlist_links` | Existing contact FK, business membership FK, verified claim evidence, actor/time; nullable contact after erase, no duplicated historical PII |
| `customer_credentials` | Scoped membership, audience, opaque token hash, version, expiry/revocation; optional encrypted reissuance material, never plaintext token |
| `customer_verifications` | Credential version, membership version, scanner/branch/business, match decision, expiry/consumed time; one sale context, not a reusable grant |
| `customer_benefit_policies` | Business/agreement/branch scope, immutable published version, explicit eligibility and money rules, effective dates, draft/active/disabled |
| `customer_redemptions` | Business/branch/member/policy version/sale reference, server-evaluated amount in agorot, verification, actor, idempotency key + request hash, status |
| `customer_reward_ledger` | Business membership, immutable accrual/redeem/reverse entries, business event reference; no client-editable balance |
| `customer_wallet_passes` | Membership/brand/provider, unique issuer/object/serial mapping, lifecycle, desired/applied version, credential ID, encrypted protocol secret + hash |
| `customer_wallet_registrations` | Pass/device relation and protected provider push token; separate from staff/customer Web Push tables |
| `customer_identity_jobs` | Scoped provider/notification work, dedupe key, attempts/next time, desired version; transactional outbox, inert adapter default |
| `customer_program_settings` | Business/optional branch, legacy collection override + new explicit OFF booleans, version, updated actor/time |
| `customer_identity_audit` | Business or organization scope, actor, operation, target ID, reason, minimal before/after non-secret state, correlation ID; no raw photos/tokens/contact values |

Fable may simplify tables where equivalent constraints remain explicit, but must explain deviations before implementation. Do not create all future tables in FABLE-001: stage migrations with the owning task. Use UUID PKs, `timestamptz`, bounded fields, meaningful CHECK constraints, indexed FKs and scoped unique indexes. Every scoped relation must be impossible to connect to the wrong tenant via an ID swap. Shared identity/organization exceptions need explicit access rules, not fictitious `tenant_id` fields that imply ownership incorrectly.

## Access and functions

- Enable RLS on every new public table. Revoke browser grants from `public`, `anon`, `authenticated`; grant only the necessary service-role table permissions explicitly. Grant required sequence privileges if any sequences are introduced. RLS alone does not establish isolation because the server service role bypasses it.
- Every route resolves actor and scope server-side. Transaction RPCs recheck the supplied trusted actor's grant and target relationships, with negative tests. Browser JSON must not choose the actor or role. Prefer invoker semantics; any necessary definer function uses a fixed safe `search_path` and qualified identifiers.
- New exposed RPCs use a `customer_` domain prefix, parameters `p_*`, **one name / one signature**. Helpers keep `is_` / `can_`; `internal_*` helpers are revoked from browser roles AND `service_role`, invoked only through narrowly authorized wrappers if required.
- Explicit `revoke all on function ... from public, anon, authenticated` followed by exact-signature `grant execute ... to service_role`. Never edit an applied function migration. A signature change drops the old signature in the same new migration and updates every caller.
- Example planned contracts: `customer_invitation_accept`, `customer_membership_review`, `customer_credential_revoke`, `customer_benefit_redeem`, `customer_program_update`. These are design names, not existing RPCs.
- Global identity cannot be selected through tenant directory endpoints. Select the minimum scoped fields; require business-organization agreement for employee verification across those boundaries.

## Transaction invariants

**Invite:** hash lookup + expiry/revocation/purpose/recipient/scope check + session/grant creation + consume + audit in one transaction. Two concurrent acceptances produce one grant. A failed application/photo validation does not irreversibly consume a usable invite without a recovery path.

**Approval/deactivation:** check reviewer scope; disallow self-approval; change membership version; revoke verification contexts/QR eligibility immediately; enqueue idempotent Wallet update; append audit in the same transaction. A stale Wallet image cannot override the DB state.

**Redemption:** lock/check current settings, active actor/grant, credential/membership, agreement, policy version, sale context, verification expiry/match and available reward quota. Recompute integer monetary values from authoritative server inputs. Insert redemption and quota/ledger effect atomically. Unique `(business_id,action,idempotency_key)` plus payload hash rejects same-key/different-body retries. Also use a uniqueness/locking rule on the verified sale+benefit+member so a fresh key cannot redeem the same benefit twice. Lock quota rows or use equivalent serializable discipline for parallel different-sale attempts. Reversal is an audited compensating entry, never deletion of history.

**Flag transition:** check full owner/business authority, optimistic settings version, valid dependencies; append audit atomically. Redemptions/issuance/outbox dispatch read fresh settings, so a stale tab cannot bypass OFF. Missing config means new capabilities OFF; storage outage never means enabled.

## Migration and release discipline

1. Discover latest migration at implementation time (currently `20261107000000_kiosk_pairings.sql`). Name the next additive/idempotent migration `YYYYMMDDHHMMSS_snake_case_summary.sql`, UTC and strictly later. Keep exact ledger version/name matching. Never add numbered `025_*` or modify applied files.
2. Rehearse all migrations on isolated PGlite/Postgres; reapply each new migration and compare invariants. Seed only synthetic tenant pairs. No production backfill or enrollment from waitlist is implicit.
3. Verify all new-table RLS/grants, private storage permissions, function exact signatures and `pg_proc` duplicate names. Run `verify:schedule-sql`, `verify:checklist-sql`, `verify:onboarding-sql`, `verify:waitlist-sql`, and new identity SQL checks. Test grants as browser roles and intended service role.
4. Existing waitlist collection must continue if the new membership migration is absent. New membership endpoints fail closed with a clear unavailable response. No broad catch-and-enable fallback.
5. Before any authorized production application: record migration checksums and current ledger, rehearse, review security advisors, obtain explicit release authorization, apply and verify exact ledger row plus duplicates/grants. Record applied or not applied in handoff.
6. Deploy only in an authorized release session. Rollback uses OFF flags and reviewed app rollback; preserve redemption/consent history. Do not use a destructive down migration as the normal recovery path.

Supabase changed default Data API exposure for new tables; explicit service-role grants are therefore mandatory alongside RLS. See [the official change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically). Current production grant state was not queried in this session.
