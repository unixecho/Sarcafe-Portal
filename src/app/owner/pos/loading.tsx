import OwnerHeaderSkeleton from '@/components/OwnerHeaderSkeleton'
import { HubSkeleton } from '@/components/owner/pos/HubLive'
import '@/components/owner/pos/ops.css'

export default function OwnerPosHubLoading() {
  return (
    <main id="main" tabIndex={-1} className="ops-main">
      <OwnerHeaderSkeleton withBack />
      <HubSkeleton />
    </main>
  )
}
