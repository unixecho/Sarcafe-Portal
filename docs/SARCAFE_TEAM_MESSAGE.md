# הודעה מהירה לצוות — the team message

**Status (2026-11-05): LIVE** (no migration needed to send; migration `20261105090000` adds the audit trail).

An owner, or a branch's general manager, sends a short note (up to 280 characters) to:
- **everyone at the branch** — active staff of that branch or of every branch, unless switched off there (`schedule_members.schedulable = false`);
- **one shift** — the real published shifts of the next 7 days, with their real hours (the shift picker lists actual shifts, not a fixed morning/evening);
- **one person on that shift** — offered only when more than one person is scheduled.

**Only people with notifications turned on receive it** (owner: "only workers who enabled notifications can be sent notifications"): a person
with at least one row in `staff_push_subscriptions`. The composer shows the others greyed out ("ללא התראות") so the sender can tell them in
person; the server skips them and says how many were skipped. The sender never receives their own message.

## How it travels
`POST /api/owner/team-message` → one `schedule_notifications` row per recipient (`kind 'staff.message'`, title "הודעה מ<first name>",
`link.url '/staff'`) in ONE insert → `flushStaffPush()` (after the response) pushes them to every registered phone; the in-app bell shows them too.

## Threat model and the rules that answer it
| Risk | Answer (src/lib/team-message/server.ts, src/app/api/owner/team-message/route.ts) |
|---|---|
| An employee or another branch's manager sends | `requireAnyMenuEditor()` then `canEditMenu(me, branch.id)`: owner anywhere, general manager only their own branch, Google sign-in only (the six-digit code session is refused) |
| Someone signed out (or an employee) probes which branch names exist | who is asking is checked BEFORE the branch is looked up: the same 401 / 403 for a real branch and a made-up one, on both GET and POST (found live on 2026-11-05, fixed the same day; QA `tm-roles`). If the sign-in check itself cannot be made (auth server or database down) the answer is 503, never "sign in" (QA `retry-after-outage`) |
| The browser picks the recipients | It cannot: it names a branch, a shift and an assignment; each is checked to belong to the one before it, and the people are read here |
| Messaging a draft, past or far shift, or another branch's shift | 404, the same answer for all of them; only published weeks, from yesterday to 14 days ahead |
| Cross-site request forgery | JSON only, same-origin (`parseBody` + the middleware's cross-site write block), SameSite cookies |
| Spam / a stolen session | Per sender 6 per 10 minutes and 40 per day, per branch 80 per day. The limiter **fails closed** (503) |
| Double tap / retry sends twice | The request id is the primary key of `staff_messages`; before the migration, a one-shot limiter key. A retry after a server error keeps the id |
| Hidden or spoofed text | Control, zero-width and direction-override characters are stripped; newlines become spaces; 1–280 characters |
| Leaks in the answer | Only first names and counts. No staff ids, phones, e-mails or push endpoints. Errors are generic |
| Partial sends | One insert for everyone: all or nothing. The audit row is marked failed if it fails |

## Tests
`npm run qa` → stage **features** (the full matrix above: recipients, roles, branches, shift windows, validation, limits, duplicates, cleaning,
no-migration mode, inbox) and **survival** (database down mid-send, retry once). Unit rules: stage **unit** (`message-*`).
