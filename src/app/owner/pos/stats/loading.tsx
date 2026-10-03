import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'
import { StatsSkeleton } from '@/components/owner/pos/StatsView'
import '@/components/owner/pos/ops.css'

export default function OwnerPosStatsLoading() {
  return (
    <main id="main" tabIndex={-1} className="ops-main">
      <OwnerHeaderSkeleton withBack />
      <StatsSkeleton />
    </main>
  )
}
