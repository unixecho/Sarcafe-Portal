'use client'

import { useId, type CSSProperties } from 'react'
import SheetShell from '@/components/SheetShell'
import Switch from '@/components/Switch'
import { at, type A11yUiKey } from '@/lib/a11y/i18n'
import { useA11y } from './A11yProvider'
import type { Lang } from '@/lib/menu/types'
import type { Contrast, FontScale, Spacing } from '@/lib/a11y/types'

const FONT_SCALE_LABELS = ['100%', '110%', '125%', '140%', '150%']
const CONTRAST_OPTIONS: { value: Contrast; key: A11yUiKey }[] = [
  { value: 'default', key: 'contrastDefault' },
  { value: 'high', key: 'contrastHigh' },
  { value: 'grayscale', key: 'contrastGrayscale' },
  { value: 'invert', key: 'contrastInvert' },
]

export default function A11yPanel({ open, onClose, lang }: { open: boolean; onClose: () => void; lang: Lang }) {
  const { prefs, setPrefs, reset } = useA11y()
  const titleId = useId()

  return (
    <SheetShell open={open} onClose={onClose} labelledBy={titleId}>
      <h2 id={titleId} style={{ margin: '0 0 14px', fontSize: '1.05rem', fontWeight: 800 }}>
        {at('panelTitle', lang)}
      </h2>
      <div className="sheet-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <section>
          <p style={sectionLabelStyle}>{at('fontScale', lang)}</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([0, 1, 2, 3, 4] as FontScale[]).map((step) => (
              <button
                key={step}
                type="button"
                className="press"
                aria-pressed={prefs.fontScale === step}
                onClick={() => setPrefs({ fontScale: step })}
                style={chipStyle(prefs.fontScale === step)}
              >
                {FONT_SCALE_LABELS[step]}
              </button>
            ))}
          </div>
        </section>

        <section>
          <p style={sectionLabelStyle}>{at('spacing', lang)}</p>
          <div style={{ display: 'flex', gap: 6 }}>
            {([0, 1, 2, 3] as Spacing[]).map((step) => (
              <button
                key={step}
                type="button"
                className="press"
                aria-pressed={prefs.spacing === step}
                onClick={() => setPrefs({ spacing: step })}
                style={{ ...chipStyle(prefs.spacing === step), minWidth: 40 }}
              >
                {step === 0 ? '—' : '+'.repeat(step)}
              </button>
            ))}
          </div>
        </section>

        <section>
          <p style={sectionLabelStyle}>{at('contrast', lang)}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {CONTRAST_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className="press"
                aria-pressed={prefs.contrast === opt.value}
                onClick={() => setPrefs({ contrast: opt.value })}
                style={{ ...chipStyle(prefs.contrast === opt.value), width: '100%', textAlign: 'start' }}
              >
                {at(opt.key, lang)}
              </button>
            ))}
          </div>
        </section>

        <ToggleRow label={at('pauseAnimations', lang)} on={prefs.pauseAnimations} onToggle={(v) => setPrefs({ pauseAnimations: v })} />
        <ToggleRow label={at('readingGuide', lang)} on={prefs.readingGuide} onToggle={(v) => setPrefs({ readingGuide: v })} />
        <ToggleRow label={at('highlightLinks', lang)} on={prefs.highlightLinks} onToggle={(v) => setPrefs({ highlightLinks: v })} />
        <ToggleRow label={at('highlightHeadings', lang)} on={prefs.highlightHeadings} onToggle={(v) => setPrefs({ highlightHeadings: v })} />
        <ToggleRow label={at('bigCursor', lang)} on={prefs.bigCursor} onToggle={(v) => setPrefs({ bigCursor: v })} />

        <button type="button" className="press" onClick={reset} style={resetBtnStyle}>
          {at('reset', lang)}
        </button>

        <a href="/accessibility" className="press" style={statementLinkStyle}>
          {at('statement', lang)}
        </a>
      </div>
    </SheetShell>
  )
}

function ToggleRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ fontSize: '0.88rem' }}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className="press"
        onClick={() => onToggle(!on)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        <Switch on={on} />
      </button>
    </div>
  )
}

const sectionLabelStyle: CSSProperties = { margin: '0 0 8px', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-dim)' }

function chipStyle(active: boolean): CSSProperties {
  return {
    minHeight: 40,
    padding: '0 14px',
    borderRadius: 999,
    border: `1px solid ${active ? 'var(--neon)' : 'var(--line-interactive)'}`,
    background: active ? 'var(--neon)' : 'var(--bg-elev)',
    color: active ? 'var(--bg)' : 'var(--text)',
    fontWeight: 600,
    fontSize: '0.85rem',
    cursor: 'pointer',
  }
}

const resetBtnStyle: CSSProperties = {
  minHeight: 'var(--tap-min)',
  borderRadius: 999,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  fontWeight: 600,
  fontSize: '0.88rem',
  cursor: 'pointer',
}

const statementLinkStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  borderRadius: 999,
  border: 'none',
  background: 'none',
  color: 'var(--neon-2)',
  fontWeight: 600,
  fontSize: '0.85rem',
  textDecoration: 'none',
  cursor: 'pointer',
}
