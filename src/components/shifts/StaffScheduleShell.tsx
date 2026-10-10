'use client'

import { useState } from 'react'
import ShiftsProvider from '@/components/shifts/ShiftsProvider'
import StaffWorkspace from '@/components/shifts/StaffWorkspace'
import type { Branch, BranchSlug } from '@/lib/branches'
import { setCurrentBranchCookie } from '@/lib/branches/current'

export default function StaffScheduleShell({ branches, initialBranch }: { branches: Branch[]; initialBranch: BranchSlug }) {
  const [branch, setBranch] = useState<BranchSlug>(initialBranch)

  function selectBranch(next: BranchSlug) {
    setCurrentBranchCookie(next)
    setBranch(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {branches.length > 1 && (
        <section className="sch-card" aria-label="בחירת סניף לצפייה" style={{ gap: 10 }}>
          <div>
            <strong>לוחות הסניפים</strong>
            <p className="sch-sub">בחרו סניף כדי לראות את הלוח שפורסם ואת המשמרות הפתוחות לבקשות.</p>
          </div>
          <div className="sch-row" role="group" aria-label="סניף" style={{ flexWrap: 'wrap' }}>
            {branches.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`sch-btn press${branch === option.slug ? ' sch-btn--primary' : ''}`}
                style={{ flex: '1 1 180px' }}
                aria-pressed={branch === option.slug}
                onClick={() => selectBranch(option.slug)}
              >
                {option.name.he}
              </button>
            ))}
          </div>
        </section>
      )}
      {branch && (
        <ShiftsProvider key={branch} branchSlug={branch}>
          <StaffWorkspace />
        </ShiftsProvider>
      )}
    </div>
  )
}
