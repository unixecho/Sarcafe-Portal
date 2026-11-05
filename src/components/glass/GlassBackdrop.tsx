'use client'

import type { CSSProperties } from 'react'
import { useGlassBranch } from './BranchContext'

// The branch's illustrated backdrop under a veil made from the person's look. Follows the top bar's branch switch.
const BACKDROPS = new Set(['givat-haviva', 'maor'])
export function backdropFor(slug: string | null | undefined): { portrait: string; wide: string } {
  const s = slug && BACKDROPS.has(slug) ? slug : 'givat-haviva'
  return { portrait: `/backdrops/${s}-1-portrait.webp`, wide: `/backdrops/${s}-1-wide.webp` }
}

export default function GlassBackdrop({ slug }: { slug?: string | null }) {
  const shared = useGlassBranch()
  const photo = backdropFor(shared?.slug ?? slug)
  const style = { '--gl-photo': `url(${photo.portrait})`, '--gl-photo-wide': `url(${photo.wide})` } as CSSProperties
  return <div className="gl-bg" aria-hidden="true" style={style} />
}
