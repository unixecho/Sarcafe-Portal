# Branch manager, developer dashboard, חוסרים ופערים (2026-10-16)

## Round 3 (2026-10-16): a slider between branches, and the POS as a subsystem of each branch

**The slider.** A row of pills on top of the branch manager and the branch list: `כל הסניפים` · one pill per coffee truck · `+` add a branch (`src/components/branches/BranchSlider.tsx`). The current branch is marked (`aria-current`), the other pills are links to that branch and **keep the tab you are on** (`/owner/branches/<slug>?tab=pos` stays on the POS tab when you move to the other truck). Events are never pills: they are not branches of the business.

**POS and events are a subsystem of a truck.** Until now an event (a stall the POS trades at, `branches.kind = 'event'`) sat next to the trucks as if it were a branch. Now an event belongs to ONE truck through `branches.parent_branch_id`:
- The branch manager gained a sixth tab, **קופה ואירועים** (`?tab=pos`): the truck's events with their register state (פעילה / כבויה), "ניהול הקופה" (opens that event's POS through the current-branch cookie) and "הגדרות הקופה" (its POS setup), and **אירוע חדש במאור** (creates the event inside this truck: `POST /api/owner/branches` with `parentSlug`, then `PATCH /api/owner/pos/settings` switches its register on). Events that existed before this change belong to nobody; they are listed under "אירועים שעוד לא שייכים לסניף" with "שייכו ל<truck>" (`POST /api/owner/branches/parent` → `branch_set_parent`).
- `/owner/branches` and the owner dashboard list **trucks only** (`getBranches()` already returns permanent branches). The list shows "N אירועים" on each truck and a note about unclaimed events. An event's own address (`/owner/branches/<event-slug>`) redirects to its truck's POS tab (or to the list when nobody owns it).
- The POS hub (`/owner/pos`) and its setup page label an event "truck · event"; creating an event from the setup page inside a truck passes `defaultParentSlug`, so a future second truck's events are never mixed with the first's.
- Rules (database trigger `branches_parent_guard`): only an event may have a parent; the parent must be a permanent branch; never itself. `branch_set_parent(p_actor, p_event, p_parent)` is owner-only (`sched_is_op`), service role only, logged to the schedule audit (`branch.parent`); `p_parent = null` detaches.
- The public `getBranches()` columns were deliberately NOT extended with `parent_branch_id` (anon column privileges would have broken the customer pages); the parent is read by the service role in `loadEventTree` (`src/lib/branches/manager.ts`).
- Migration `20261016140000_onboarding_progress_event_parent.sql` (also carries the two staff columns for the onboarding gate). **Check that it is applied before this code runs**: `/owner/staff` selects `push_gate_exempt` and the POS pieces use `parent_branch_id`.

**The developer's dashboard** (`/staff/dev`) is the Ayeka Bar one again: a sticky slider of three instant views (מפתח · מנהל · עובד, `LensTabs.tsx`). All three panels are built on the server once and swapped in the browser, so switching costs no request and keeps scroll and state; the choice goes into the URL (`?view=`) with `replaceState`.

## The branch manager — `/owner/branches`

Owner-only (middleware `OP_ONLY_PREFIXES`, the pages and the API each check again). `/owner/branches` lists every branch as a card (open now, "ready to run" or "N things missing", people in the schedule, checklists on, things needing attention) and has "add a new branch" (the same `AddBranchSheet` the menu editor uses, then it opens the new branch's manager). `/owner/branches/<slug>?tab=` is one branch, in five tabs:

| tab | what it holds |
|---|---|
| סקירה (`overview`) | the **readiness list** (hours, shift templates, people in the schedule, checklists on, navigation links; each row jumps to the tab that fixes it) and four numbers |
| צ׳קליסטים (`checklists`) | a switch per kind (opening / handover / closing) for THIS branch, version and date of the form, a link to edit the form and the tracker |
| סידור (`schedule`) | the scheduler's own settings (`ManagerPanel`), inside its usual draft and one Save: hours, templates, safety rules, what employees may ask for, roles, stations, roster |
| פרטים (`details`) | the branch's navigation / Instagram / review links (`BranchLinksEditor`) |
| צוות (`team`) | who works there and whether they are in the schedule; link to `/owner/staff` |

Data: `src/lib/branches/manager.ts` (`loadBranchOverview`); UI: `src/components/branches/`. The schedule tab mounts `ScheduleSettings.tsx`, which waits for the branch's schedule before mounting the draft (the draft starts from it; mounting it earlier crashed in the first browser test).

### Switching a checklist off for one branch

`checklist_branch_settings (branch_id, kind, enabled, disabled_from, updated_by, updated_at)`, service role only. `checklist_expected()` (the one rule for which forms a week calls for) leaves out a kind that is switched off from `disabled_from` on. `checklist_set_branch_kind(p_actor, p_branch, p_kind, p_enabled)` (owner only, via `POST /api/owner/branches/checklists`):
- **off**: unstarted forms of days that have not passed are deleted; started / covered ones are closed with the reason "הצ׳קליסט הושבת בסניף" (the existing dismiss columns, so no alert chases them); sent ones stay as evidence. A schedule change never brings the kind back.
- **on**: the schedule is re-synced for this week onward; forms the sync creates for days that already passed are closed ("not asked retroactively").
Nothing about the other branches changes. It is written to the schedule audit log.

## חוסרים ופערים — one list

`/owner/issues` (also reachable by a branch's general manager: `requireMenuEditor` per branch, middleware moved it to the menu-editor prefixes). Two kinds of line in ONE list:
- **items**: what sent checklists said is missing / not working (one line per check, however many people reported it; unchanged rules in `issues.ts`);
- **gaps** (`src/lib/checklists/gaps.ts`): a checklist of a shift that is late (same minute as the employee's alert), not sent, not covered, not dismissed — one line per (shift, kind), people named together. Closing a gap = the tracker's dismiss for every unsent copy (`closeGap`).
The screen (`IssueReport.tsx`) is collapsible per line ("open all"), filters by kind, refreshes itself every minute and when you come back to it, removes a line the moment you close it and puts it back with a sentence if the server says no.
**Daily alert**: `issues.digest` at 08:00 branch time, only when something is open (items + gaps), to every owner and developer and to the branch's general manager (or all-branch general manager). Title `חוסרים ופערים: N דברים לטיפול`.

## Developer dashboard — `/staff/dev`

One page with three views (`?view=manager|employee|dev`, default `dev`), the same idea as the Ayeka Bar dashboard: **מנהל** is `OwnerDashboardView` (exactly the owner's dashboard), **עובד** is `EmployeeDashboardView` (exactly what staff see, incl. the test-shift card), **מפתח** is the health check (`dev-health.ts`: each migration judged by the object it creates, scheduler status, VAPID, reach, backlog, each branch's readiness), the alert test bench, the test checklists, the legend of notification prefixes and reference links. Only the opened view is rendered; the tab switch moves the URL. A developer who opens `/staff` or `/owner/dashboard` is redirected here. A developer without an owner row has no manager view.

## Accessibility widget and skip link: customer pages only (2026-10-16)

`src/lib/a11y-scope.ts` is an ALLOW-list (`/`, `/menu`, `/order`, `/accessibility`, `/privacy`, `/board`); everything else (dashboards, staff tools, the register, the sign-in door, a page nobody classified yet) is private. `SkipLink.tsx` and `PublicA11yWidget.tsx` render only on customer pages, and leaving one strips what the widget left on the page (its classes, custom properties and the `#a11y-scope` filter), so a visitor's high-contrast setting cannot follow them into the dashboard. `npm run check:a11y-scope` fails when a new top-level route is not classified.

## Notification prefixes (developer account only)

`alertAudience(kind)` / `alertTitle(kind, title, {developer})` in `src/lib/push/staff-rules.ts`. On the developer's own copy: `בעלים · ` for management alerts (checklist.gap, issues.digest, everything that waits for a manager's decision, the new constraint alerts), `מפתח · ` for `dev.*`, nothing for employee alerts. Owners and employees never get a prefix. Applied in the phone push (`staff.ts`), the inbox API and both dashboard bodies.
