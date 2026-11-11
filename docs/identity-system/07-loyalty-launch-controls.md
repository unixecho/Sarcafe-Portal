# 07 — Loyalty launch controls and waitlist preservation

Confirmed user requirement: **every new loyalty activation capability defaults OFF**, while the current waitlist collection state is preserved. Existing waitlist is not an active club. No customer notifications, public membership launch, rewards, redemption or real Wallet issuance are authorized by this plan.

## Proposed persisted controls

Store versioned business-scoped settings, with explicit branch restrictions where needed. Business permission comes from the authenticated actor, not a client-selected branch. Missing rows/columns and read failures must never enable new capabilities.

| Setting | Initial/effective behavior | Backend enforcement |
|---|---|---|
| `waitlist_collection_override` | Nullable `inherit_legacy` preserves existing functioning endpoint/configuration; never seed false globally | Existing web/kiosk registration continues unless an explicit reviewed override disables collection |
| `program_active` | false | Parent gate for all new loyalty capabilities |
| `public_enrollment_enabled` | false | Public membership form and enrollment API |
| `wallet_issuance_enabled` | false | New pass prepare/delivery and outbox issuance |
| `rewards_enabled` | false | Accrual computation and reward ledger writes |
| `redemptions_enabled` | false | Redeem API and atomic redemption RPC |
| `customer_notifications_enabled` | false | Enqueue and send/dispatch; purpose/channel consent also required |

Employee-benefit programs have separate explicit disabled policy activation and issuance/redemption gates. Turning on a future loyalty club must not activate employee benefits or vice versa. Provider configuration is not an activation switch.

No current dedicated waitlist ON/OFF flag was found in the inspected registration flow: it is operating subject to key/secret configuration. Capture that fact without inventing a live database setting. Preserve old route behavior when the new schema is not yet installed. Once an explicit collection override exists, a failure reading it must fail closed, not fall back to enabled; design the compatibility boundary so “migration absent” and “settings lookup failed” are not conflated.

## State changes

Expose owner-only controls showing effective state, inherited collection state, prerequisites and impact. Enable individual child features only when the parent is active and prerequisites pass; disabling parent blocks all children immediately. Use a settings revision to reject stale saves. Log actor, time, scope and transition. Keep enabling actions deliberate and reviewable; no wizard completion, deploy, provider credential discovery or seed activates them.

Every endpoint and worker independently checks gates. API clients cannot bypass by forging flags, changing business ID, replaying an old request, using a stale kiosk bundle or calling an RPC through a browser role. Atomic redemption checks settings inside its transaction. Jobs recheck current consent and settings at dispatch. Security revocation/erasure must still execute when issuance/marketing is OFF.

## Existing waitlist contract to preserve

Retain the same phone normalization, per-branch duplicate rule, request-id replay, independent web/kiosk rate budgets, server-derived web legal versions and kiosk language sets. Web duplicate is generic success; kiosk duplicate is 409. Duplicate attempts cannot overwrite names/email/consent or emit repeated events/alerts. Preserve the current owner/developer signup alerts; the new customer notification gate does not disable those staff operational alerts.

Keep current export/withdraw/erase/purge behavior and original consent events. Do not bulk convert the waitlist or infer an account from a phone/name match. A contact may become linked to a business membership only via an explicitly verified claim and current enrollment acceptance. Marketing is a separate event per channel/purpose; declining it must not block otherwise permitted membership.

Maintain `/loyaltysignup` as the current interest page until an explicit approved product change. Use a separate disabled membership surface, rather than changing the meaning of an existing link without authorization. Public kiosk config exposes only harmless effective feature states and branding, no directory, private token, photo or admin permission.

## Activation checklist for a later authorized session

Confirm verified QA, actual policy values, reviewed notices/retention, business scope, issuer/test-pilot evidence, delivery consent, staff training, rollback owner and monitoring. Review a concrete settings diff. Apply only the specifically authorized flags, record the event and verify backend denials remain effective for other businesses. This checklist grants no current permission to activate or send.
