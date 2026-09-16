'use client'

import { useState } from 'react'
import BranchSwitcher from '@/components/BranchSwitcher'
import ShiftsProvider from '@/components/shifts/ShiftsProvider'
import StaffWorkspace from '@/components/shifts/StaffWorkspace'
import type { Branch, BranchSlug } from '@/lib/branches'

export default function StaffScheduleShell({ branches, initialBranch }: { branches: Branch[]; initialBranch: BranchSlug }) {
  const [branch, setBranch] = useState<BranchSlug>(initialBranch)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {branches.length > 1 && <BranchSwitcher branches={branches} value={branch} onChange={setBranch} />}
      {branch && (
        <ShiftsProvider key={branch} branchSlug={branch}>
          <StaffWorkspace />
        </ShiftsProvider>
      )}
    </div>
  )
}
