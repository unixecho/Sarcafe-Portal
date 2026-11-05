'use client'

import type { CSSProperties, ReactNode } from 'react'
import { SegmentedControl } from 'glisse'

// The segmented control for a right-to-left page. glisse places its thumb with physical left/right, so the control sits in an
// LTR box with the items reversed: it then reads right to left (first item on the right). glisse sizes each segment with
// --lg-tab-width (84px) and moves the thumb by exactly that width, so `fill` sets that variable to share the row (container
// query units) instead of stretching the box, which would leave the thumb off its segment (docs/SARCAFE_GLASS_UI.md).
export type SegItem = { value: string; label: ReactNode }

export default function Seg({ label, items, value, onChange, fill = false, className }: { label: string; items: SegItem[]; value: string; onChange: (value: string) => void; fill?: boolean; className?: string }) {
  const style = fill ? ({ '--lg-tab-width': `calc(100cqw / ${items.length})` } as CSSProperties) : undefined
  return (
    <div dir="ltr" className={`gl-seg${fill ? ' gl-seg--fill' : ''}${className ? ` ${className}` : ''}`}>
      <SegmentedControl aria-label={label} items={[...items].reverse()} value={value} onValueChange={onChange} style={style} />
    </div>
  )
}
