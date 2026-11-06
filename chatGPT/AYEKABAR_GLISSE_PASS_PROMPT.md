# Prompt: AyekaBar dashboard glass (glisse) revamp — for ChatGPT (Astra 6, Extra High)

Paste everything below the line into ChatGPT, with the AyekaBar repository connected (and, if you can, the Sarcafe repository
`unixecho/Sarcafe-Portal` too, read-only, as the reference).

---

You are a senior front-end engineer doing a careful, production-quality redesign. Work in the **AyekaBar** repository. The goal:
give AyekaBar's **staff/owner dashboards** the same "liquid glass" revamp that its sister project **Sarcafe** got, including every
small fix the owner asked for along the way. The customer-facing website is **out of scope** (do not touch it).

## 0. Ground rules
- First read the AyekaBar repo's own instructions (`CLAUDE.md`, `AGENTS.md`, `handoff.md`, `README`, docs) and follow them; where they
  conflict with this prompt, the repo's rules win and you say so.
- Do not invent a new design system. Port Sarcafe's, adapted to AyekaBar's routes, data, roles and brand.
- Never change what the dashboards DO (data, permissions, which tools each role sees, the order of the owner's tool lists) while
  restyling. A restyle that drops or reorders a tool is a bug.
- Never record or print secrets, keys, passwords, employee codes or personal staff data in code, commits, docs or chat.
- Work in small, reviewable commits on a branch. Do not push to `main` or deploy without the owner's go.
- When you are unsure, inspect the code; when it is the owner's decision (brand colours, what to call things), ask once, briefly.

## 1. The reference: how Sarcafe did it (read these if you can reach the Sarcafe repo)
- `docs/SARCAFE_GLASS_UI.md`: the working guide (rules, pieces, traps). The most important file.
- `docs/SARCAFE_GLASS_UI_STYLE.md`: the design history and measurements.
- `src/components/glass/` (`glass.css`, `GlassDashboardShell`, `GlassTopBar`, `GlassDock`, `DockHost`, `GlassSkeleton`, `Seg`, `Pill`,
  `toast.ts`, `GlassMotion`, `tools/*`) and `src/lib/nav/dock.ts`.
- The library is **glisse 0.5.0** (React "Liquid Glass"), pinned exactly in `package.json`.
If you cannot reach it, everything you need is restated below.

## 2. The owner's rules (non-negotiable)
1. **The account button's menu is the signature look.** Every menu, popover, picker and notification list looks like it: glisse's
   `<Menu>` when it opens from an icon button, otherwise a `.gl-pop`-style surface with the SAME tokens, radius and shadow. Menus and
   popovers are nearly opaque (surface ≈ 97%) so nothing behind competes with their text.
2. **One badge style:** a single orange pill (like "2 בקשות"), only ever with a true, known number. No other badge styles.
3. **Good news green, bad news and errors red.** Toasts, pills, status lines, notification rows. Neutral stays the brand accent. Status
   is never colour alone: an icon or words go with it.
4. **The top bar stays as it is** structurally (logo, branch switch for managers, bell, account menu), just in glass.
5. **The home tool lists are the owner's:** keep every tool, every category, the order. Shortcuts and a search ("tool finder") may sit
   ON TOP of the lists; they never replace them.

## 3. Build it like this
- **Shell:** one `GlassDashboardShell`-like component: backdrop → (branch context) → glass top bar → `<main>`. Every dashboard screen
  uses it.
- **Cards are cheap glass:** static cards use a CSS glass surface (`.gl-surf`: blur + tint + 0.5 px edge), NOT a real `<Glass>` (each
  real one builds an SVG refraction filter: slow). Real `<Glass>` only for the top bar, the dock and controls. While scrolling, and for
  ~0.9 s after a switch, swap refraction for plain blur (Sarcafe's `GlassMotion` / `settleGlass()`).
- **Map glisse tokens from the app's own theme tokens** (`--lg-*` from the app's `--bg`, `--bg-elev`, `--text`, accent). If AyekaBar has
  several looks/themes (including light ones), every look must work; light looks need stronger secondary text. No hard-coded dark colours.
- **The bottom dock (tab bar) belongs to the LAYOUT, never to a page**, so it is the same element across tabs and does not blink or
  slide; give it its own view-transition name so the page slides and the bar does not. Who gets which tabs lives in one plan file.
  The tapped tab lights up at once; a "more" tab opens the tool finder.
- **Every route has a `loading.tsx` skeleton shaped like its page** (same backdrop and title, shimmering blocks where the cards go).
  Parts that load in the browser show skeleton blocks, never "טוען…"/"Loading…" text (screen readers get words in `.sr-only`).
- **Instant revisits:** keep visited pages in the router cache (Next `experimental.staleTimes`, e.g. dynamic 180 s / static 300 s), AND
  keep it honest: after any successful write through an API route, refresh the router once on the next tab change and when the app comes
  back after > 1 minute away; live numbers refresh themselves quietly when their copy is older than ~10 s.
- **Only the fields that need data wait:** render the frame (titles, links, buttons, dock) immediately and stream the data parts behind
  `<Suspense>` with a skeleton shaped like that part. Never a whole-page `await` when only one card needs data. Share per-request reads
  with React `cache()`.
- **Taps feel instant:** links prefetch; a tap shows the next page's skeleton at once.

## 4. The small fixes the owner asked for on Sarcafe (apply all of them; each one bit us once)
- **RTL + glisse:** glisse places selection thumbs with physical left/right. Never use its `SegmentedControl` or `TabBar` directly in a
  right-to-left UI: wrap them (Sarcafe's `Seg` / `GlassDock`) in an LTR box with the items reversed.
- **Width trap:** never stretch a glisse control with `width: 100%`; it sizes segments with `--lg-tab-width` and moves the thumb by
  exactly that. Set the variable with container units instead (the thumb drifted up to 96 px).
- **Notification list overlap:** glisse menu items set `min-height: 32px`; in a menu with a `max-height` every row got squeezed and the
  text ran over the next row (owner's iPhone). Keep `flex-shrink: 0` on every menu row, let long menus scroll, clamp long items to two
  lines. Test with 30+ notifications, not three.
- **iPhone safe areas:** the page reserves `env(safe-area-inset-top)` and the top bar is sticky at that height (it used to sit 59 px on the
  first card); a status-bar strip shades cards that scroll under the clock; the dock rests just above the home indicator
  (`max(10px, safe-area-bottom − 12px)`) over an opaque band, so nothing shows beneath it (it used to float 46 px up). Test with real
  safe-area insets (Chromium has none by default; emulate them).
- **Bottom bars (save bars):** use `position: fixed` like the dock, never `position: sticky; bottom` (on iPhone it got stranded mid-screen
  after scrolling down and up). A page's bottom bar sits ABOVE the dock; a task that owns the screen may hide the dock.
- **"Coming soon" tiles:** a group of rounded tiles must not get a square glass box behind it; give the tiles the surface, not the group.
- **Contrast (WCAG AA 4.5:1) measured on real pixels, in every look:** glisse's filled button is white on the fill (2.6:1 on orange):
  make it dark ink. Disabled states stay legible. Soft chips on bright backdrop areas need the card surface under their tint. A green
  or red status line on a tinted block keeps its WORDS in the text colour and lets the block carry the tone (green words on a tinted
  light card measured 3.9:1). Small bold pill text needs margin above 4.5 (darker ink on the accent).
- **Bidi:** a time range inside Hebrew text (07:00–14:00) goes in `<bdi dir="ltr">`.
- **`hidden` attribute:** a `display:grid/flex` rule overrides it; add `[hidden]{display:none!important}` for those classes.
- **Two dashboards, one switch:** if AyekaBar has more than one dashboard (e.g. owner + device/kiosk), a segmented switch at the top moves
  between them without a page reload and keeps the dock.

## 5. How to work
1. **Map first (no code yet):** list AyekaBar's dashboard routes, layouts, roles and their tool lists, its themes/looks, its notification
   and account menus, its bottom bars, and anything that already resembles a dock or skeleton. Write this map into the repo
   (e.g. `docs/AYEKABAR_GLASS_UI.md`, "current state") and show it to the owner with a short plan.
2. **Foundation:** add `glisse@0.5.0` (exact), the shared glass pieces and the token mapping for every look. Nothing visible changes yet.
3. **One screen at a time:** owner home → employee/staff home → other dashboards → inner pages. Each: glass shell, cards to the cheap
   surface, menus to the signature style, a `loading.tsx` skeleton, the dock from the layout. Keep every tool and its order.
4. **Prove it after every screen:** typecheck, the repo's existing tests/regression scripts (fix a failure or report it; never delete or
   weaken a test), and real-browser checks with Playwright: no horizontal scroll at 360 / 768 / 1280 px, iPhone safe-area layout, text
   contrast ≥ 4.5:1 on real pixels in every look, the dock is the same element across tab changes, a long notification list has no
   overlapping rows, a save bar stays at the bottom while scrolling, a revisit is instant and a save is never shown stale. Add these as
   automated tests in the same change.
5. **Document as you go:** `docs/AYEKABAR_GLASS_UI.md` becomes the working guide (rules, pieces, traps), like Sarcafe's. Update the repo's
   `handoff.md` at the end: what changed, files, what was verified (pass/fail), what is left, the exact next step.
6. **Report to the owner** in plain words: what they will see, what was tested and the result, and anything that needs their decision.
   Screenshots of each restyled screen (phone and desktop, a dark and a light look) help them decide.

## 6. Done means
Every AyekaBar dashboard screen is glass with the rules above, nothing lost from the tool lists, all checks green (or every failure named
with its reason), the guide and handoff written, and the work on a branch waiting for the owner's go to merge and deploy.
