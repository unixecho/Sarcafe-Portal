'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { orderStatusChannelName, ORDER_STATUS_UPDATED_EVENT } from './realtime'

/**
 * The customer-facing counterpart to useOrdersRealtime — subscribes to
 * ONE order's own channel (never the branch-wide staff channel) so a
 * customer's tracking page updates the instant staff advance or cancel
 * it, without needing any authenticated session. Same wake-up-only
 * contract: `onUpdate` re-fetches through /api/order/[token].
 */
export function useOrderStatusRealtime(orderId: string | null, onUpdate: () => void) {
  const onUpdateRef = useRef(onUpdate)
  useEffect(() => {
    onUpdateRef.current = onUpdate
  })

  useEffect(() => {
    if (!orderId) return
    const supabase = createClient()
    const channel = supabase.channel(orderStatusChannelName(orderId))
    channel.on('broadcast', { event: ORDER_STATUS_UPDATED_EVENT }, () => onUpdateRef.current()).subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [orderId])
}
