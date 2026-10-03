'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { menuChannelName, MENU_UPDATED_EVENT } from './realtime'

/**
 * Subscribes to this branch's menu broadcast channel and calls `onUpdate`
 * whenever the owner changes something (via the tablet or the desktop
 * editor) — the websocket half of "menu needs to update thru websockets so
 * users don't have to refresh." Purely a wake-up signal: `onUpdate` is
 * expected to re-fetch through the caller's own existing, already-authorized
 * data path — never trust the broadcast payload itself.
 */
export function useMenuRealtime(branchSlug: string, onUpdate: () => void) {
  const onUpdateRef = useRef(onUpdate)
  useEffect(() => {
    onUpdateRef.current = onUpdate
  })

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(menuChannelName(branchSlug))
    channel.on('broadcast', { event: MENU_UPDATED_EVENT }, () => onUpdateRef.current()).subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [branchSlug])
}
