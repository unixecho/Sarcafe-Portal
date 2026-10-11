'use client'

import dynamic from 'next/dynamic'
import type { ReactNode } from 'react'

const BranchBackdropScenes = dynamic(() => import('@/components/BranchBackdropScenes'), { ssr: false })

/** Every public page sits on generated artwork: the selected branch's own
 * scenes, or, with no branch, a pool of both that moves on at each landing.
 * `hold` keeps plain ground while the caller cannot yet say which of the two it
 * is (the portal is still looking up a saved branch; the menu is loading), so
 * a picture never starts to fade in only to be replaced. */
export default function PublicBackdrop({
  children,
  branchSlug = null,
  hold = false,
}: {
  children: ReactNode
  branchSlug?: string | null
  hold?: boolean
}) {
  const scenes = branchSlug === 'maor' || branchSlug === 'givat-haviva' ? branchSlug : 'portal'
  return (
    <div className="public-backdrop">
      {hold ? null : <BranchBackdropScenes key={scenes} branchSlug={scenes} />}
      <div className="public-backdrop__content">{children}</div>
    </div>
  )
}
