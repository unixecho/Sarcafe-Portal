// Purely presentational and aria-hidden — the CALLER owns the actual
// <button role="switch" aria-checked> semantics and click handling; this
// only renders the visual knob. Ported pattern from AyekaBar.
export default function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        width: 42,
        height: 26,
        borderRadius: 999,
        padding: 3,
        background: on ? 'var(--neon)' : 'var(--bg-elev-2)',
        border: `1px solid ${on ? 'var(--neon)' : 'var(--line-interactive)'}`,
        transition: 'background 0.18s var(--ease), border-color 0.18s var(--ease)',
        boxSizing: 'border-box',
        // Forced regardless of the page's `dir` — the knob's travel below is
        // a physical translateX, not a logical one. Under `dir="rtl"` (the
        // whole app), an unset direction here makes the single flex child's
        // rest position flex-start = the RIGHT edge, so the "on" translateX
        // (+16px) shoves an already flush-right knob another 16px past the
        // track's own edge instead of sliding it across — a knob visibly
        // hanging half outside the pill. Pinning ltr makes rest position
        // flex-start = LEFT in every direction context, so translateX(0)/
        // translateX(16) always land at the track's two physical ends.
        direction: 'ltr',
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          // WCAG 1.4.11 wants 3:1 on the knob's own edge. Plain #fff on the
          // on-state track (--neon #ff7a45) measures 2.59:1 — the knob melts
          // into the track for low-vision users exactly when it matters, in
          // the ON state. A 2px ring in --bg measures 7.35:1 against --neon
          // and ~19:1 against the white fill, so the edge holds either way.
          // (Blueprint §5.4 quotes ~8.5:1 for this ring — that is Ayeka's
          // #ff5e3a on #0a0a0f. Sarcafe's palette measures 7.35:1. Both
          // clear the floor; the number here is the one for THIS palette.)
          // Deliberately a hard border and NOT a blur shadow: a soft shadow
          // has no single edge colour to measure against and its falloff
          // renders differently per engine, so it cannot be relied on.
          // (In the OFF state the ring is near-invisible against --bg-elev-2
          // by design — there the white fill, 15.8:1 on that track, plus the
          // --line-interactive track border carry 1.4.11. Do not "fix" that
          // by making the ring colour state-dependent.)
          border: '2px solid var(--bg)',
          // Restating the global `* { box-sizing: border-box }` the way the
          // track above already does, because the ring now depends on it:
          // border-box keeps the 2px border INSIDE the 18px box, so the knob
          // still renders 18x18 and the travel below is untouched. Under
          // content-box it would render 22x22, overflow the track's 34px
          // content box (42 - 2x1 border - 2x3 padding) and overshoot on the
          // on-position. The 16px transform is 34 - 18, so it stays exact.
          boxSizing: 'border-box',
          transform: on ? 'translateX(16px)' : 'translateX(0)',
          transition: 'transform 0.18s var(--spring)',
        }}
      />
    </span>
  )
}
