'use client'

import { useState } from 'react'
import BranchSwitcher from '@/components/BranchSwitcher'
import IssueReport from '@/components/checklists/IssueReport'
import type { Branch, BranchSlug } from '@/lib/branches'
import './checklists.css'

export default function OwnerIssuesWorkspace({ branches, initialBranch }: { branches: Branch[]; initialBranch: BranchSlug }) {
  const [branch, setBranch] = useState<BranchSlug>(initialBranch)
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className="ck-wrap">
      <BranchSwitcher branches={branches} value={branch} onChange={setBranch} />
      <section className="ck-hero">
        <p className="sch-sub" style={{ margin: 0 }}>מה חסר, מה לא עובד ומה לא הוגש</p>
        <h1 style={{ margin: '4px 0' }}>חוסרים ופערים{open ? ` (${open})` : ''}</h1>
      </section>
      <IssueReport branch={branch} onCount={setOpen} />
    </div>
  )
}
