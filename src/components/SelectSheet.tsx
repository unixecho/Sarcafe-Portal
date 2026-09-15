'use client'

import { useId, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { haptic } from '@/lib/haptics'

/**
 * The iOS option picker — our replacement for a native <select>.
 *
 * Blueprint §5.9: no browser-native dialogs, ever, and that explicitly
 * includes <select>. A native select renders in the OS's own chrome —
 * Latin-first, light, anchored wherever the platform decides — which on a
 * dark RTL app reads as a bug rather than a control. It also cannot be
 * styled to the token system, so it is the one element on a screen that
 * ignores the whole design system.
 *
 * This is deliberately the THIRD member of the ConfirmSheet / PromptSheet
 * family rather than a bespoke dropdown: it is built on SheetShell, so it
 * inherits the real focus trap, focus restore, Escape, scrim-click and
 * scroll lock for free (§5.2) instead of reimplementing them badly.
 *
 * Semantics: the trigger is a plain button carrying the current value and
 * an aria-label, and the panel is a listbox of options. aria-selected marks
 * the current one rather than a visual checkmark alone, because a check
 * glyph is invisible to a screen reader reading the option's name.
 */

export type SelectOption = { value: string; label: string }

type Props = {
  /** Accessible name for the trigger, and the sheet's heading. */
  label: string
  value: string
  options: SelectOption[]
  /** Shown on the trigger, and as the first option, when value is ''. */
  placeholder: string
  onChange: (value: string) => void
  style?: React.CSSProperties
  disabled?: boolean
}

export default function SelectSheet({
  label,
  value,
  options,
  placeholder,
  onChange,
  style,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false)
  const titleId = useId()

  const selected = options.find((o) => o.value === value)
  // '' is a real, selectable value here (it means "no filter" / "all
  // branches"), so it gets its own row rather than being an empty state.
  const rows: SelectOption[] = [{ value: '', label: placeholder }, ...options]

  return (
    <>
      <button
        type="button"
        className="press"
        disabled={disabled}
        onClick={() => setOpen(true)}
        // The trigger is the control, so it carries the name AND the value:
        // a screen reader announces "תפקיד, בריסטה" rather than just the
        // label, which is what a native select does and what a bare
        // aria-label would lose.
        aria-label={`${label}: ${selected ? selected.label : placeholder}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          textAlign: 'start',
          cursor: disabled ? 'default' : 'pointer',
          fontFamily: 'inherit',
          ...style,
        }}
      >
        <span
          style={{
            flex: 1,
            // The placeholder is dimmer than a chosen value — the one visual
            // cue that tells you at a glance whether this field is set.
            color: selected ? 'var(--text)' : 'var(--text-faint)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={16} aria-hidden="true" style={{ color: 'var(--text-faint)', flex: 'none' }} />
      </button>

      <SheetShell open={open} onClose={() => setOpen(false)} labelledBy={titleId}>
        <h2 id={titleId} style={{ margin: '0 0 10px', fontSize: '1.05rem', fontWeight: 700 }}>
          {label}
        </h2>
        <div className="sheet-scroll" role="listbox" aria-labelledby={titleId}>
          {rows.map((o) => {
            const isSelected = o.value === value
            return (
              <button
                key={o.value || '__none__'}
                type="button"
                role="option"
                aria-selected={isSelected}
                className="press"
                onClick={() => {
                  // 'select' (12ms) is the pattern for a choice being
                  // committed — see §5.8's table. haptic() is focus-neutral,
                  // so calling it here cannot disturb SheetShell's restore.
                  haptic('select')
                  onChange(o.value)
                  setOpen(false)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  minHeight: 'var(--tap-min)',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-sm)',
                  // An unselected row's border is the only thing drawing it as
                  // a control, so it takes --line-interactive (WCAG 1.4.11's
                  // 3:1 floor), not the decorative --line. §3.2 pass 3.
                  border: `1px solid ${isSelected ? 'transparent' : 'var(--line-interactive)'}`,
                  // On the warm accent the readable foreground is --bg, never
                  // white — white measures 2.59:1 here, --bg measures 7.35:1.
                  background: isSelected ? 'var(--neon)' : 'var(--bg-elev)',
                  color: isSelected ? 'var(--bg)' : 'var(--text)',
                  fontFamily: 'inherit',
                  fontWeight: isSelected ? 700 : 600,
                  fontSize: '0.95rem',
                  textAlign: 'start',
                  cursor: 'pointer',
                }}
              >
                <span style={{ flex: 1 }}>{o.label}</span>
                {/* Decoration only — aria-selected above is what actually
                    conveys this to assistive tech. */}
                {isSelected && <Check size={16} aria-hidden="true" style={{ flex: 'none' }} />}
              </button>
            )
          })}
        </div>
      </SheetShell>
    </>
  )
}
