'use client'

import { useState } from 'react'
import ShiftsProvider from '@/components/shifts/ShiftsProvider'
import StaffWorkspace from '@/components/shifts/StaffWorkspace'
import type { Branch, BranchSlug } from '@/lib/branches'
import { setCurrentBranchCookie } from '@/lib/branches/current'
import type { ScheduleEntry } from '@/lib/shifts/entry'

export default function StaffScheduleShell({ branches, initialBranch, entry = {} }: { branches: Branch[]; initialBranch: BranchSlug; entry?: ScheduleEntry }) {
  const [branch, setBranch] = useState<BranchSlug>(initialBranch)

  function selectBranch(next: BranchSlug) {
    setCurrentBranchCookie(next)
    setBranch(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {branches.length > 1 && (
        <div className="sch-segment ew-branches" role="group" aria-label="בחירת סניף לצפייה">
          {branches.map((option) => (
            <button key={option.id} type="button" className="press" aria-pressed={branch === option.slug} onClick={() => selectBranch(option.slug)}>
              {option.name.he}
            </button>
          ))}
        </div>
      )}
      {branch && (
        <ShiftsProvider key={branch} branchSlug={branch} initialWeekStart={entry.week}>
          <StaffWorkspace branchName={branches.find((b) => b.slug === branch)?.name.he ?? branch} initialTab={entry.tab} />
        </ShiftsProvider>
      )}
    </div>
  )
}
