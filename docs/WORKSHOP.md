# Coffee workshop (staff training deck)

`public/workshop/sarcafe-coffee-workshop.pptx` is the owner's PowerPoint, "סדנת קפה מקצועית — מדריך לעובדי עגלות הקפה" (12 slides: what coffee is, Arabica vs Robusta, processing, blends, the five golden rules, milk steaming, espresso doses and drinks, tuning the machine, troubleshooting, five rules to remember). Added 2026-10-15; the owner dropped it in the repo root, it now lives in `public/workshop/`.

## Where it shows up

- **A quiet card** (`src/components/workshop/WorkshopCard.tsx`) on the staff home (`/staff`) and on the owner dashboard (`/owner/dashboard`, both the full view and the code-sign-in view): a small picture of slide 1, the name, "מדריך לעובדי עגלות הקפה · 12 שקפים". It sits after the shift card and the alerts and before the tool list, with no badge, glow or motion, so it is easy to find and never competes with a shift or an alert. "Main page" in the request was read as these two home screens (the deck is written for the cart staff); moving it is one line in each page.
- **The viewer** (`/staff/workshop`, `WorkshopViewer.tsx`): one slide at a time, in Hebrew order (next = the left arrow, a swipe to the left, the button on the left), numbered buttons to jump, **מסך מלא (לצפייה לרוחב)** (added 2026-10-15: our own full-window layer over the whole screen, so it works on an iPhone, where Safari has no fullscreen for anything but video; the slide is as big as the screen allows, tap the left third = next, the right third = previous, the middle shows/hides the controls, swipe turns pages, the controls fade after about 3 s, a note asks to turn the phone sideways while it is in portrait, the page behind cannot scroll, Escape or the X leaves; where the browser also has real fullscreen and orientation lock (Android Chrome) both are requested too), **הגדלה** (the slide drawn about twice as wide in a taller window you pan with a finger; while zoomed a drag pans instead of turning the page), and **הורדת המצגת** (the original `.pptx`, 4.7MB). What each slide says is also written out for screen readers. Any signed-in staff identity may open it (a number + code sign-in too: it is training, not personal data); a signed-out visitor is sent to `/login?next=/staff&quick=1`, not to the workshop, because the number + code sign-in only accepts a fixed list of destinations.

## How the slides are made

The slide pictures are NOT stored in the .pptx's own format on the site: `public/workshop/slide-NN.webp` (1600 px, about 700 KB for all twelve) and `cover.webp` are drawn from the deck by `node scripts/build-workshop-slides.mjs [deck.pptx]`:

1. `scripts/workshop/render_deck.py` reads the deck's XML (it is plain shapes, text boxes, pictures and two tables) and writes one HTML page per slide at 1920×1080, 1 pt = 2 px: positions, fills, rounded rectangles, ellipses, shadows, fonts and sizes, RTL paragraphs, tables. The deck is read as data; nothing in it runs.
2. Headless Edge (or `TEST_BROWSER`) photographs each page; `sharp` writes the WebP files.
3. The same run rewrites the slide list in `src/lib/workshop/slides.ts` (title and text of each slide, from the deck).

It needs `python` on the PATH and a Chromium-family browser; it runs on a developer machine, never at deploy. Run it again whenever the deck changes and commit the output. Two known differences from PowerPoint: no PowerPoint or LibreOffice was available when it was built, so the pictures are this renderer's reading of the file, checked slide by slide against the extracted text and structure, not a PowerPoint export (the original download is always one tap away); and a Wingdings symbol (the smiley on slide 12) is mapped to its emoji. Slide 6's title is typed in the deck with its brackets in logical order (`)בלנדים(`), which reads right only inside the slide; the viewer's label is `תערובות (בלנדים)` (`TITLE_OVERRIDES` in the script).

## Limits

- Files under `public/` are served to anyone who has the address, signed in or not. The deck is training material, not private; if that ever changes, serve it through a route that checks the session (as the payslips are).
- The viewer starts at slide 1 every time (no "continue where I left off").
