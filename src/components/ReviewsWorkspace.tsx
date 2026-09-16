'use client'

import { useState } from 'react'
import BranchSwitcher from '@/components/BranchSwitcher'
import BranchReviewsEditor from '@/components/BranchReviewsEditor'
import { normalizeReviews, PLACEHOLDER_BLOCK } from '@/lib/reviews'
import type { Branch, BranchSlug } from '@/lib/branches'

export default function ReviewsWorkspace({ branches, initialBranch }: { branches: Branch[]; initialBranch: BranchSlug }) {
  const [slug, setSlug] = useState<BranchSlug>(initialBranch)
  const branch = branches.find((b) => b.slug === slug) ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {branches.length > 1 && <BranchSwitcher branches={branches} value={slug} onChange={setSlug} />}
      {branch && (
        <BranchReviewsEditor
          key={branch.id}
          branchId={branch.id}
          initial={branch.reviews ? normalizeReviews(branch.reviews, PLACEHOLDER_BLOCK) : { rating: 5, count: 0, items: [] }}
        />
      )}
    </div>
  )
}
