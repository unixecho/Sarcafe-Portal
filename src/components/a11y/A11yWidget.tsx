import A11yProvider from './A11yProvider'
import A11yLauncher from './A11yLauncher'
import ReadingGuide from './ReadingGuide'

// The CSS for every a11y-* class lives in app/globals.css, not a separate
// stylesheet — this codebase has no per-component CSS files anywhere
// (MenuView, ReviewWall, the cart, all of it lives in the one globals.css),
// so this follows that same convention rather than introducing a new one.

/** The one import layout.tsx needs. Mount as a SIBLING of #a11y-scope, not
 * inside it — see A11yLauncher's own comment on why its fixed button must
 * stay outside the scope's filters. */
export default function A11yWidget() {
  return (
    <A11yProvider>
      <A11yLauncher />
      <ReadingGuide />
    </A11yProvider>
  )
}
