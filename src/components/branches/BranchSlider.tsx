'use client'

import Link from 'next/link'
import { LayoutGrid, MapPin, Plus } from 'lucide-react'
import type { TruckLite } from '@/lib/branches/manager'
import './branches.css'

// The slider at the top of the branch manager: one pill per coffee truck, side by side, so the owner moves between branches with
// a thumb and stays on the same tab ("checklists" of one branch -> "checklists" of the next). Events are NOT here: the POS is a
// subsystem of each branch and lives inside it (the "קופה ואירועים" tab). The first pill is the overview of all branches; the
// last one adds a branch.
export default function BranchSlider({ trucks, current, tab, onAdd }: { trucks: readonly TruckLite[]; current?: string; tab?: string; onAdd?: () => void }) {
  const query = tab && tab !== 'overview' ? `?tab=${encodeURIComponent(tab)}` : ''
  return (
    <nav className="bm-slider" aria-label="בחירת סניף">
      <Link href="/owner/branches" className="bm-slide press" aria-current={current === undefined ? 'page' : undefined}><LayoutGrid size={16} aria-hidden="true" />כל הסניפים</Link>
      {trucks.map((truck) => (
        <Link key={truck.slug} href={`/owner/branches/${truck.slug}${query}`} className="bm-slide press" aria-current={current === truck.slug ? 'page' : undefined}><MapPin size={16} aria-hidden="true" />{truck.name}</Link>
      ))}
      {onAdd && <button type="button" className="bm-slide bm-slide--add press" onClick={onAdd}><Plus size={16} aria-hidden="true" />סניף חדש</button>}
    </nav>
  )
}
