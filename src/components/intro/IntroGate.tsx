import Intro from './Intro'
import { getIntroEnabled } from '@/lib/settings/server'
import { DEFAULT_INTRO_ENABLED } from '@/lib/settings/keys'
import { INTRO_GATE_TIMEOUT_MS, withTimeout } from '@/lib/intro/config'

// Decides, on the SERVER, whether the intro exists at all — the owner's switch
// (/owner/intro).
//
// It has to be the server, and in the HTML: the overlay must cover the portal
// from the first frame, so a switch that was read on the client could only ever
// show the overlay and then take it away — a dark flash for exactly the owner who
// turned it off. When the switch is off nothing is rendered: no overlay, no
// stylesheet rules in play, no script work.
//
// This renders on every page (the layout owns it), so two things are deliberate:
//   • The read is the same tagged, cached fetch every other switch uses, and the
//     owner API busts the tag on every flip — a toggle shows on the next load.
//   • It is TIME-BOXED. A decoration must never be the reason a page is slow: if
//     Supabase hangs instead of failing, the intro simply plays (the switch's
//     default — DEFAULT_INTRO_ENABLED explains why it fails open) after
//     INTRO_GATE_TIMEOUT_MS rather than holding every route's render hostage.

export default async function IntroGate() {
  const enabled = await withTimeout(getIntroEnabled(), INTRO_GATE_TIMEOUT_MS, DEFAULT_INTRO_ENABLED)
  return enabled ? <Intro /> : null
}
