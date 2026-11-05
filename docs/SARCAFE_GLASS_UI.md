# Sarcafe glass UI (glisse) — the guide for every new screen

**Status (2026-11-05): LIVE.** The owner approved the glass look (owner: "implement it … so I can continue with other features and they
will use the glisse feature"). The owner dashboard, the employee home, the developer dashboard, the morning QA review and the
"מי במשמרת עכשיו" card are glass. Every new feature screen is built with the pieces below. The design history and the measurements are in
`docs/SARCAFE_GLASS_UI_STYLE.md` (the preview); this file is the working guide.

## The owner's rules (do not change without asking)
1. **The account button's menu is the signature.** Every menu, popover, picker and notification list looks like it: glisse's `<Menu>`
   when it opens from an icon button, the `.gl-pop` surface otherwise (same tokens, same radius, same shadow).
2. **One badge style**: the orange pill (`<Pill>` / `.gl-pill`), like "2 בקשות". Only ever with a true, known number.
3. **Good news green, bad news and errors red** (`--gl-ok`, `--gl-bad`; `.gl-pill--ok/--bad`, `.gl-surf--ok/--bad`, `glassToast(msg, 'ok' | 'bad')`).
   Neutral stays the look's own accent. Status is never colour alone: an icon or words go with it.
4. The top bar stays exactly as it is (logo, branch switch for a manager, bell, account).
5. **The home tool lists are the owner's** (2026-10-16/17): the owner's three categories, the employee's "במהלך השירות" and a general
   manager's "ניהול במשמרת" (with their branch's checklist builder) stay as `DashboardSections`, item for item. The shortcuts and the
   finder sit on top of them; they never replace them. The regression scripts check this.

## Building a screen
```tsx
// a home-like screen (top bar + dock):
<GlassDashboardShell title="…" dock="manager" | "employee" home="/owner/dashboard" account={{ developer, manager }} branchSwitch?>
  …content…
</GlassDashboardShell>

// any other page that wants glass pieces without the shell: import 'glisse/styles.css' and '@/components/glass/glass.css'
```
| Piece | File | Use |
|---|---|---|
| `GlassDashboardShell` | `src/components/glass/GlassDashboardShell.tsx` | backdrop → (branch provider) → top bar → `<main className="gl-main">` → dock |
| `GlassPage` | `GlassPage.tsx` | the backdrop, toaster and scroll smoothing only |
| `GlassTopBar` | `GlassTopBar.tsx` | logo, branch switch, notifications `<Menu>`, account `<Menu>` |
| `GlassDock` | `GlassDock.tsx` | bottom `TabBar` with real links; "עוד" opens the tool finder |
| `Seg` | `Seg.tsx` | the ONLY way to use glisse's `SegmentedControl` in Hebrew (RTL fix, `fill`) |
| `useGlassBranch()` | `BranchContext.tsx` | the branch chosen in the top bar (null outside a manager dashboard) |
| `glassToast()` | `toast.ts` | tell the person what happened: `'ok'` green, `'bad'` red, `'neutral'` |
| `Pill` | `Pill.tsx` | the badge |
| `ToolsProvider`, `ToolFinder`, `ToolShortcuts`, `ToolGroups` | `src/components/glass/tools/` | search, shortcuts, lists (index: `src/lib/tools/index.ts`) |
| `TeamMessage` | `TeamMessage.tsx` | the team message composer (docs/SARCAFE_TEAM_MESSAGE.md) |
| classes | `glass.css` | `.gl-surf` card, `.gl-card`, `.gl-row-card`, `.gl-stats`, `.gl-chip`, `.gl-strip`, `.gl-wrap`, `.gl-field`, `.gl-label`, `.gl-summary`, `.gl-note--bad` |

### Adding a tool to the finder
Add one entry to `TOOLS` in `src/lib/tools/index.ts` (id, label, hint, real `href`, `roles` matching the middleware access rules,
keywords people would type, optional `ctx` morning/evening) and its icon in `src/components/glass/tools/toolIcons.ts`.
Roles: `OP` owner only, `MGR` owner + general manager, `STAFF` a person's OWN shift tools (their shifts, checklists, payslip: employees
and general managers, never owners), `ALL`, `DEV`. The QA unit stage
fails if an owner-only page is offered to anyone else, or if an id is repeated.

## Rules that are easy to break (each one bit us once)
- **RTL:** glisse places selection thumbs with physical left/right. Never use `SegmentedControl` or `TabBar` directly: `Seg` and `GlassDock`
  put them in an LTR box with the items reversed.
- **Width:** never stretch a glisse control with `width: 100%`. It sizes segments with `--lg-tab-width` and moves the thumb by exactly that.
  `Seg fill` and the dock set the variable with container units; stretching the box drifted the thumb by up to 96 px.
- **Menu rows:** glisse's menu items set `min-height: 32px`, which replaces the flex rule "never shrink below the content". In a menu
  with a `max-height` (the notifications) every row was squeezed to 32 px and the text ran over the next row (owner's iPhone,
  2026-11-05). `glass.css` keeps `flex-shrink: 0` on every menu row; a long menu scrolls. Test lists at real volume, not the seed's
  three rows (QA `ui.notifications-long`). Long items are clamped to two lines (`.gl-nt__top strong`, `.gl-nt__body`).
- **Speed:** every glisse `<Glass>` builds an SVG refraction filter (Chromium only). Use `.gl-surf` for static cards; keep real `<Glass>` for
  the top bar, the dock and controls. `GlassMotion` swaps the lens for plain blur while scrolling and `settleGlass()` for 0.9 s after a switch.
- **Contrast:** glisse's filled button is white on the fill (2.6:1 on our orange); glass.css makes it dark ink (7.6:1) and keeps the disabled
  state legible. Menus and popovers use `--lg-surface` at 97% so nothing shows through. Run the QA `ui` stage: it measures every text
  against the real pixels behind it in all five looks.
- **Bidi:** a time range in Hebrew text (07:00–14:00) must be wrapped in `<bdi dir="ltr">`.
- **`hidden`:** a `display:grid` rule overrides the `hidden` attribute; add `[hidden] { display: none !important }` for that class.
- **Looks:** glass.css maps glisse's `--lg-*` tokens from each look's own tokens (`--bg`, `--bg-elev`, `--text`, `--neon`); the two light looks
  (crema, latte) get glisse's light values. Do not hard-code dark colours in a glass screen.

## Not glass yet (next steps, in order)
The inner owner pages (schedule, staff, checklists, menu editor…) still use the original header (`OwnerHeader` with the menu). Move them one
at a time: put the page in `GlassPage`, keep `OwnerHeader` or use the top bar, swap cards to `.gl-surf`, then run `npm run qa`. The dock is on
the home screens only; extend it to inner pages after checking each page's own bottom bars (checklists, POS) do not collide with it.
