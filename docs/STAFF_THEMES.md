# The staff app's five looks (2026-10-17)

Each person picks a look when their account is made (a new step of the onboarding wizard, after "my details") and can change it from their profile ("מראה האפליקציה") or from the row of the same name on the home screen. A look changes colours, shapes and the shift card; it never changes what a screen says or does.

| id | name | mode | idea |
|---|---|---|---|
| `neon` | ניאון קלאסי | dark | the default: warm near-black, glowing orange hero shift card, mint "live" pill, bento "soon" tiles |
| `glass` | זכוכית | dark | frosted-glass cards over a blurred cart-at-night scene (pure CSS light pools), a progress ring around the shift icon, the workshop as a poster |
| `pass` | כרטיס משמרת | dark | the shift as a boarding pass: route line with a marker, a perforation with notches, numbered checklists, a barcode strip, monospace numerals (Space Mono, loaded only for this look and inside the picker) |
| `crema` | קרמה ליום | light | for bright sun: cream, thick espresso outlines with hard shadows, a dark espresso shift card with a hard orange offset shadow |
| `latte` | לאטה בלוסם | light | soft pink latte: round cards, a pink-to-peach shift card with a small heart, a sprinkled progress bar |

## How it works
- **Registry** `src/lib/staff/theme.ts` (pure). Default `neon`; `resolveTheme(db, cookie)` = the account row, else the device cookie, else the default (and `chosen: false`, which makes the home row say "עוד לא בחרתם").
- **Tokens + structure** `src/components/app/staff-themes.css`, every rule scoped by `[data-staff-theme='x']`. The whole app draws from `--bg --bg-elev --neon --text …`, so new tokens re-skin every staff screen (schedule, checklists, profile, sheets). `--on-neon` is the text colour on an accent fill; the dark looks fall back to `--bg` (`color: var(--on-neon, var(--bg))` replaced `color: var(--bg)` in app.css, schedule.css, gate.css, dev-centre.css, branches.css).
- **Where the attribute goes.** `src/app/staff/layout.tsx` reads the look (`loadStaffTheme`) and passes it to `AppMotion` (the `.native-app` wrapper: no flash). `ThemeScope` mirrors it onto `<html>` so sheets and menus that portal to `<body>` match, and removes it when the person leaves `/staff`. Light looks put a dark band under the iPhone status bar (white clock text) via `::after` with `env(safe-area-inset-top)`.
- **Saving.** `POST /api/staff/theme` (private staff route, session only, a code sign-in is enough) writes `staff.ui_theme` when the column exists and ALWAYS sets the plain cookie `sarcafe_staff_theme` (one year). Reads are tolerant (`theme-server.ts`): a missing column or a failed read falls back to the cookie, then the default. So the feature works before the migration is applied, per device; after it, per account.
- **Migration** `supabase/migrations/20261017120000_staff_ui_theme.sql`: one nullable text column + a check on the five names, idempotent, no function, no grant.
- **Picker** `ThemePicker` (radio group, each card a miniature drawn in its own look: the preview rules are scoped `.tp[data-staff-theme='x']` so a page in one look does not recolour the others). Choosing changes the whole screen at once (`THEME_EVENT`); the wizard step (`StaffStyleStep`) saves on "שמירה והמשך" and can always be skipped; the profile (`ProfileStyle`, anchor `#style`) saves on every tap.
- **Home screen additions used by the looks** (`ShiftStatusCard`): a progress line (`--shift-p` on the card), a visible "לסידור המשמרות והאילוצים" row (the card's one link), `app-welcome__name`.
- **Scope.** `/staff/*` only (the staff layout). The owner dashboard and the POS keep the default look.

## Checks
`npm run check:staff-themes` (151): the registry, saving, wiring, the stylesheet has every look, and the CONTRAST of every pair a look draws text or controls on (parsed from the CSS; the brightest light pool of the glass look is blended in). Two accent colours (`crema`, `latte`) were darkened until their control edges reached 3:1; the glass pool's strength is capped by the test.
