# Staff push notifications

Employees and managers install Sarcafe on their home screen and switch on alerts. The server then
pushes (Web Push, the same VAPID keys the customer order page uses) the things that matter at work.

## What gets pushed

| Alert | Who | When | Source |
| --- | --- | --- | --- |
| Schedule published / changed | the people on it | when the manager publishes | `sched_publish_week` -> inbox |
| Shift hours changed to match the branch templates | the people on those shifts | on settings save, or first read after a drift | `preset-sync.ts` -> inbox |
| Swap / take request waiting for you | the colleague asked | when asked | `sched_request_swap`, `sched_request_take` |
| Swap accepted / declined / approved / rejected | both sides, managers when it needs them | at each step | `sched_respond_swap`, `sched_decide_swap` |
| Shift request approved / rejected | the requester | on decision | `sched_decide_request` |
| **Someone is giving a shift to everyone** | colleagues who could take it (same branch, schedulable, not already on that shift) | the moment the offer is made | trigger `shift_swaps_notify_open` (new) |
| **Your shift starts within the hour** | the person on it (published weeks only) | once per assignment | scheduled run, `staff-reminders.ts` (new) |
| **Checklist not submitted** | the person assigned | opening: 60 min after the shift starts; handover/closing: 10 min after it ends (6 h window) | scheduled run (new) |
| **Checklist still missing** | owners (the checklist inbox is owner-only) | 40 min after it became due | scheduled run (new) |

Everything that already wrote to the in-app inbox is pushed with no change at its call site: the inbox
(`schedule_notifications`) is also the outbox.

## How it works

1. **Install + opt in.** `StaffPushCard` (`src/components/staff/StaffPushCard.tsx`) is shown in the onboarding
   wizard (`variant="wizard"`), at the top of the staff home and on both owner dashboard views
   (`variant="home"`, dismissible for 3 days). A plain-language ask comes first; the browser permission dialog
   only after "yes". On an iPhone in a normal Safari tab it shows the add-to-home-screen steps instead, because
   Web Push exists there only inside the home-screen app.
2. **Subscribe.** `subscribeStaffPush()` (`src/lib/push/client.ts`) -> `POST /api/staff/push` with
   `action: subscribe`. The person always comes from the session (Google or employee number + code), never from the
   body. The row lives in `staff_push_subscriptions`; the endpoint is unique, so when another employee signs in on
   the same phone the subscription moves to them. `status`, `unsubscribe` and `test` are the other actions.
3. **Send.** `flushStaffPush()` (`src/lib/push/staff.ts`) claims inbox rows whose `push_sent_at` is null (stamps them
   BEFORE sending: at-most-once, overlapping runs cannot double send), sends one push per row (a person with more than
   three in one run gets one summary), deletes subscriptions the push service reports gone (404/410), and stamps rows
   older than two hours without sending. It runs after every `/api/shifts/dispatch` write and after a hours sync via
   `after()`, and from the scheduled run.
4. **Timed reminders.** `GET /api/cron/staff-push` (needs `Authorization: Bearer $CRON_SECRET`) writes the shift and
   checklist reminders (each once, via `dedupe_key`) and then flushes. Reminders are written for employees with a
   number + code login too, not only Google-linked ones.
5. **Tap.** `public/sw.js` shows the notification (tag `staff-<id>` replaces instead of stacking) and opens the page from
   the payload: `/staff/schedule`, `/staff/checklists`, `/owner/checklists`. A stored link is honoured only if it is a
   plain same-origin path.

## Scheduler (Supabase pg_cron + pg_net, live since 2026-10-12)

Migration `20261012130000_staff_push_scheduler.sql` schedules job `staff-push` (every 2 minutes). It runs
`staff_push_tick()`, which calls `GET /api/cron/staff-push` on the production site through pg_net. The call carries a random
bearer secret that the migration generated into Supabase Vault (`staff_push_cron`); the route checks it with
`staff_push_verify_cron()`, so the secret never leaves the database and no Vercel env var is needed (`CRON_SECRET` is also
accepted). Vercel's Hobby plan only allows daily crons, so nothing sub-daily goes in `vercel.json` (`check:staff-push` guards it).

- Stop: `select cron.unschedule('staff-push');`  Change the rhythm: re-run `select cron.schedule('staff-push', '<cron>', 'select public.staff_push_tick()');`
- Look: the developer panel shows the job, its last run and the app's last HTTP answer (`staff_push_cron_status()`), or query `cron.job_run_details` and `net._http_response`.
- The URL is written into `staff_push_tick()`; if the production domain ever changes, `create or replace` that function.
- Where pg_cron, pg_net or Vault are missing (local PGlite tests) the migration creates the functions and skips the schedule.

## Developer test bench

On the owner dashboard, only for a developer (`badge = developer` or an email in `CHECKLIST_DEVELOPER_EMAILS`; checked again in
`POST /api/staff/push`): `DevPushPanel`. Each button writes a real inbox row for you (stamped read, titled "(בדיקה)") and
pushes it through the production path, so a notification on the phone proves the whole chain. "Direct send" bypasses the inbox
and shows the push service's own refusal text. It also shows VAPID configured, your registered devices, how many alerts are
waiting, and the scheduler state. Code: `src/lib/push/dev.ts`, `src/components/staff/DevPushPanel.tsx`.

## Limits and things to know

- iPhone: the home-screen app keeps its own sign-in, so after installing, the employee signs in again inside it and then
  enables alerts there. Android and desktop Chrome can enable alerts in a normal tab.
- One browser holds one push subscription, shared with the customer order page. Turning off an order alert removes only
  the server row, never the browser subscription, so staff alerts keep working.
- A shared phone: alerts go to whoever signed in last on it. Signing out does not remove the subscription; the person
  can switch alerts off from the card before handing the phone over.
- Delivery depends on the push service (Apple, Google); the card's "send a test" shows the push service's own error text
  when it refuses.
- Not in this release: per-category preferences (everything is on or off), quiet hours, notification of unreviewed
  checklists with defects (the owner inbox already shows those), manager push for new availability submissions.

## Verification

`npm run check:staff-push` (rules + wiring), `npm run verify:schedule-sql` (outbox stamping, dedupe, open-offer trigger,
privileges), `npm run verify:onboarding-sql` (no duplicate function names).
