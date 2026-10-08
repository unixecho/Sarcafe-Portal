'use client'

// "I am working this station" toggle.
//
// TRI-STATE on purpose: `null` = not known yet. Starting from `false` would flash "check in"
// at someone who is already checked in until the read lands, and a tap in that window would
// send the wrong event. While unknown the pill is a quiet, disabled placeholder that says why.
//
// If the read FAILS we fall back to "not checked in" (fail open): the person can still act, the
// server accepts either event, and presence is information for the manager, not a permission.
// Taps are optimistic with a rollback; this is a tiny direct read of one table (the only one
// the station makes itself, besides the timeline) re-run on the shared refresh signal.

import { useCallback, useEffect, useRef, useState } from 'react'
import { LogIn, UserCheck } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { createClient } from '@/lib/supabase/client'
import { readPos } from '@/lib/pos/read-client'
import { posApi } from '@/lib/pos/client'
import { CHECKIN_COLUMNS } from '@/lib/pos/columns'
import { useT } from '@/lib/pos/useT'
import type { PosCheckin } from '@/lib/pos/types'
import { usePos, useRefreshKey } from '../PosProvider'
import { errorText } from '../shell/errorText'
import { usePosToast } from '../shell/Toast'

export default function CheckinPill({ pointId }: { pointId: string }) {
  const t = useT()
  const { me, branchId, session } = usePos()
  const key = useRefreshKey()
  const { toast } = usePosToast()
  const [state, setState] = useState<boolean | null>(null)
  const pending = useRef(false)
  const sessionId = session?.id ?? null

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let result: { data: unknown; error: unknown }
      if (me.codeOnly) {
        result = await readPos<PosCheckin[]>({ kind: 'checkin', branch: branchId, point: pointId, session: sessionId ?? undefined })
      } else {
        let q = createClient().from('pos_point_checkins').select(CHECKIN_COLUMNS).eq('point_id', pointId).eq('staff_id', me.id).order('at', { ascending: false }).limit(1)
        if (sessionId) q = q.eq('session_id', sessionId)
        result = await q
      }
      const { data, error } = result
      if (cancelled || pending.current) return
      if (error) {
        setState((prev) => (prev === null ? false : prev))
        return
      }
      const last = (data as unknown as PosCheckin[] | null)?.[0]
      setState(last ? last.event === 'check_in' : false)
    })()
    return () => {
      cancelled = true
    }
  }, [pointId, me.id, sessionId, key, me.codeOnly, branchId])

  const toggle = useCallback(async () => {
    if (state === null || pending.current) return
    const prev = state
    const next = !prev
    pending.current = true
    haptic('select')
    setState(next)
    const r = await posApi.checkin({ pointId, event: next ? 'check_in' : 'check_out' })
    pending.current = false
    if (!r.ok) {
      setState(prev)
      toast(errorText(t, r.code), { tone: 'error' })
    }
  }, [state, pointId, toast, t])

  if (state === null) {
    return (
      <span className="sth-checkin sth-checkin--unknown" aria-disabled="true" role="status">
        {t('station.checkin.loading')}
      </span>
    )
  }

  return (
    <button
      type="button"
      className={`sth-checkin press${state ? ' is-in' : ''}`}
      aria-label={state ? t('station.checkin.leaveLabel') : t('station.checkin.joinLabel')}
      onClick={() => void toggle()}
    >
      {state ? <UserCheck size={20} aria-hidden="true" /> : <LogIn size={20} aria-hidden="true" />}
      <span>{state ? t('station.checkin.in') : t('station.checkin.out')}</span>
    </button>
  )
}
