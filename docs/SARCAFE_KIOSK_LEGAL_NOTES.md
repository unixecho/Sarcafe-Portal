# Sarcafe kiosk — what the sign-up does, what the legal text must match, what is still open

Date: 2026-10-28 · Status: the on-screen texts (`prototypes/sarcafe-kiosk-app/overrides/kiosk-legal.js`) were written to the
requirements of Israeli law for exactly this activity, and the system was changed so that what they promise is true (12-month
automatic deletion, owner-only access, separate marketing consent, a record of every consent). **No lawyer has reviewed them, and
this file is not legal advice or a guarantee of compliance**: the owner chose to go live without paid review. Keep the facts in
section 1 true, and have a lawyer look at it if the club, SMS marketing or the number of people grows.

This extends `docs/SARCAFE_KIOSK_CONSENT_DRAFT_HE.md` (the 2026-10-26 draft and its official sources) and
`docs/SARCAFE_KIOSK_GATE3_ARCHITECTURE.md` (the design the code follows).

## 1. What the system really does (the legal text has to say exactly this)

| Step | Fact |
| --- | --- |
| Collected | First name, mobile number, optional e-mail. Plus, as evidence: branch, server timestamps, versions of the privacy notice / consent wording / terms, whether marketing was ticked, a random request id. |
| Not collected | National id, date of birth, payment, location, contacts, advertising or device id, IP address (only a daily HMAC of it is used for rate limiting, and it is deleted within 2 hours). |
| On the tablet | Nothing is stored. A failed sign-up is not queued. The form lives in memory and is wiped by the idle timer. No cookies or analytics. |
| Where it goes | `POST /api/kiosk/waitlist` on the portal → one database transaction → tables `customer_waitlist_contacts` and `customer_waitlist_consent_events` (Supabase, region eu-central-1 per the handoff). No browser role can read them. |
| Who sees it | Full owners only, on `/owner/waitlist` (list, export, withdraw/grant marketing, erase). Developers have technical access to the database in their role; they are notified of each sign-up **without** the details. |
| Notifications | Each sign-up writes one in-app/push notification per active owner (`club.signup`) and per developer (`dev.club_signup`): "☕ התעניינות חדשה במועדון שרקפה", no personal data, link to the owner page. |
| Marketing | Separate, optional, never pre-ticked. A new yes is its own dated event. An unticked box on a repeat never withdraws an earlier yes; withdrawal is an explicit owner action (or the person's request). |
| Erasure | The owner can erase a person; a minimal `contact_deleted` event with no link to the person remains. |

## 2. Law the texts were drafted against (for counsel to confirm)

- **Protection of Privacy Law, 5741-1981**, including **Amendment 13** (in force from August 2025): the notice at the point of collection (s. 11: purpose, whether providing the data is mandatory or voluntary and the consequence of not providing, to whom it may be delivered and for what purpose), access (s. 13), correction (s. 14), security (s. 17), and the database-registration and officer questions that Amendment 13 changed.
- **Protection of Privacy Regulations (Data Security), 5777-2017**: the security level that matches this database.
- **Communications Law (Telecommunications and Broadcasting), s. 30A ("spam")**: advertising messages only with prior explicit consent (the consent is the separate box), identification as advertising, and a simple free way to opt out.
- **Consumer Protection Law, 5741-1981** and the loyalty-club rules: nothing is promised yet; any future club, benefits or prize draws need their own terms (and, for draws, whatever permits apply).
- **Minors**: the form is for 18 and over (capacity and parental consent questions are avoided, not solved).
- **Transfer abroad**: the host (Vercel) may run functions outside Israel (the request ids in the connector errors showed an `iad1` region); the database is in the EU. Counsel to confirm the basis and how to word it.

## 3. What the owner supplies: `overrides/kiosk-business.js`

Filled 2026-10-28: owner שרי איסרליס, business שרקפה (Sarcafe), phone for privacy requests; no company number is shown (the owner's choice). A value left empty shows
as yellow `[brackets]` and the privacy screen warns. After filling: run `build.ps1`, install the app, and (because the notice text
changed) change the three version ids below together.

Decisions the text now states as fact, which the system enforces: deletion 12 months after the last interest (daily job
`customer_waitlist_purge_expired` inside `/api/cron/cleanup-feedback`); an answer to a privacy request within 30 days (the owner's
duty, done by phone); the host and database named (Supabase, EU servers; Vercel); age 18+; marketing only on the separate box.

Open points a lawyer would normally settle (not blockers for a small waitlist, but know them): whether any database-registration or
privacy-officer duty applies to you under Amendment 13 (it should not at this size and data type); the wording of cross-border
transfer through the host's functions; and the exact content of the marketing messages when you start sending them (each must say
it is an advertisement, who sent it, and carry a one-step opt-out; build the opt-out before the first message).

## 4. Versions

The ids in `kiosk-legal.js` and in `src/lib/kiosk/waitlist.ts` must match; the server accepts only the current ones and stores them with every sign-up:

- privacy `kiosk-privacy-he-v5-2026-10-28`
- consent wording `kiosk-consent-he-v5-2026-10-28`
- terms `kiosk-terms-he-v4-2026-10-28`

Change all of them together whenever any wording changes (`npm run check:kiosk-waitlist` fails if they drift apart).

## 5. Turning it on (status)

1. DONE 2026-10-28: migration `20261027150000_customer_waitlist.sql` applied to production and recorded in the ledger.
2. `KIOSK_SIGNUP_KEY` in the Vercel project's environment (a long random value; until it is set and deployed the endpoint answers 503).
3. Deploy (push to `main`).
4. The same key on the tablet (`am start -n il.co.sarcafe.kiosk/.MainActivity --es key <the value>`). The key lives on the tablet, so it only keeps strangers' scripts out; the real protection is the rate limit, the strict schema and the honeypot.
5. Fill `kiosk-business.js`, rebuild, install, bump the version ids.
