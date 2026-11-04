# The public loyalty sign-up page: `/loyaltysignup`

A link the owner can hand to customers (in a message, on a flyer, as a QR code). Hebrew, English and Arabic. It adds the person to
the same interest list the kiosk fills (`customer_waitlist_contacts`, read at `/owner/waitlist`); the list says whether each person
came from the kiosk or from the website. There is no active club yet: the page says so, and asks only to be told when it opens.

Link: `https://sarcafe-portal.vercel.app/loyaltysignup` (add `?lang=he`, `?lang=en` or `?lang=ar` to open in a language).

## What the visitor sees

- Language: `?lang=` first, then the browser's language, then Hebrew. A three-button switch changes it in place (the address, the tab
  title, the page language and the direction all follow).
- Fields: first name, Israeli mobile number (05X; +972 and 972 are accepted), e-mail (optional).
- A short notice, one **required** confirmation (read the privacy notice and the terms, 18 or older, asking to be added to the
  interest list) and a **separate, unticked** marketing consent. The full privacy notice (11 sections) and the terms (7) are on the
  page itself, in the page's language.
- Success: "thank you, you are on the list". A number that was already on the list gets the *same* thank-you with a neutral line
  ("if this number was already registered, nothing was changed"), so the page cannot be used to ask whether a number is on the list.
- Failures say plainly that nothing was saved (rate limit, page open too long, offline, server trouble); the form keeps what was typed
  and a retry reuses the same request id, so a lost answer can never create a double sign-up.

## How it is kept safe

| Layer | What it does |
|---|---|
| Same origin only | The endpoint needs an `Origin` header that names this host (and `Sec-Fetch-Site` same-origin when sent). The middleware's cross-site block also applies: the route is deliberately **not** in `CROSS_ORIGIN_API_PREFIXES`. No CORS headers are sent. |
| Request shape | JSON only; a real 2 KB limit (`readLimitedText`); a strict zod schema (an unknown field is refused, so a client can never send its own legal version ids). |
| Form token | The page stamps an HMAC token when it is rendered (`signup-server.ts`). A post without a valid token is refused; one younger than 3 s is "too fast" (the form waits and retries once by itself); one older than 3 h has "expired" (the page offers a reload). |
| Honeypot | A hidden `website` field: filled means a bot, answered with a fake success and nothing stored. |
| Rate limits | In the database, per source: web 6 per hour per caller and 120 per hour overall (kiosk: 12 and 300, separate, so a web flood cannot lock the kiosk). The caller is an HMAC of the IP and the date, never the address. |
| Notification cap | An owner or developer is told about at most 30 sign-ups per hour; the sign-ups themselves are always stored. The text carries no customer data. |
| Privacy of the page | `noindex` (meta + `X-Robots-Tag`), `no-store`, `Referrer-Policy: no-referrer`, cannot be framed, no cookies, no analytics, no third-party scripts, no personal data in the URL, nothing logged. |
| Access | The database function is service-role only; the browser never talks to Supabase. |

The server-only secret is `RATE_LIMIT_KEY_SECRET`, or else `SUPABASE_SERVICE_ROLE_KEY` (`src/lib/loyalty/signup-env.ts`); with
neither, the endpoint answers 503. Nothing new has to be configured.

## Files

- `src/app/loyaltysignup/page.tsx` (server: language, token), `LoyaltySignupForm.tsx` (the form), `loyaltysignup.css`
- `src/app/api/loyaltysignup/route.ts` (the endpoint)
- `src/lib/loyalty/signup-shared.ts` (schema, phone/e-mail checks, language pick, the web legal ids), `signup-server.ts` (token and caller key), `signup-env.ts`, `copy.ts` (every word, three languages, the notice and the terms)
- `supabase/migrations/20261104150000_customer_waitlist_web_source.sql` (source column, one 10-argument `customer_waitlist_register`, per-source limits, notification cap)
- `next.config.mjs` (the header rule), `src/lib/a11y-scope.ts` (customer page: skip link and accessibility widget)
- Checks: `npm run check:loyalty-signup` (72), `npm run verify:waitlist-sql` (60), `npm run check:a11y-scope`

## Legal wording (web ids)

The web texts are their own, not the kiosk's (they never say "kiosk", "tablet" or "truck screen"). Versions stored with every sign-up:

- Hebrew: `web-privacy-he-v1-2026-11-04`, `web-consent-he-v1-2026-11-04`, `web-terms-he-v1-2026-11-04`
- English: `web-privacy-en-v1-2026-11-04`, `web-consent-en-v1-2026-11-04`, `web-terms-en-v1-2026-11-04`
- Arabic: `web-privacy-ar-v1-2026-11-04`, `web-consent-ar-v1-2026-11-04`, `web-terms-ar-v1-2026-11-04`

Change a language's three ids in `signup-shared.ts` whenever any of its wording in `copy.ts` changes. The business facts (owner, business
names, phone) are duplicated from `kiosk-business.js`; `check:loyalty-signup` fails if they drift apart. The same facts the kiosk notice
promises must stay true here: 12-month automatic deletion, owner-only access, a separate marketing consent, no stored IP address.
Not reviewed by a lawyer or a native Arabic speaker.

**Disclosed on purpose:** the whole site loads the Rubik font from Google Fonts (`globals.css`), so a visitor's IP address reaches
Google when any page loads. The notice says so. Self-hosting the font would remove it, but it is a site-wide change (a separate task).
The site's accessibility widget and page transitions keep display preferences and the page address in the visitor's own browser; the
notice says that too.

## Verified how

Static checks, plus a production build in a scratch copy against a stand-in for Supabase REST, driven by headless Edge at phone size:
all three languages, validation, success, the quick-submit retry, rate limit, server trouble, offline, the already-registered case,
the endpoint's refusals (no Origin, foreign Origin, wrong type, oversized, bad JSON, unknown field, bad/expired/too-fast token,
honeypot), what reached the database (source, versions, hashed caller key), no cookies, and no horizontal scroll at 360 and 390 px.
Not verified: a real iPhone/Android, a real screen reader, the live deployment's secret, a real Supabase round trip from the live site.
