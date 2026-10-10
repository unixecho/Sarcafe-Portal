'use client'

import dynamic from 'next/dynamic'
import type { ReactNode } from 'react'

const BranchBackdropScenes = dynamic(() => import('@/components/BranchBackdropScenes'), { ssr: false })

/** Public pages keep the shared illustration until a branch with its own art
 * is selected. The heavier animation runtime is loaded only in that state. */
export default function PublicBackdrop({ children, branchSlug = null }: { children: ReactNode; branchSlug?: string | null }) {
  const hasBranchScenes = branchSlug === 'maor' || branchSlug === 'givat-haviva'
  return (
    <div className={`public-backdrop${hasBranchScenes ? ` public-backdrop--${branchSlug}` : ''}`}>
      {hasBranchScenes ? <BranchBackdropScenes key={branchSlug} branchSlug={branchSlug} /> : null}
      <div className="public-backdrop__content">{children}</div>
    </div>
  )
}
