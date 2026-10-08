# Sarcafe intro

**Status, 2026-10-09: shipped to `main`.** The portal's opening screen is live code: a dark screen, the cream badge warming like a café lamp, two lines arriving word by word, then the page. It is Ayeka.Bar's intro (BLUEPRINT §4.15) with Sarcafe's own look. The owner approved the direction on 2026-10-08 and asked for the decisions below. Author: Claude.

## What the owner decided (2026-10-08)

- Line one is **"מוכנים לקפה שכולם רוצים?"** (option A), and the words **change from visit to visit**: ten lines in the same spirit.
- **Ayeka's lengths**: about 5 s for a device's first visit (the welcome), about 3 s on every load after (the short one).
- **Keep both** the string lights and the steam in the welcome.
- **An owner on/off switch** like Ayeka's, at `/owner/intro`.
- **The installed customer app plays it**, on its start page.

## What plays, and when

| | |
|---|---|
| Where | The portal home `/` on every full document load, and `/order` **only inside the installed customer app** (its manifest opens there). Not the menu (a table's QR lands there), not an order being tracked, not the staff, owner, login or POS areas. |
| Welcome (~5 s) | A device's first visit. The lamp warms, ten string-light bulbs catch one after another, steam rises behind the badge, the words are given room. |
| Short (~3 s) | Every load after. Lamp, sheen, rule, words. These numbers are Ayeka's approved ones and the harness pins them. |
| Which line | Line one on a device's first visit, then a random **other** line each visit (never the same twice in a row, none starved). A private window, which cannot remember, gets a random line. |
| Leaving | Tap, any key or scroll skips it at once (the overlay keeps catching taps until it is gone, so a skip never presses the button beneath). Reduced motion keeps the intro and substitutes fades. "Pause animations" in the accessibility widget, a background tab and print skip it. A pure-CSS failsafe removes it at 4 s if script never mounts. |

### The ten lines

Line one is the owner's; the others were written in the same spirit and want the owner's read (strike or reword any). Lines 5 and 6 name pastries, shakes and hot or cold coffee, following the products in the staff checklists. English and Arabic are translations, worth a native read. The words live in `src/lib/intro/copy.ts`.

| # | Hebrew | English |
|---|---|---|
| 1 | מוכנים לקפה **שכולם** רוצים? / בואו לשתות משהו טוב, לנשנש ולהישאר עוד קצת. | Ready for the coffee **everyone** wants? |
| 2 | **הקפה** שלכם כבר מחכה. / בואו, נכין לכם משהו טוב. | Your **coffee** is already waiting. |
| 3 | זמן **להפסקה**? / קפה טוב, אנשים טובים, ובלי למהר. | Time for a **break**? |
| 4 | מי אומר לא **לקפה** טוב? / עצרו לרגע, ואנחנו נדאג לכל השאר. | Who says no to good **coffee**? |
| 5 | מתחשק לכם משהו **מתוק**? / מאפים, שייקים קרים וקפה חם, הכול במקום אחד. | Craving something **sweet**? |
| 6 | איך אתם אוהבים את ה**קפה** שלכם? / חם או קר, חזק או עדין. יש אצלנו את שלכם. | How do you like your **coffee**? |
| 7 | יום **עמוס**? / קפצו לכוס קפה ותמשיכו הלאה עם כוחות מחודשים. | Busy **day**? |
| 8 | פגישה, שיחה, או סתם **רגע** לעצמכם? / יש אצלנו קפה לכל אחד מהם. | A meeting, a chat, or just a **moment** to yourself? |
| 9 | בכל שעה יש זמן **לקפה**. / בואו להצטרף אלינו ולהרגיש בבית. | Any hour is a good hour for **coffee**. |
| 10 | יש מקום **לכולם**. / כל מי שאוהב קפה טוב מוזמן לשבת איתנו. | There's room for **everyone**. |

## The design: dusk at the cart, the lights come on

Mechanics are copied from Ayeka; colours and motifs are not (`SarCafe-PHASE1-PLAN.md` already rules that a bar-neon look on a coffee truck would be a branding mismatch).

| | Ayeka.Bar | Sarcafe |
|---|---|---|
| The thing that lights | neon coin (`logo.svg`) | the cream badge, the disc `LogoMark` draws, with `/sarcafe-logo.png` in it |
| How it lights | neon strikes, drops, catches (opacity reversals) | a lamp dimmer rising: one monotonic ease (also the safest reading of WCAG 2.3.1) |
| Sheen across the face | pale band on a dark coin | amber band, since a pale one is invisible on cream |
| Welcome-only extras | the coin turns in 3D, 7 sparkles | 10 string-light bulbs, 3 steam wisps (from the portal's own illustration) |
| Palette | coral neon, cyan | `--bg` espresso, `--neon`/`--neon-soft` amber, a breath of `--sage` |

Design reference: `docs/intro-preview/` is the review page the owner approved from (a single self-contained file, `sarcafe-intro-preview.html`, with its template, build script and 142-check invariant script, plus `sarcafe-intro-filmstrip.jpg` for sessions without a browser). It shows the three original copy proposals, so it is a design archive; the running intro and its ten lines are the code below. To watch the real thing, use the owner page or `/?intro=first&line=3`.

## Where it lives

| File | Role |
|---|---|
| `src/lib/intro/config.ts` | Pure. Every number, the two timelines, `pickVariant`, `pickLine`, `introEntry`, the switch's normalizer and time-box. |
| `src/lib/intro/copy.ts` | Pure. The ten lines in he/en/ar, `introCopy`, `splitLine`. |
| `src/components/intro/Intro.tsx` | The stage machine, mounted once in the root layout. |
| `src/components/intro/intro.css` | Visuals only; reads every time as `var(--intro-*)`. |
| `src/components/intro/IntroGate.tsx` | Server component: the owner's switch, time-boxed to 1.5 s, fails open. |
| `src/app/layout.tsx` | Mounts `<IntroGate />` after `#a11y-scope`, before the accessibility widget. |
| `src/lib/settings/keys.ts`, `server.ts` | `intro_enabled` (default on) and `getIntroEnabled()`. |
| `src/app/api/owner/intro/route.ts` | Owner-only GET and PATCH; upserts the row with `is_public: true`, busts the settings cache tag. No migration. |
| `src/app/owner/intro/page.tsx`, `src/components/IntroCard.tsx` | The owner's page: the switch, a preview of each version, and every line with a preview link. Tile on the owner dashboard. |
| `src/middleware.ts` | `/owner/intro` is owner-only. |
| `scripts/check-intro.mjs` (`npm run check:intro`) | 430 checks against the real files. |

### The installed customer app

The customer manifest opens at `/order`. The server cannot know the display mode, so it renders the overlay on `/order` with `data-entry="app"`; `intro.css` hides it unless `display-mode: standalone`. A browser tab on `/order` sees nothing (no flash, no hydration mismatch) and the component, finding itself `display: none`, plays nothing. A native WebView shell is not `standalone`: when the native track starts, give the shell an explicit entry (see below).

## Owner's switch

`/owner/intro` (OP only). Saves the moment it is tapped, optimistic with rollback. Only an explicit `false` turns the intro off; a missing row, `null`, `"false"`, `0` or anything odd leaves it on. The change shows on the next load of any page. The previews load the real portal with `?intro=first`, `?intro=repeat` and `?line=N`, which write nothing, so previewing never spends a real first visit.

## Verified (2026-10-09)

- `npm run check:intro`: 430 passed, 0 failed. Typecheck and a production build pass on the commit that shipped.
- Runtime, against a production build of the exact tree and a stand-in settings endpoint (never the real database): see the session notes in `handoff.md` for the per-state results (on, off, missing row, junk value, 500, hang).
- Earlier, in the design preview: frames at fixed milliseconds in the in-app browser and headless Edge at 2x on phone, landscape and desktop in he/en/ar; every line within its budget (welcome 4.93 to 5.29 s of 5.5, short 2.64 to 2.86 s of 3.0); tap-to-skip with zero ghost clicks; the pure-CSS failsafe; reduced motion.

**Not verified:** a real iPhone or Android phone, the installed-app entry on a real installed PWA (the CSS gate is tested, not the install), a screen reader.

## Notes for the native Android and iOS track

- **The standby frame is the contract with the launch screen.** Make the iOS launch screen and the Android 12+ splash the same dark `#150f0c` with the dim cream badge, and the web intro lights up with no visible seam.
- **Cold start is a full document load**, so a WebView shell would play the intro on every launch. It is not `display-mode: standalone`, so the `/order` entry would not fire there: decide which start URL the shell opens, and whether it plays the short version only. This belongs in the Capacitor-versus-React-Native ADR (`chatGPT/MOBILE_APP_ROADMAP.md`).
- **Store icons cannot be made from the raw logo.** `public/sarcafe-logo.png` has hard 1-bit alpha (no anti-aliased edge), carries white and grey checkerboard colours in the pixels under its transparency, and weighs 847 KB. App Store icons must be opaque (no alpha); Android wants adaptive foreground and background layers. Build them from the cream badge.

## Left out on purpose

A greeting by time of day, and a shared-element hand-off from the intro badge to the portal's hero badge.
