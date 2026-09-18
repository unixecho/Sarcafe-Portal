'use client'

import { useState } from 'react'
import BranchSwitcher from '@/components/BranchSwitcher'
import TabletAvailability from '@/components/TabletAvailability'
import type { Branch, BranchSlug } from '@/lib/branches'

export default function TabletWorkspace({
  branches,
  initialBranch,
  isOwner,
}: {
  branches: Branch[]
  initialBranch: BranchSlug
  isOwner: boolean
}) {
  const [branch, setBranch] = useState<BranchSlug>(initialBranch)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {branches.length > 1 && <BranchSwitcher branches={branches} value={branch} onChange={setBranch} />}
      {branch && <TabletAvailability key={branch} branchSlug={branch} isOwner={isOwner} />}
    </div>
  )
}
