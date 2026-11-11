# 06 — Wallet integration plan

No Wallet integration or issuer access was found/verified in this checkout. Provider work is staged behind mock transports and OFF issuance settings. No pass is an employment authorization source: the server always checks current credential/membership eligibility.

## Provider-neutral contract (proposed)

Use a server-only adapter selected explicitly per environment/business. Operations: validate configuration, prepare/create pass, create bounded delivery, update desired version, revoke/void, reconcile status. Define a typed minimal pass view and normalized retriable/permanent failures. Domain code persists lifecycle and enqueues work transactionally; provider calls run outside DB transactions through an idempotent outbox. Jobs carry IDs and desired versions, not public URLs containing secrets. Reject stale versions; retries cannot create duplicate serials/objects or resurrect revoked passes.

Lifecycle: `draft -> test_ready -> issued -> suspended/revoked/expired`; delivery is separate (`prepared`, `claimed`, `expired`). A downloaded pass is not proof it was installed, and an accepted update request is not proof the phone refreshed. Record provider acceptance separately. Reissue revokes the old credential and establishes a new delivery context.

Use different passes/credentials for organization affiliation and business loyalty, with explicit brand/issuer/audience mapping. A scan may authorize a benefit through an active business-organization agreement; it must not reveal all other memberships. Keep private portraits off provider/public image endpoints by default.

## Apple Wallet

Create signed `.pkpass` packages with consistent pass type identifier and unique serial. An updateable pass requires a secure update service, registration lifecycle and pass authentication secret. Keep signing material in server secret storage, never Git/browser/QA reports. Return correct MIME/download/no-store/no-referrer headers. Use authenticated one-time or bounded delivery links; never persist raw link tokens in logs.

Apple's update protocol uses `webServiceURL` and `authenticationToken`; devices register, receive update pushes, then retrieve changed passes. The authentication token and serial must remain stable for updates. Do **not** rotate the Apple protocol token as a shortcut for revoking the membership QR. Revoke the QR independently and deliver a voided/revoked pass update; a lost protocol secret requires a deliberate reissue flow. [Apple update service](https://developer.apple.com/documentation/WalletPasses/adding-a-web-service-to-update-passes).

Implement protocol endpoints with their protocol-specific credentials, size/rate limits and exact responses; they are not blanket anonymous exceptions and cannot require a staff browser cookie. Registration replay is safe. Keep protected push registrations separate from existing VAPID staff/customer push records. Follow Apple's signing/package requirements and validate generated archives before provider tests. [Apple pass build documentation](https://developer.apple.com/documentation/walletpasses/building-a-pass.md).

Prerequisites before real test issuance: owner-approved Apple developer/issuer account, team/pass type identifiers, appropriate valid pass-signing certificate and private key, intermediate chain, reachable HTTPS update service, protected update credentials, public brand artwork, designated test iPhone. None have been verified here. Do not assume a conventional sandbox exactly equivalent to Google demo mode; validate the actual provider testing process before issuing.

## Google Wallet

Use issuer-owned class/object IDs with separate organization/business branding; persist unique object mapping and idempotent create/update behavior. Prepare signed Save-to-Wallet delivery on the server, never expose the service-account private key. Treat Save links/JWTs as sensitive distribution artifacts and suppress logging/caching/referrers. Request the minimum scopes and isolate issuer credentials by environment/business relationship.

Google distinguishes pass classes/objects and limits demo issuance to issuer/test accounts; wider issuance needs publishing access. [Google Wallet terminology and access modes](https://developers.google.com/wallet/generic/resources/terminology). Choose Generic versus Loyalty pass type deliberately for each brand/use case and confirm current provider support. Do not force an employee identity photo into a public image URL.

Prerequisites: owner-approved issuer account, permitted service account, enabled API, class review/publishing readiness as applicable, allowlisted test accounts and Android test device. Not verified. Rotating barcodes may later reduce replay risk where supported; they are not assumed available across both platforms and do not replace online revocation/photo confirmation.

## Credential storage and failure rules

QR validation stores a digest; if subsequent pass rendering needs the original secret, keep separately envelope-encrypted material with key version and strict server access, or rotate via deliberate reissue. Do not claim digest-only storage can regenerate an arbitrary token. Apple update tokens similarly need a verification hash plus encrypted recoverable material for package regeneration. Keys are provisioned only when the relevant adapter is authorized, with a rotation/recovery runbook.

Mock mode has deterministic fake issuer identities, synthetic certificates/fixtures where appropriate, no provider network access, controllable timeouts/errors and recorded expected calls. Real credentials must never cause mock mode to silently turn live. No real SMS/email delivery is part of these tasks; initial review can inspect local delivery artifacts with synthetic members.

Membership deactivation succeeds even if provider update is down: DB denies verification/redemption immediately, durable job retries, dashboard says update pending. Existing phone copies may remain visually stale. Outbox rechecks feature gates and consent at dispatch; disabling issuance blocks new deliveries, while security revocation updates remain permitted under a distinct audited lifecycle policy.
