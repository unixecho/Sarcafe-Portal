# Staff & Scheduling

## Production schedule responsiveness and identity update — 2026-10-10

- Published snapshots are normalized from PostgreSQL snake-case fields before the manager compares them with the live draft. Republishing an unchanged week now returns to zero unpublished changes; opening/closing employee requests is deliberately counted as a real change.
- A successful shift save returns the changed shift and assignments in the same response. The board applies that authoritative slice immediately and refreshes warnings/audit data in the background instead of blocking on a second full-state request.
- Settings/catalog editors retain their existing 500 ms coalescing. Roster scheduling permissions, default roles and hour limits now update locally and merge per employee during a short editing pause.
- Adding an employee selects a role in this order: explicit scheduling default, matching staff badge, shift-template role, unmet role requirement, then the first configured role. The owner can still change it before saving.
- Schedule avatars use stable person-specific colors rather than role colors. A self-selected emoji, when present, is shown on top of that color.

Application commit `fbeef6d` is live in production. Migration `20261009153126_staff_avatar_emoji.sql` is applied and recorded in the production migration ledger.

## Production UX and operator update — 2026-10-09

The production application includes a Hebrew/RTL request-management pass. Employee availability is separated into collapsed person cards with a seven-day grid: explicit availability/preferences are green, unavailability red, partial hours amber, missing submissions neutral, and notes have their own purple callout. Pending join/swap decisions are collapsed by default but retain approve/reject actions when opened. A week-activity rail points owners directly to every loaded week containing pending requests or submitted availability, including weeks other than the one currently displayed. Physical RTL chevrons replace mirrored text glyphs in all schedule week navigators.

The staff directory separates `הנהלה ומפעילים` from `צוות עובדים`. The `developer` badge is a distinct display role backed by the existing owner authorization role, so it retains operator powers without rendering as Owner. Owners/developers are not schedulable by default; migration `20261009134321_onboarding_handover_owner_defaults.sql` creates guarded per-branch defaults and preserves later explicit toggles. This migration and UI are live in production.

## Weekly planning update — 2026-10-08

The 2026-10-08 weekly-planning baseline was implemented, migrated and deployed to production. The per-shift request opt-in described below was applied to production on 2026-10-09 in `20261009120000_native_dashboard_shift_requests_employee_codes.sql`. The authenticated pilot status is recorded in root `handoff.md`.
Migration: `20261008134738_schedule_planning_fair_fill.sql`. Existing migration
024 remains historical; the successor changes the request rules deliberately.

The owner flow is now **prepare an empty week → collect requests through Tuesday →
approve requests and assign manually → complete remaining places fairly → publish**.
The staff scheduler uses a full Google session. Number/code sessions serve the
checklists and event POS; staff first activate via their owner-generated invitation
and can then link Google to the same employee record.

- **Prepare the week.** An empty board has “הכנת שבוע מהתבניות”. A guarded,
  atomic RPC builds empty shifts from the branch's templates and working days.
  Existing shifts/assignments survive and repeat preparation adds nothing twice.
  With no saved templates, the server uses the same app defaults as the editor.
  Review hours and role/headcount requirements before collecting requests.
- **Tuesday cutoff.** For a Sunday-starting week, requests and availability close
  after the preceding Tuesday, at midnight in `Asia/Jerusalem`, including DST.
  Draft-week requests and availability are enforced by SQL, beyond disabled UI
  buttons. On a published schedule, direct join requests are available only when
  the owner explicitly opens that shift; swap and give-up workflows remain.
  An employee can cancel their own pending request after cutoff.
- **Pre-publication choices.** `/staff/schedule` → “בקשות לשבוע” offers the upcoming
  week's shift dates/times/templates, alongside day preferences, unavailability,
  and partial hours. A shift is closed to direct employee requests by default;
  the owner explicitly opens individual shifts in the shift editor. Employees see
  whether each shift is open or closed to requests. SQL enforces the same rule.
  Availability has draft/submit actions. The separate `planningShifts` response
  contains only `id`, `weekId`, `date`, `startTime`, `endTime`, `presetId`,
  `requestsOpen` — never
  draft assignees, manager notes, role demands, or unpublished snapshots.
- **Live week board.** Seven equal day columns on wide screens, a contained swipe
  board on phones, and the current week's approval pane beside the board on large
  desktops. The pane includes submitted availability, who has not submitted, and
  each eligible employee's Saturday hours over the previous 12 published weeks.
  Visible, idle pages refresh every 15 seconds and immediately on focus/mutation.
- **Owner decisions.** Approve/reject directly while watching the board. Approval
  uses the existing locked, conflict-checked request RPC. Manual assignment also
  answers a matching pending request. Nothing automatically grants a preference.
- **Fair completion.** “השלמת חוסרים הוגנת” is available after Tuesday and only
  after all requests for that week have a decision. The server fills role minima
  (or one person when a shift has no declared requirement), never removes or
  changes an existing assignment, and retains the draft until deliberate publish.
  Saturday is allocated first; fewer Saturday hours in the preceding 12 published
  weeks plus current week's assignments rank first, then lower weekly hours,
  then submitted day preference. Deterministic, week-dependent ties rotate among
  otherwise equal candidates. The “150%” label is the user's scheduling incentive
  rule, not an attendance, payroll calculation, or HYP wage integration.
- **Eligibility for automatic completion.** Active, branch-authorized, schedulable
  employees; matching default role or no specified default role; no existing
  assignment to that shift; no overlap in any branch; submitted unavailability
  and partial hours honored; weekly/person and daily caps, rest (including half
  hours and midnight crossings), and consecutive-day limits honored. No submitted
  availability means available; drafts do not influence completion. Manual edits
  retain the existing manager authority and warnings. Unfillable role/shift places
  return explicit results and stay visible on the board.
- **Swaps and notifications.** The verified existing workflow remains
  `open → peer_accepted → approved`. Peer acceptance never changes assignments;
  manager approval atomically updates assignments and published snapshots and
  notifies both employees. Invalidated proposals cancel with preserved history.
  Availability submission and manager notification now share one transaction.
  All updates stay in-app; no email/SMS/WhatsApp dependency.

Verification: `check:schedule` includes Jerusalem summer/winter cutoff parity;
`verify:schedule-sql` applies all successor migrations and covers preparation,
deadline enforcement, request-first completion, preserving manual choices,
Saturday fairness/distribution, partial availability, hour/rest limits,
cross-branch conflicts, repeated completion, explicit unfilled places and
service-only function grants. PGlite is a single connection: actual parallel
connection races still require a real Postgres integration environment.

## Previous overhaul findings and implementation

One cohesive experience for **people → shifts → requests → swaps → approvals**, built on the existing
architecture (Next.js routes → one guarded dispatch → Postgres functions). Hebrew-only, like every other
staff/owner screen in this app.

---

## 1. Findings and root causes

Everything below was confirmed against the **live database**, not guessed from the code.

| # | What was reported / found | Root cause |
|---|---|---|
| 1 | Staff without an email show as **"ללא שם"** in the scheduler; the assignment snapshot stores `staff_name = NULL` | The invite flow saved `first_name` but never `display_name`. The roster resolved `display_name \|\| email \|\| 'ללא שם'` and ignored `first_name`, `last_name` and the POS nickname. Live: **8 of 10** staff were affected. |
| 2 | Shift times in the sheet don't match Settings | `ShiftSheet` hardcoded `08:00–16:00`. It never read the shift templates (`presets`) or the branch/day hours, and never set `preset_id`. New templates were also created at a hardcoded `08:00–16:00`. |
| 3 | Publish, accept/decide swap, set member, copy/clear week **never worked** | Every one of those SQL functions authorised through `auth.uid()`. The app calls them with the **service-role** client, where `auth.uid()` is `NULL` — so they always raised "not authorized". (Live: 0 audit rows, 0 assignments, 0 swaps; confirmed `is_schedule_manager()` = false under `service_role`.) |
| 4 | Failures were silent | `dispatch()` stored errors, but the workspace only rendered them while no data had loaded. A failed publish/swap showed nothing. |
| 5 | "Shift request" feature | Did not exist. Only swaps and availability did. |
| 6 | Integrity gaps | No overlap/conflict check anywhere on the server; the "one person once per shift" constraint (`unique(shift_id, staff_id, role_id)`) never fires when `role_id` is NULL; clearing a week or deleting an assignment **cascade-deleted swap history**; a pending swap flipped the live assignment to `swap_pending`; an approved swap updated live rows but not the **published snapshot**, so employees kept seeing the old assignee; edits to a published week were invisible to the manager's "is the team seeing this?" question. |
| 7 | Permissions | `requireScheduleManager` didn't refuse quick-login (6-digit passcode) sessions, which the rest of the app treats as floor-only. The roster sent every employee each colleague's private note and hour cap. The dispatch body was validated only as `{ type: string }`. A delegated manager could (try to) change who else manages (and the field was silently ignored, so delegation never worked). |
| 8 | Staff CRUD | No edit of name / last name / display name / phone (no `phone` column). Deactivating didn't deal with future shifts, open requests or swaps. No guarded delete. Nothing stopped deactivating yourself. The scheduling toggle in the staff list showed OFF where the scheduler treated "no row" as ON. |
| 9 | Notifications | No in-app notification mechanism existed. |

---

## 2. How it works now

### People
- A staff member is identified by a **stable internal id**, never by email. A contact email is optional; Google permissions come only from the verified OAuth link.
- One name rule everywhere (`lib/shifts/names.ts`, mirrored in SQL by `sched_name()`):
  display name → first + last name → POS nickname → email → "ללא שם".
- A person with no email can be created, **scheduled, edited, deactivated** like anyone else. They can use employee number + PIN for floor tools, but Google-only features stay unavailable until they complete OAuth. Manually typing an address does not grant access.

### Shift times: templates vs. scheduled shifts
- A **template** (Settings → "תבניות משמרת") is a suggestion. A **shift owns its own explicit start/end.**
- Creating a shift copies a template's times into it. The sheet suggests the first template **not already used that day** (add a second shift to a day that has "בוקר" and it offers "ערב"); with no templates it uses that day's opening hours (incl. the Friday/Saturday overrides).
- Editing a template later **never moves existing shifts** — only shifts created afterwards start from the new times. `preset_id` is just a label.
- One label function writes a shift everywhere (`formatShiftLabel`, mirrored by SQL `sched_fmt`): board, sheet, employee view, requests, swaps, notifications, audit. Time ranges are bidi-isolated so they read `07:00–13:00` inside Hebrew text.

### The manager's board (`/owner/schedule`)
- Tabs: **לוח · בקשות · בעיות · הגדרות · היסטוריה**, with a count badge on what is waiting.
- A card says whether the team can see this week: *not published* / *published* / *"יש N שינויים שעוד לא פורסמו"* (the manager is told the team is looking at an old version).
- Day cards in a responsive grid (1 column phone → 4 desktop): every shift shows its time, template, people, and **status pills with words, an icon and a colour** — `ללא שיבוץ`, `חסר/ה …`, `מאוישת (2/2)`, `החלפה ממתינה`, `N בקשות להצטרף`, `שימו לב`.
- **One shift sheet, one Save.** Day, hours (template chips or exact wheel), people (multi-select picker that already shows who is double-booked / unavailable / asked to join / has no login), roles, needs, note — applied **atomically**; the confirmed result is painted immediately while a full reconciliation runs in the background; closing with unsaved changes asks first; "העברה למשמרת אחרת" moves a person in one step; requests to join are approved/rejected **inside the sheet**.
- Publish / copy / clear / revert-to-draft live behind clear buttons with confirmations that say what will happen to pending requests and swaps.

### Shift requests ("I would like to work this shift")
Owner first marks that specific shift **open for requests**. Employee opens it
(on **כולם**) → *בקשה להצטרף* → status **pending** → manager sees it →
**approve / reject** → employee is told. A shift not explicitly opened cannot be
requested. Employees may still offer one of their own shifts for hand-over or
exchange; hand-over supports “nothing in return”.
- **Never touches the schedule while pending.**
- Refused up front (with a plain reason): week not published, shift already started, shift **full** (needs-headcount reached), person already on it / already working then / another pending request at that time, person marked **unavailable** that day, or switched off for scheduling.
- Approval **re-checks everything against the schedule as it is now.** *Hard stops* (cannot be forced): shift gone/started, person inactive/already on it/**double-booked**. *Soft issues* require an explicit confirmation: shift already full / already has people / person marked unavailable / the shift's time changed since they asked.
- If the manager simply puts the person on the shift, the pending request is answered automatically.

### Shift swaps
`open → peer_accepted → approved` (or `rejected` / `declined` / `cancelled`). Two kinds, both aimed at a named colleague or **open to anyone**:
- **hand-over** — A gives a shift away; B takes it.
- **exchange** — A's shift for one of B's.
The employee answers three plain questions (who? in return? note?) and reads a sentence saying exactly what happens — including that **nothing changes until the manager approves**.
- A pending swap **never modifies the schedule**. Pending is derived from the swap record.
- Manager sees both people, **both shifts' dates and times**, the reason, and **what the approval would change** (e.g. "דנה תעבור 44 שעות בשבוע") before pressing *אישור ההחלפה*.
- Approval validates again (assignments unchanged, nobody double-booked, nobody inactive, not started), then moves both people **and patches the published snapshot** so employees see it immediately.
- If the schedule changes under a swap (the shift's day/time edited, a person removed or moved, shift deleted, week cleared or reverted to draft) the swap is **cancelled automatically**, with the reason, and everyone involved is told.
- History (approved / rejected / declined / cancelled) is kept on the swap record itself, so it survives deleting shifts.

### Notifications (in-app only — nothing depends on email)
A bell with an unread dot on both the manager's and the employee's screen. Written in Hebrew at the moment of the event, in the same transaction as the change. Events: new request, new swap proposal, colleague agreed/declined, awaiting approval, approved/rejected, cancelled (by a person or by a schedule change), availability submitted, **schedule published/updated** (each affected person gets *what* changed: added / removed / time changed). Only people who can actually open the app get a row. The owner dashboard also shows a signal when requests are waiting.

### Staff management (`/owner/staff`, owner-only as before)
List (name, role · branch, phone/email, status pills) with search, active/inactive/all, branch filter. **Add** needs only a name (nickname pre-filled from it). One **edit sheet** per person with three visibly separate things: *who they are* (name, display name, phone, email, role, branch — one Save), *on the schedule?* (a switch per branch, applies at once), *works here at all?* (below).
- Management/operators and regular employees render in separate visual groups. `developer` displays as `מפתח/ת` while the server stores the established owner authorization role. Owners and developers begin with scheduling disabled in each active branch and can be enabled explicitly in the same edit sheet.
- **Deactivate** keeps all history; if the person still has future shifts it asks whether to **remove them from those** (recommended) or leave them (the board flags them). Open requests/swaps of someone who left are cancelled. It also unlinks their login (existing behaviour, now atomic). **Reactivate** any time.
- **Delete** only appears — and only works — for a record with **no history at all** (derived from the foreign keys, so it stays correct as tables are added). Otherwise: deactivate.
- Guards: you can't deactivate yourself; owners can't be deleted; the last owner can't lose ownership; email can't be changed once the person has signed in; duplicate email blocked (index) and duplicate **name** asks once.
- Every change is written to `staff_audit` and shown in "היסטוריית שינויים".

---

## 3. Permissions & integrity — enforced server-side

| Layer | What it does |
|---|---|
| Route guard (`lib/shifts/guard.ts`) | Resolves the caller from the session — **never from the request body** — and refuses quick-login sessions for every manager act. |
| Strict body schema (`lib/shifts/schema.ts`) | Per-action zod, `.strict()`: an unknown field (an actor, a status) is a 400. |
| `sched_*` functions (service-role only) | Take the actor explicitly, **re-check the same permission**, lock the week row, apply the change atomically, write the audit row and the notifications in the same transaction, return `{ok, reason, details}`. Old `auth.uid()`-based functions are **dropped** (they were callable by any signed-in browser). |
| Constraints | One person once per shift (unique index). **No person can hold two overlapping shifts in any branch** — a *deferred constraint trigger* enforces it even against a bug in a function, with a per-person advisory lock (taken in a fixed order) so two managers racing cannot both win. HH:MM check on times. One live swap per assignment. One pending request per (shift, person). |
| Table grants | Browser roles can no longer write the schedule tables at all; requests/notifications/staff audit are service-role only. |
| Optimistic concurrency | A shift save carries the `updated_at` it was loaded with; a stale save is refused (*"מישהו אחר עדכן את המשמרת"*), never silently overwritten. |
| Privacy | An employee's state contains published data only, a **trimmed roster** (names, nothing private), their own requests/availability, swaps that involve them or are open to all, their own notifications. |

---

## 4. Files

**New**
- `supabase/migrations/024_scheduling_overhaul.sql`
- `src/lib/shifts/`: `names.ts` `presets.ts` `coverage.ts` `messages.ts` `schema.ts` `snapshot-diff.ts` `view.ts`
- `src/components/shifts/`: `ui.tsx` `schedule.css` `ScheduleToast.tsx` `NotificationsSheet.tsx` `StaffPickerSheet.tsx` `MoveShiftSheet.tsx` `ShiftActionSheet.tsx` `SwapSheet.tsx` `MyRequests.tsx`
- `src/components/staff/`: `AddStaffSheet.tsx` `StaffEditSheet.tsx` `types.ts`
- `src/app/api/owner/staff/[id]/route.ts` (detail + guarded delete)
- `scripts/verify-schedule-sql.mjs`, `scripts/check-schedule.mjs`

**Rewritten / changed**
- `src/lib/shifts/`: `types.ts` `actions.ts` `access.ts` `guard.ts` `dispatch-write.ts` `state-query.ts` `serialize.ts` `rules.ts` `time.ts`
- `src/app/api/shifts/{dispatch,state}/route.ts`, `src/app/api/owner/staff/route.ts`
- `src/components/shifts/`: `ShiftsProvider.tsx` `ScheduleWorkspace.tsx` `ShiftSheet.tsx` `WeekGrid.tsx` `RequestsPanel.tsx` `StaffWorkspace.tsx` `AvailabilityPortal.tsx` `PrintView.tsx` `WarningsPanel.tsx` `ShiftsAuditTrail.tsx` `ManagerPanel.tsx` `CatalogEditor.tsx` `RosterPanel.tsx`
- `src/components/StaffManager.tsx` (POS controls — nickname, employee number, quick code — kept, moved into the edit sheet), `ConfirmSheet.tsx` (keeps line breaks)
- `src/app/owner/{staff,schedule}/page.tsx`, `src/app/staff/schedule/page.tsx`, `src/app/owner/staff/loading.tsx` (widths / current staff id), `src/lib/owner/signals.ts` (waiting-requests signal), `package.json` (test scripts)

---

## 5. Migration `024_scheduling_overhaul.sql`

Re-runnable. Checked against live data first (read-only): PostgreSQL 17.6, no malformed times, no duplicate assignments, no duplicate emails, 0 swaps/assignments, constraint names as expected.

- `staff`: `phone`; one-time backfill of `display_name` from first/last name (only where empty); unique index on `lower(email)`; `staff_audit` (append-only for the app).
- `shifts`/`shift_assignments`: HH:MM check, unique (shift, person), overlap triggers; legacy `swap_pending` cleared.
- `shift_swaps`: history survives deletes (`assignment_id` nullable, `on delete set null`), `return_assignment_id`, name snapshots, `terms`, `declined` status, one-active-per-assignment indexes.
- New: `shift_requests`, `schedule_notifications`.
- ~45 `sched_*` / `staff_*` functions; old `auth.uid()` ones dropped; grants/revokes + a built-in verify block.
- **Apply it before deploying this version of the app** (the new UI calls the new functions). `supabase/migrations/` is the source of truth; run via the SQL editor like the others.

---

## 6. Verification

| Suite | Result |
|---|---|
| `node scripts/verify-schedule-sql.mjs` — real Postgres (PGlite): whole workflow incl. legacy-data migration, idempotency, name-only staff, templates, conflicts (same branch **and** across branches, past-midnight), requests, hand-over + exchange swaps, approvals, changes-while-pending, publish + notifications, fair filling, copy/clear, staff lifecycle, privilege model, app↔DB function names | **277 passed** |
| `node scripts/check-schedule.mjs` — real TS sources: names, privacy, labels/clock, default times, coverage, messages, strict schema, rules engine, view helpers, purity — **plus TS == SQL** for labels, overlap (250 random pairs), headcount, names and the full role × branch × delegation access matrix | **150 passed** |
| Existing suites (regression): `verify-pos-sql` / `check-pos` / `check-a11y` | 263 / 1894 / 76 passed |
| `tsc --noEmit` (and `--noUnusedLocals --noUnusedParameters` on the touched files) · `next build` (isolated copy) | clean |
| UI, in a real browser on fixture data (isolated copy): board, shift sheet (create/edit/time wheel/picker/inline approve + confirm), requests inbox, employee schedule/request/swap/my-requests, notifications, staff list/add/edit/deactivate/duplicate-name — at phone (375), tablet-ish (~800) and desktop (1280) widths | verified |

Not run: a real parallel-connection concurrency test (PGlite is single-connection) and a click-through against the live Supabase + Google sign-in (not available in this environment). Concurrency safety rests on the row/advisory locks and the DB-enforced invariants above.

---

## 7. Limitations & decisions you may want to revisit

1. **Scheduling requires verified Google login.** Employees can first activate and use checklists/event POS with their HYP employee number and PIN, then link Google to the same record. Managers can schedule employees before linking; swaps require the selected employee to have a Google login so they can answer.
2. **Staff management stays owner-only** (existing rule). A general manager can run the schedule and approve requests but can't edit people.
3. **"Full" definition.** A shift is full only if it declares a need (per-role minimums) and has reached it. Most shifts declare none, so anyone may ask to join, and the manager is shown who is already on it and must confirm. Say if you'd rather always require a headcount.
4. **Time/date change cancels pending swaps; it does not cancel pending requests** (the manager sees "the shift changed since the request" and must confirm).
5. **Overlapping shifts are never allowed** for one person, in any branch (a person can't be in two places). Softer rules (rest, weekly/daily hours, consecutive days, unavailable day) warn and show their effect before approval, but never block.
6. **Verified Google email can't be edited once someone has signed in** (their Auth identity is the authority). Before linking, any owner-entered email is contact data only and does not unlock Google permissions.
7. Deactivating unlinks the person's login and invalidates active employee sessions/setup proofs. Reactivate and generate a new invitation for that same staff record; the employee sets a PIN and links Google again. History stays on the original UUID.
