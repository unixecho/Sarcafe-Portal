'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { orderChannelName, ORDERS_UPDATED_EVENT } from './realtime'

/**
 * Subscribes to this branch's order broadcast channel and calls `onUpdate`
 * whenever any staff member's dispatch changes something — the websocket
 * half of the live order board, same shape as lib/menu/useMenuRealtime.
 * Purely a wake-up signal: `onUpdate` is expected to re-fetch through the
 * caller's own authorized read path, never trust the broadcast payload.
 */
export function useOrdersRealtime(branchSlug: string, onUpdate: () => void) {
  const onUpdateRef = useRef(onUpdate)
  useEffect(() => {
    onUpdateRef.current = onUpdate
  })

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(orderChannelName(branchSlug))
    channel.on('broadcast', { event: ORDERS_UPDATED_EVENT }, () => onUpdateRef.current()).subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [branchSlug])
}
