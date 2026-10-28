# Sarcafe kiosk — Gate 3 architecture proposal

Date: 2026-10-26  
Status: proposal only; no production code, migration or deployment is authorized.  
Pinned scope: Sarcafe, Givat Haviva branch, owner-provided kiosk/loyalty subdomain.

## 1. Deployment and route boundary

- The dedicated subdomain is the public entry point. Its hostname is configuration, never a hard-coded invented domain.
- Vercel rewrites the subdomain root to the isolated kiosk surface. Local development may use `/kiosk`.
- Kiosk document requests bypass the portal intro, page transitions, GSAP, cart, POS, staff/owner UI, Realtime client and authentication lookup.
- API routes remain server-validated. The tablet never receives a service-role key or admin session.
- The branch is derived server-side as `givat-haviva`; no browser-controlled business or branch ID is accepted.

## 2. Proposed application files

Exact names may be adapted after approval, but the boundary is fixed:

- `src/app/kiosk/layout.tsx` — isolated metadata, fonts and stylesheet only.
- `src/app/kiosk/page.tsx` — server-rendered initial menu snapshot.
- `src/app/kiosk/kiosk.css` — route-local, low-cost styles.
- `src/components/kiosk/KioskClient.tsx` — small finite state machine for carousel, browsing, form and inactivity.
- `src/components/kiosk/KioskMenu.tsx` — read-only menu rendering.
- `src/components/kiosk/KioskSignup.tsx` — lazy-loaded form with no local persistence.
- `src/lib/kiosk/menu.ts` — public-view-only, Givat Haviva-pinned snapshot and ETag.
- `src/lib/kiosk/inactivity.ts` — pure elapsed-time state logic, covered by fake-timer tests.
- `src/lib/kiosk/waitlist.ts` — shared validation and normalization.
- `src/app/api/kiosk/menu/route.ts` — conditional GET for the validated public snapshot.
- `src/app/api/kiosk/waitlist/route.ts` — hardened anonymous POST.
- `src/app/owner/waitlist/page.tsx` and server-only helpers — full-owner-only administration.

## 3. Public menu contract

`GET /api/kiosk/menu` returns only:

```json
{
  "branch": "givat-haviva",
  "publishedVersion": "opaque-version",
  "contentHash": "opaque-hash",
  "fetchedAt": "server-iso-time",
  "categories": []
}
```

The category/item fields are a strict projection of the published public menu: localized names/notes, current price, image URL when present, availability and supported modifiers. No draft, audit, quantity, POS-only, owner or staff data is returned. Initial data is server rendered. Refresh occurs on launch, visibility restore and at most once per five minutes. A matching ETag returns 304.

Offline proposal: cache the validated public shell and last validated snapshot for at most 24 hours. Show its fetch time and say availability may have changed. Do not claim live availability while offline. If no validated snapshot exists, show the non-menu welcome plus a clear offline state.

## 4. Waitlist data model

Two additive tables are proposed; both enable RLS and grant no browser access.

### `customer_waitlist_contacts`

- `id uuid primary key`
- `branch_id uuid not null` fixed by the server
- `first_name text not null`
- `normalized_phone text not null`
- `email text null`
- `source text not null`
- `current_marketing_consent boolean not null default false`
- `created_at`, `updated_at`, `last_interest_at` server timestamps
- unique normalized contact key within the branch

### `customer_waitlist_consent_events`

- `id uuid primary key`
- `contact_id uuid not null`
- `event_type text not null` (`interest_registered`, `marketing_granted`, `marketing_withdrawn`, `details_corrected`, `contact_deleted`)
- `privacy_notice_version text not null`
- `consent_text_version text not null`
- `marketing_consent boolean not null`
- `source text not null`
- `request_id uuid not null unique`
- `created_at` server timestamp
- no raw IP, user agent, free-form notes or tablet identifier

One non-overloaded service-role-only RPC, proposed name `customer_waitlist_register`, performs normalization, contact upsert, immutable event append, notification creation and idempotent replay in one transaction. It explicitly drops any prior signature in the same migration and is revoked from `public`, `anon` and `authenticated`, then granted only to `service_role`.

Duplicate policy:

- Same phone + same request ID: return the prior success; no new event or notification.
- Same phone + new request ID: update non-empty first name/email, refresh `last_interest_at`, append a new interest event and dedupe notification for the request.
- Unchecked marketing on repeat: do not revoke an earlier grant.
- Checked marketing on repeat: append a grant only when state changes.
- Withdrawal: separate authenticated/admin-assisted action and event; never inferred from an unchecked signup.

## 5. Anonymous POST contract

`POST /api/kiosk/waitlist` accepts only first name, phone, optional email, required privacy acknowledgment, optional marketing consent, notice version and a browser-generated request UUID. The server:

1. Enforces same-origin/allowed-host and JSON content type.
2. Reads the body with an actual byte limit rather than trusting `Content-Length`.
3. Rejects unknown fields; validates and normalizes all accepted values.
4. Uses a hidden honeypot and bounded global plus keyed rate limits. Any IP-derived key is HMAC-hashed with a rotating server secret and expires automatically; raw IP is not persisted.
5. Derives branch, source, server time, allowed notice version and owner recipients server-side.
6. Calls the single transaction and returns the same generic success for new or duplicate interest.
7. Never logs contact fields, request bodies or full error objects containing PII.

## 6. Consent, retention and access

- The production form uses an approved immutable notice version and separate optional marketing wording from `SARCAFE_KIOSK_CONSENT_DRAFT_HE.md`.
- Full owners only can view/export contact data. Quick/PIN sessions, employees, managers, anonymous and authenticated browser roles receive no database grant.
- Proposed review interval: 12 months. When the waitlist purpose ends, delete or anonymize contact details that are no longer needed; retain only the minimum suppression/legal evidence approved by counsel.
- Provide owner actions for correction, explicit marketing withdrawal and deletion/anonymization, with audit entries that contain no more PII than necessary.
- CSV uses existing formula-injection protection, is no-store, and requires a fresh full-owner check.

## 7. Notifications

- Transaction inserts one deduped `schedule_notifications` row per active full owner, with no customer name, phone or email in title/body.
- Title: `☕ התעניינות חדשה במועדון שרקפה`.
- Body: `לקוח חדש הצטרף לרשימת המתעניינים במועדון הלקוחות הדיגיטלי.`
- Link points to the owner-only waitlist page.
- Durable in-app notification is the pilot guarantee. External push is best-effort and never changes the successful signup response. A later retry outbox requires a separate architecture decision.

## 8. Inactivity and failure behavior

- A visitor session begins on manual navigation, scroll, input or form interaction; idle carousel animations and network responses do not count.
- Store only monotonic/elapsed timestamps in memory. At 60 seconds, focus-trap the warning; at 75 seconds, clear inputs/consents/errors, close overlays and return to welcome.
- During an in-flight submission, disable repeat submit and suspend destructive reset for a bounded 15-second network window. If unresolved, abort the request, clear PII, show a generic recovery state, and do not queue the payload locally.
- On success, clear the form immediately, show confirmation, then return to idle in about five seconds.
- No PII in URL, localStorage, sessionStorage, IndexedDB, Cache Storage, service-worker messages or analytics.

## 9. Performance and QA release gates

- Kiosk initial JavaScript ≤150 KB compressed; first screen ≤600 KB including one responsive image and required local fonts.
- No GSAP, WebGL, canvas, continuous blur, Realtime subscription or portal component imports.
- Physical BDF trace compares existing site, animations-disabled site and kiosk. Record Android/Chrome build, viewport/DPR, network, cold/warm status and power mode.
- Automated coverage: carousel pause/resume, strict menu parsing, form validation, duplicate/idempotency transaction, cross-branch tampering, consent events, notification dedupe/failure, 60+15 inactivity with fake timers, offline/stale modes, privacy clearing and owner authorization/export.
- Pilot: 100 signup/reset cycles, sleep/wake and reload recovery, slow/offline transitions, plus eight-hour memory/responsiveness run.

## 10. Required approval before implementation

The owner must select Number First, Two Doors or Counter Ticket, provide the real subdomain when available, approve the offline/retention/access/push proposals, complete the legal placeholders, and explicitly authorize Gate 4. Only then may Claude or Codex create the migration/application branch. Production migration and deployment remain separate approvals.
