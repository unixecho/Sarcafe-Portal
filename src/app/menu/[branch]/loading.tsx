import PublicBackdrop from '@/components/PublicBackdrop'

/**
 * Shown the instant a navigation to the menu commits, while the server
 * fetches the published menu for this branch.
 *
 * It deliberately reuses the REAL menu-* classes rather than drawing its own
 * boxes. The point of a skeleton is that the page does not move when the
 * content lands: if the placeholder's geometry is invented, the swap shifts
 * every row and the transition reads as a jump, which is worse than no
 * skeleton at all. Same sticky header height, same chip rail, same category
 * card metrics — only the contents are grey.
 *
 * It also wraps PublicBackdrop for the same reason: without it the
 * illustrated ground would pop in a frame later than everything else.
 *
 * §4.10's honesty rule applies to the counts — five collapsed category rows
 * is what a real menu looks like at rest, so that is what is promised here.
 * Nothing renders an expanded category, because the real page opens at most
 * one and we do not know which.
 */
export default function MenuLoading() {
  return (
    <PublicBackdrop>
      <div className="menu-sticky">
        <div className="menu-topbar">
          <div className="menu-lang-slot">
            <div className="sk" style={{ width: 38, height: 38, borderRadius: 12 }} />
          </div>
          <div className="menu-brand-wrap">
            <div className="sk" style={{ width: 120, height: 22, borderRadius: 7, margin: '0 auto' }} />
          </div>
          <div className="menu-back">
            <div className="sk" style={{ width: 38, height: 38, borderRadius: 12 }} />
          </div>
        </div>

        <div className="sk" style={{ width: '62%', height: 12, borderRadius: 6, margin: '0 auto 10px' }} />

        <div className="menu-chips-wrap">
          <nav className="menu-chips" aria-hidden="true">
            {[78, 92, 68, 104, 74, 88].map((w, i) => (
              <div key={i} className="sk" style={{ width: w, height: 44, borderRadius: 999, flex: '0 0 auto' }} />
            ))}
          </nav>
        </div>
      </div>

      <main id="main" tabIndex={-1} style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 48, position: 'relative' }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <section className="menu-cat" key={i}>
            <div className="menu-cat-head" style={{ cursor: 'default' }}>
              <span className="menu-cat-icon">
                <div className="sk" style={{ width: 22, height: 22, borderRadius: 6 }} />
              </span>
              <div className="sk" style={{ flex: 1, maxWidth: 140, height: 17, borderRadius: 6 }} />
              <div className="sk" style={{ width: 16, height: 13, borderRadius: 5 }} />
            </div>
          </section>
        ))}
      </main>
    </PublicBackdrop>
  )
}
