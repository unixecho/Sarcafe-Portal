# Sarcafe kiosk: Hebrew, English, Arabic

The kiosk speaks Hebrew, English and Arabic. Hebrew is the default and every visit starts in it.

## What the visitor sees

- A switch, **עברית · English · العربية**, at the top of every screen: on the welcome photo next to the branch name, and
  in the header on every other screen. Each language is written in itself. One tap changes the whole kiosk at once,
  including the direction: Hebrew and Arabic read right to left, English left to right.
- Everything follows the language:
  - every screen and the announcements;
  - the menu, with its categories, items, notes, types, "sold out" and badges;
  - the keypad, the error messages and the privacy-reset warning;
  - the success and error screens;
  - the privacy notice, the terms and both consent boxes.
- Switching in the middle of the form keeps everything typed and the screen it is on.
- **Hebrew comes back by itself:** at every privacy reset (the 60 s timeout, the home button, "סיום ואיפוס") and after a
  finished sign-up's confirmation. A language picked on the welcome screen by someone who then walked away also reverts,
  after the same idle time as a visit (60 s by default).
- **Staff can change this tablet's languages** in the control panel's "שפות" tab (`docs/SARCAFE_KIOSK_ADMIN_PANEL.md`): which of
  the three are offered, which one is the default (the kiosk starts in it and "comes back by itself" means back to it, not always
  Hebrew), and whether the switch shows at all. A new default or a language that was switched off is taken at once when nobody is
  using the kiosk. With one language the switch disappears.
- Arabic uses Rubik's Arabic subset, bundled like the Hebrew and Latin ones (`fonts/rubik-arabic.woff2`, SIL OFL), so
  it looks the same offline.

## Where the words come from

| What | Source |
|---|---|
| Fixed words on every screen | `overrides/kiosk-i18n.js` (`T.he / T.en / T.ar`) |
| Menu names, notes, types | the server: `/api/kiosk/menu` now sends each item's and category's English and Arabic (`tr`), taken from the names the owner keeps in the menu editor (`Localized.en/ar`). A kiosk without them, or the menu shipped in the app, falls back to `overrides/kiosk-menu-i18n.js`, and a word in neither stays in Hebrew. |
| Announcements | the built-in ones and the dashboard's starting ones are translated in `kiosk-i18n.js` (`ANNOUNCEMENTS`). Text the owner writes in the dashboard stays exactly as written. There is no English/Arabic field for announcements yet. |
| Opening hours | day names and "today / closed" follow the language. A closure note the owner wrote stays as written. |
| Legal texts | `overrides/kiosk-legal.js`, one full text per language with its own version ids (see `SARCAFE_KIOSK_LEGAL_NOTES.md` §4). |

To change a word, edit it in all three languages. `npm run check:kiosk-i18n` fails when:

- a key is missing in a language;
- Hebrew is left in the English or Arabic words;
- a word of the shipped menu has no translation.

## Checks

- `npm run check:kiosk-i18n`: about 230 checks. It runs every screen in English and Arabic, portrait and landscape, on the packaged page, and checks that:
  - no Hebrew is visible (only the owner's legal name is allowed);
  - nothing overflows sideways and no button clips its words;
  - the menu and the badges are translated;
  - the sign-up sends the ids of the language on screen;
  - the messages, the warning and the success screen are in the language;
  - the reset, the timeout, the home button and an abandoned welcome screen bring back Hebrew;
  - switching mid-form keeps the data;
  - server translations take priority over the built-in ones.

  `KIOSK_SHOTS=<dir>` saves a screenshot of each screen.
- `npm run check:kiosk-session` (Hebrew flow, unchanged), `check:kiosk-menu` (the `tr` projection), `check:kiosk-waitlist` (per-language ids).

## Shipping a change

This is a kiosk page change, so it reaches the tablet by the normal over-the-air path (`SARCAFE_KIOSK_OTA.md`). Push to
`main`, then sign on the owner's PC:

```
git pull
node scripts/sign-kiosk-ota.mjs
git add public/kiosk-ota/web-signature.json
git commit -m "kiosk OTA: sign web bundle"
git push
```

The tablet checks for updates 20 s after start, then every 10 minutes while the screen is on, and whenever the network comes back.
It then switches at an idle moment. **Check for updates now** in the staff menu forces a check. Without the signature the tablet
ignores the new page and keeps the one it has.
