# 05 — Security and privacy specification

Engineering requirements, not a legal compliance certification. Preserve current notices and privacy promises. New employee-photo, membership and Wallet notices need review before real collection/issuance; do not invent approved retention periods or consent language.

## Trust boundaries and controls

| Threat | Required control and proof |
|---|---|
| Customer becomes staff | No automatic `staff` creation/link/grant; deny benefits principal at existing owner, scheduler and POS endpoints |
| Cross-business/department ID swap | Actor resolved server-side; explicit grants; composite scoped FKs; adversarial same-role tests with tenant A/B IDs |
| Forged role / stale auth | Never trust body/cookie-selected tenant, auth `user_metadata`, or client role; recheck active grants and session assurance per operation |
| Leaked/forwarded invite | High-entropy hashed token, purpose/recipient binding, short configured expiry, atomic single use, revocation, rate limit; employment still requires authoritative review |
| Public QR reveals identity | Opaque random credential; no name/phone/email/department/photo URL in payload; unauthenticated scan endpoint discloses nothing |
| QR screenshot replay | QR is possession evidence, not identity proof. Staff must compare current private photo; one-use short-lived verification context plus atomic redemption. Never claim a static QR prevents copying |
| Stale approved screen | Recheck membership/credential/policy/settings during redemption; deactivation wins immediately even if Wallet update is delayed |
| Double spend | DB transaction, sale-context uniqueness, idempotency payload binding, concurrent quota tests and immutable reversal ledger |
| Shared kiosk exposure | Shared kiosk key cannot scan members/read photos/redeem; session controller clears all transient identity UI; no PII in browser persistent storage |
| CSRF / credential leakage | Same-origin checks on cookie-auth writes, strict bounded schemas, safe redirects, no-store on success/error, no-referrer, no raw tokens in logs |
| Third-party sends in tests | Mock transports default, egress denylist/allowlist, synthetic fixtures, explicit environment classification; refuse production host targets |

## Photos

Use a new **private** bucket, proposed `customer-identity-photos`, with no public/browser listing or read/write policy by default. Use opaque paths scoped by organization/membership UUID and photo version; do not place names, phone numbers or staff codes in paths. Access is via a server proxy that rechecks the viewer, target scope, membership state and purpose on every request. `Cache-Control: private, no-store`, `Pragma: no-cache`, `Referrer-Policy: no-referrer` on all responses including errors. Avoid long-lived signed URLs because they remain usable outside the authorized view until expiry. Never make a public bucket to satisfy Google Wallet image fetching.

Upload validates streaming byte cap, magic bytes, actual decode, maximum decoded dimensions/pixel count and output size. Allow a small documented raster set, normalize orientation, re-encode to strip EXIF/location metadata; reject SVG/HTML/animated/unsupported and decompression bombs. Image processing library choice must fit the deployed Node runtime and be lockfile-pinned. A pending upload cannot become an approved identity photo without review. Keep approved photo until replacement is validated; clean orphan/quarantine uploads idempotently. Two memberships do not share photos implicitly across organizations.

Default pass artwork uses public business branding only. Keep private employee photos in the authenticated verifier unless a separately reviewed requirement explicitly permits embedding one in a pass. No face recognition, biometric templates, or automated identity scoring.

## Consent, retention and erasure

- Existing `customer_waitlist_consent_events` remain evidence of the exact historic text/language/source; do not rewrite them during linking or migration.
- Waitlist interest, active membership terms, photo processing, Wallet delivery and channel-specific marketing are separate purposes. No auto-opt-in or notifications based on an old phone match. An owner-maintained boolean alone is insufficient evidence for a new marketing channel.
- Preserve the existing twelve-month waitlist cleanup (`customer_waitlist_purge_expired`) and erase path. A membership link must not keep an erased waitlist contact's personal data alive through a copied record. New member contact data requires its own documented purpose and retention.
- Approval/deactivation/revocation happens immediately in the database. Configure and document retention for rejected applications, expired invites, unused photos, dormant memberships, audit/redemption records before live enrollment. No indefinite retention by accident; no guessed legal duration.
- Erasure revokes credentials/delivery links, cancels pending jobs, removes private photo objects and unnecessary contact/profile data; retain only justified minimal transactional evidence with pseudonymous identifiers. Track cleanup failures without keeping PII in error text.
- No production staff/customer data, credentials or private photos in QA fixtures, Markdown, screenshots, traces, HARs, commits or prompts. Redact URLs that carry capabilities.

## Lifecycle and cache rules

Stop camera tracks, decode loops and polling on completion, navigation, logout, hidden state and timeout. Clear photo/object URLs and verification state before displaying the next person. Protect against stale fetch responses with request generation/abort handling. Sensitive responses must bypass service-worker/Next/CDN/client persistent caches; inspect `public/sw.js` or the current service worker at implementation time rather than assuming fetch headers alone cover it.

Kiosk's existing default is 60 seconds inactivity then a 10-second warning; preserve the same controls and its sleep/resume/generation behavior. New credential/photo views may clear earlier; must never linger through the public attract screen. Document and test bounded pending-request holds without weakening the reset contract.

Audit grants/invites/approval/photo reads/credential issue/revoke/policy/settings/redemption/reversal/Wallet operations. Store actor, scope, target ID, operation, reason, outcome and timestamp, not tokens, image bytes or full contact details. Limit operator access to their own scope; denied attempts expose no target existence detail.

Supabase private storage and service keys require explicit access control; service keys bypass RLS and must never ship to browsers. [Official storage access documentation](https://supabase.com/docs/guides/storage/security/access-control). The proposed proxy and tenant checks are application design requirements, not proof already provided by the platform.
