'use client'

import { useState } from 'react'
import BranchSwitcher from '@/components/BranchSwitcher'
import ShiftsProvider from '@/components/shifts/ShiftsProvider'
import ScheduleWorkspace from '@/components/shifts/ScheduleWorkspace'
import type { Branch, BranchSlug } from '@/lib/branches'
import type { ScheduleEntry } from '@/lib/shifts/entry'

export default function ScheduleWorkspaceShell({ branches, initialBranch, entry = {} }: { branches: Branch[]; initialBranch: BranchSlug; entry?: ScheduleEntry }) {
  const [branch, setBranch] = useState<BranchSlug>(initialBranch)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {branches.length > 1 && <BranchSwitcher branches={branches} value={branch} onChange={setBranch} />}
      {branch && (
        <ShiftsProvider key={branch} branchSlug={branch} initialWeekStart={entry.week}>
          <ScheduleWorkspace branchName={branches.find((b) => b.slug === branch)?.name.he ?? branch} shareBranches={branches.map((b) => ({ slug: b.slug, name: b.name.he }))} initialTab={entry.tab} />
        </ShiftsProvider>
      )}
    </div>
  )
}
