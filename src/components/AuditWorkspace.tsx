'use client'

import { useState } from 'react'
import BranchSwitcher from '@/components/BranchSwitcher'
import AuditTrail from '@/components/AuditTrail'
import type { Branch, BranchSlug } from '@/lib/branches'

export default function AuditWorkspace({ branches, initialBranch }: { branches: Branch[]; initialBranch: BranchSlug }) {
  const [branch, setBranch] = useState<BranchSlug>(initialBranch)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {branches.length > 1 && <BranchSwitcher branches={branches} value={branch} onChange={setBranch} />}
      {branch && <AuditTrail branch={branch} />}
    </div>
  )
}
