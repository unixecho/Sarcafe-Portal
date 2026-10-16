# Cart QR sign-in, the two home screens, and the closed constraints week (2026-10-17)

Asked by the owner after testing with a test account.

## Two sign-ins, two homes
- **App sign-in (Google)** -> `/staff` shows `EmployeeDashboardView`, in this order: alerts and the notification status -> the **shift card** -> the coffee workshop card -> (soon tiles, manager tools) -> the person's own area (profile). The old "המשמרת שלי" list (checklists / schedule rows) is gone: the shift card is the one door to the checklists (its buttons, locked until each opens) and to the schedule (tapping the card). No "add to Home Screen" row any more: the notifications gate already puts the app on the Home Screen before this page opens.
- **Six-digit-code sign-in** -> `/staff` shows `CodeDashboardView`: the greeting, the shift card in `codeMode` and the Home Screen shortcut row, nothing else. Tapping the card goes to `/login?next=/staff/schedule` (the Google sign-in, which needs the app installed): the schedule is not available on a code session. The card says when a checklist is unavailable (no shift, shift not today, nothing waiting).
- `src/app/staff/layout.tsx`: a code session is never stopped by the app set-up gate (`codeSession ? 'off'`); the Google sign-in still is.

## `/crew` — the address for the printed QR code
Public page (`src/app/crew/`): employee number + six-digit code (`QuickLogin`, next = `/staff`), one small link to the Google sign-in. Someone already signed in is sent to `/staff`. Not indexed. Print the QR for `https://<site>/crew`; the same URL works as a plain link. `scripts/check-a11y-scope.mjs` lists `crew` as private (no accessibility widget).

## Constraints (אילוצים) window
The form only hid itself after the Tuesday; the server did not refuse. `dispatch-write.ts` `requireRequestsOpen()` now refuses `submitTimeOff` and `submitAvailability` for a week whose Tuesday (branch clock) has passed (`requests_closed`, 409). `sched_submit_availability` already refused in SQL; `sched_submit_time_off` did not, so no migration was needed: the TypeScript check sits in front of the only caller.
On the employee "בקשות לשבוע" tab a closed week shows `ClosedWeekCard` (what was sent, "go to next week") INSTEAD of the form, and the next-week arrow pulses (`.sch-iconbtn--nudge`, still ring under reduced motion). With no open shifts the request section says so ("אי אפשר לבקש להצטרף כרגע").

The first-run tour (`src/lib/staff/tour.ts`) now lights one "המשמרת הבאה שלך" row instead of the two rows that moved into the card.
