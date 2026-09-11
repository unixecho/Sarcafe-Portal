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
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          transform: on ? 'translateX(16px)' : 'translateX(0)',
          transition: 'transform 0.18s var(--spring)',
        }}
      />
    </span>
  )
}
