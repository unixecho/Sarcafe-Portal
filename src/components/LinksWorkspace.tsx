'use client'

import { useState } from 'react'
import BranchSwitcher from '@/components/BranchSwitcher'
import BranchLinksEditor from '@/components/BranchLinksEditor'
import type { Branch, BranchSlug } from '@/lib/branches'

export default function LinksWorkspace({ branches, initialBranch }: { branches: Branch[]; initialBranch: BranchSlug }) {
  const [slug, setSlug] = useState<BranchSlug>(initialBranch)
  const branch = branches.find((b) => b.slug === slug) ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {branches.length > 1 && <BranchSwitcher branches={branches} value={slug} onChange={setSlug} />}
      {branch && <BranchLinksEditor key={branch.id} branchId={branch.id} initialLinks={branch.links} />}
    </div>
  )
}
