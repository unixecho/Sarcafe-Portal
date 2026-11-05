# Sarcafe glass UI (glisse): style rules, preview status, how to apply

**Status (2026-11-05): APPLIED to the app** — the working guide is now `docs/SARCAFE_GLASS_UI.md`. This file keeps the preview's history,
measurements and reasons (2026-11-04). The preview is a private Claude artifact (sample data only) and its source is
kept in `docs/glass-preview/` (the `.ts`/`.tsx` files carry a `.txt` suffix on purpose: `tsconfig.json` type-checks every
`.ts`/`.tsx` in the repo, and glisse is not installed here, so real extensions would break `npm run typecheck` and the Vercel build).

## The rule (owner, 2026-11-04) — applies to every agent
> The account button at the top left of the glass top bar is the signature. **Every menu, popover, picker and notification list
> uses that style, always.**

What that means in code:

- A list of actions opened from an icon button is glisse's real `<Menu>` (the icon morphs into the card). The notification bell is one.
  Item labels may be rich (title + body + time + a pill). Menu cards align to the trigger with `align="start"`; set the card width
  with `.notif .lg-menu-card { width: min(300px, calc(100vw - 100px)) }` so it never leaves the screen.
- A popover anchored to something that is not an icon (search results, a toast) uses the **same surface** through the `.pop` class
  in the preview CSS: `background: var(--lg-surface)`, `backdrop-filter: blur(22px) saturate(1.9)`, radius 20, the inset edge and
  drop shadow of `.lg-menu-surface`, rows built from `.lg-menu-item`.
- `--lg-surface` is `rgb(27 20 17 / .97)`: nearly opaque on purpose, so nothing behind a menu competes with its text.
- The "waiting for you" pill (the orange `2 בקשות` badge on the schedule row) is the one badge style for counts and states: tool rows,
  shortcut tiles, search results, notification rows (`חדש`). Dark ink (`#150f0c`) on `--neon` (`#ff7a45`), 7.6:1.
- Static cards use `.surf` (same look, no glisse refraction filter). Real `<Glass>` is for the top bar and the controls.

## What the preview contains
Owner dashboard rebuilt on all nine glisse components (`Glass`, `TabBar`, `SegmentedControl`, `Button`, `Switch`, `Slider`, `Input`,
`SearchField`, `Menu`), with working bottom navigation (home, schedule, team, register, more), the notification menu, an employee and
a developer view, and:

- **Quick message to the team** (`QuickMessage`): audience = everyone at the branch, or a specific shift (day strip for the next 7 days
  + morning/evening), and when more than one person is scheduled on that shift, the whole shift or one person. The summary line says
  exactly who receives it; a shift with nobody scheduled disables Send. Templates for common messages (milk delivery, come early…).
- **Tool finder** (`ToolSearch` + `search.ts` + the 49-entry index in `data.ts`, real routes): Hebrew-aware (final letters, niqqud,
  optional leading ה/ב/ל/מ/ש/ו/כ), tolerant of typos, synonyms and English; completions (Tab accepts), "did you mean", and ranking by
  text match + how often/recently this person opened it + their role (manager / employee / developer) + time of day (opening
  checklist in the morning, closing at night). Shortcuts on the home screen use the same ranking. Usage and recent searches are kept
  per role in `localStorage` on the device only; the preview starts from example usage and says so.

## What was found while building it (keep these)
1. **RTL.** glisse positions every selection thumb with physical left/right. Put each `SegmentedControl` / `TabBar` in a `dir="ltr"`
   box and pass the items reversed: it then reads right-to-left correctly (`Seg` in `ui.tsx`).
2. **Never stretch a glisse control with `width: 100%`.** It sizes segments with `--lg-tab-width` and moves the thumb by exactly that
   width. Stretching the box left the labels and thumb at their natural size: the bottom bar's labels overflowed the glass by 34 px on a
   390 px phone and the thumb drifted up to 96 px (that was the "glitchy" nav). Set the variable instead: `calc((100cqw - 8px) / 5)` for
   the five-tab bar, `calc(100cqw / N)` for full-width segments (container query units).
3. **Lag.** Every `<Glass>` builds an SVG displacement filter plus a canvas map (Chromium only; iOS Safari gets plain blur). Glass that sits
   over scrolling content re-runs it every frame. Fixes that kept the look: static cards are `.surf`; while the page scrolls the lens is
   swapped for plain blur (`html.is-scrolling`, removed 180 ms after the last scroll); for 0.9 s after a branch or tab switch the glass
   around the moving thumb is plain blur (`html.is-switching`) while the thumb keeps its lens. glisse only re-fits on size changes, so
   toggling `--lg-filter` with `!important` is cheap. The page background is one fixed layer, not `background-attachment: fixed`.
4. **Contrast.** glisse's filled button is white on the fill (2.6:1 on `#ff7a45`): use dark ink. A disabled filled button needs its own
   look (glisse fades it to 35%). glisse's clear button for `SearchField` has an English `aria-label`: it is rewritten to Hebrew.
5. **`[hidden]`.** A `display: grid` rule on a view overrides the `hidden` attribute: add `.view[hidden] { display: none !important }`.
6. A time range inside Hebrew text (`07:00–14:00`) is flipped by the bidi rules: wrap it in `<bdi dir="ltr">`.

## Verification of the preview (headless Chromium, not a real phone)
| Check | Result |
|---|---|
| Frame times at 4x CPU throttle, branch switch | before: ~8 frames in 1.6 s, frames of 80-500 ms; after: ~90 frames, worst 117 ms |
| Scrolling | before: stalls up to 933 ms; after: 2-4 frames over 50 ms, worst 83-100 ms |
| Bottom nav (`navtest.cjs`) at 360/390/430/768/1280 px | 215 checks: thumb centred on its tab, one view visible, scroll reset, rapid taps, drag, keyboard, no overflow |
| Every segmented control (`segtest.cjs`) | 123 checks, thumb centred, nothing clipped |
| Contrast (`contrast.cjs`): text colour vs the real pixels behind it (worst 10%), ~920 text runs in 24 states each width | 0 below WCAG AA (lowest 4.65:1) at 360, 390, 768 and 1280 px. At 430 px one pill is flagged only because the open menu's edge covers half of it |
| Search engine (`test-search.mjs`) | prefixes, typos, English, synonyms, completions, usage and time-of-day ranking behave as designed |

**Not verified:** a real phone or tablet, iOS Safari (no refraction there), the installed PWA, screen readers, a real Hebrew keyboard
autocomplete, the quick message end to end (UI only).

## To apply it to the app (after the owner approves)
1. `npm install glisse` (MIT, peer deps react >= 18). Import `glisse/styles.css` once. Add the preview's token block (`--lg-*` mapping and the
   dark values on `:root`) to the app CSS; keep it dark-only like the rest of the owner app.
2. Behind the existing staff look option (`src/lib/staff/theme.ts` has five looks, one already called "זכוכית"): do not replace the others.
3. Port `Seg`, the top bar, `QuickMessage`, `ToolSearch`, `search.ts` and the index from `docs/glass-preview/src` into `src/components` and
   `src/lib`, replacing sample data with real reads. The index entries already use the real routes.
4. **Quick message backend (new).** One owner-only route that resolves recipients on the server and inserts one `schedule_notifications`
   row per person (columns: `branch_id, staff_id, kind, title, body, link`; service-role only today), then the existing push outbox
   delivers it. A new kind (for example `staff.message`) falls to the employee audience by default in `src/lib/push/staff-rules.ts`;
   add its `pushPathFor` link. Recipients: everyone = active staff of the branch; a shift = `shift_assignments` of that `shifts` row, only
   in a **published** week (`publishedWeekIds`, as `nextShiftNotices` does), only active staff; one person = a `staff_id` that must be
   assigned to that shift (check on the server, never trust the client). The real shift picker should list real shifts (date + hours from
   `shifts.start_time/end_time`), not a fixed morning/evening: the database already treats a shift ending after 13:00 as an evening shift too.
   Rate-limit per sender, cap the text (the preview uses 140 characters) and write an audit row.
5. Usage history for the finder: per device in `localStorage` as in the preview, or per person in the database if it should follow them
   between devices (that would be a migration; follow the naming rules in `CLAUDE.md`).
6. Run `npm run typecheck`, the existing `check:*` scripts, then the checks in `docs/glass-preview/checks` against the real pages on a real phone.

Rebuild or re-run the preview: see `docs/glass-preview/README.md`.
