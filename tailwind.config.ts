import type { Config } from 'tailwindcss'

// Tailwind is used sparingly here (utility layout/spacing), on purpose.
// Colors, radii, shadows, and motion all come from the CSS custom
// properties in src/app/globals.css (the design-token system ported from
// AyekaBar), not from this config, so there is exactly one source of truth
// for the palette instead of two competing ones.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        'bg-elev': 'var(--bg-elev)',
        'bg-elev-2': 'var(--bg-elev-2)',
        neon: 'var(--neon)',
        'neon-soft': 'var(--neon-soft)',
        'neon-2': 'var(--neon-2)',
        text: 'var(--text)',
        'text-dim': 'var(--text-dim)',
        'text-faint': 'var(--text-faint)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
    },
  },
  plugins: [],
}

export default config
