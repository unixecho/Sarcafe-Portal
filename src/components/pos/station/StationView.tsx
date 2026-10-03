'use client'

// ============================================================================
// StationView - the selling-point (receiver / preparation) screen.
//
// THE GOVERNING RULE (blueprint 1a): the person here never thinks about how the POS is built.
// What is on my screen -> accept -> ready -> hand over. Routing, ids and states are invisible.
//
// DATA: the shared live store (useLive) - this screen never runs its own orders query. For THIS
// point it turns the order lines into CARDS, one per order, in a STABLE order (oldest order first,
// keyed by order id, never re-sorted by a status change or a refetch). Realtime synchronises
// STATE; it must not create visual churn ("whack-a-mole" was Ayeka's unsolved bug). So:
//   * a card animates in ONLY if it arrived after this screen opened (refs below remember what
//     has been seen; the first load animates nothing and chimes nothing);
//   * taps are optimistic (the store paints at once and rolls back with a plain-language toast);
//   * a finished card lingers as a slim chip, then leaves for the Done tray - it does not vanish.
//
// REFS MUTATED DURING RENDER (seen ids, fresh ids, linger deadlines): deliberate and idempotent.
// They answer "is this the first time I have seen this id?", which an effect cannot answer in
// time (the card must already carry its entrance class on the render that mounts it). Running a
// render twice yields the same result, so StrictMode and discarded renders are harmless.
//
// TWO GESTURES, never confused with a tap or a scroll (lib/pos/gestures.ts holds the numbers):
//   * a deliberate left swipe on the BACKGROUND asks "go to the timeline?" - cards and controls
//     can never start it;
//   * hold a card (350 ms) and drag toward the PHYSICAL left edge: the Done tray slides in and
//     dropping a finished card files it. A card still in progress is refused with a shake.
// Both have a plain button twin (the header's timeline button, the tray's edge tab), because a
// gesture nobody discovers - or that a keyboard cannot do - is not a feature.
// ============================================================================

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { flushSync } from 'react-dom'
import { AlertTriangle, History, Volume2, VolumeX } from 'lucide-react'
import ConfirmSheet from '@/components/ConfirmSheet'
import ModalPortal from '@/components/ModalPortal'
import { haptic } from '@/lib/haptics'
import { runLocalTransition } from '@/lib/nav/viewTransition'
import { resolveCategoryIcon } from '@/lib/menu/icons'
import { chime, setSoundEnabled, unlockAudio, useSoundEnabled } from '@/lib/pos/alerts'
import { overdueCount } from '@/lib/pos/aging'
import { ticketLabel } from '@/lib/pos/format'
import { classifyDrag, classifySwipe } from '@/lib/pos/gestures'
import { cardAction, lineAction } from '@/lib/pos/lifecycle'
import { AGING, STATION } from '@/lib/pos/vocab'
import { usePosLang, useT } from '@/lib/pos/useT'
import type { PosItem } from '@/lib/pos/types'
import { usePos } from '../PosProvider'
import { usePosNav } from '../PosNav'
import { useLive, useLiveActions, type LiveStatus } from '../live/LiveStore'
import { HandleChip } from '../shell/HandleChip'
import { safeColour } from '../shell/safeColour'
import { SkTicketCard } from '../shell/Skeletons'
import { usePosToast } from '../shell/Toast'
import CheckinPill from './CheckinPill'
import { type OtherPoint } from './CrossStationNote'
import { DoneChip, DoneTray, trayRight } from './DoneTray'
import GhostRow from './GhostRow'
import OrderCard, { type StationCard } from './OrderCard'
import OverdueStrip from './OverdueStrip'
import './station.css'

// ---- pure derivation -------------------------------------------------------------------------

const isLive = (s: PosItem['status']) => s === 'sent' || s === 'preparing' || s === 'ready'
const bySeq = (a: PosItem, b: PosItem) => a.batch_no - b.batch_no || a.seq - b.seq

type GhostGroup = { order: StationCard['order']; ghosts: PosItem[] }

/** One card per order that has lines at this point. Order is by when the ORDER was created - a fact
 *  that never changes - so no status change can ever move a card. */
function buildCards(
  orders: readonly { id: string; ticket_no: number; customer_name: string; created_by: string; created_by_handle: string; created_at: string; items: PosItem[] }[],
  pointId: string,
  pointName: (id: string, fallback: string) => string,
  dismissed: ReadonlySet<string>,
  ghostCutoffMs: number,
): { cards: StationCard[]; ghostGroups: GhostGroup[] } {
  const cards: StationCard[] = []
  const ghostGroups: GhostGroup[] = []
  const sorted = [...orders].sort(
    (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) || a.ticket_no - b.ticket_no,
  )
  for (const o of sorted) {
    const here = o.items.filter((i) => i.point_id === pointId)
    if (here.length === 0) continue
    const live = here.filter((i) => isLive(i.status)).sort(bySeq)
    const delivered = here.filter((i) => i.status === 'delivered').sort(bySeq)
    const ghosts = here
      .filter(
        (i) =>
          i.status === 'voided' &&
          i.voided_from != null &&
          !dismissed.has(i.id) &&
          (i.voided_at ? Date.parse(i.voided_at) > ghostCutoffMs : false),
      )
      .sort(bySeq)
    const order = {
      id: o.id,
      ticket_no: o.ticket_no,
      customer_name: o.customer_name,
      created_by: o.created_by,
      created_by_handle: o.created_by_handle,
      created_at: o.created_at,
    }
    if (ghosts.length) ghostGroups.push({ order, ghosts })
    const lines = [...live, ...delivered].sort(bySeq)
    if (lines.length === 0) continue

    const other = new Map<string, OtherPoint>()
    for (const i of o.items) {
      if (i.point_id === pointId || i.status === 'voided') continue
      const e = other.get(i.point_id) ?? {
        pointId: i.point_id,
        name: pointName(i.point_id, i.point_name),
        waiting: 0,
        preparing: 0,
        ready: 0,
        delivered: 0,
      }
      if (i.status === 'sent') e.waiting += 1
      else if (i.status === 'preparing') e.preparing += 1
      else if (i.status === 'ready') e.ready += 1
      else if (i.status === 'delivered') e.delivered += 1
      other.set(i.point_id, e)
    }

    cards.push({
      order,
      lines,
      live,
      done: live.length === 0,
      ghosts,
      others: Array.from(other.values()),
      firstBatch: Math.min(...lines.map((l) => l.batch_no)),
    })
  }
  return { cards, ghostGroups }
}

function latestDeliveredAt(card: StationCard): string {
  let best = ''
  for (const l of card.lines) if (l.delivered_at && l.delivered_at > best) best = l.delivered_at
  return best
}

const GHOST_KEY = 'sarcafe.pos.ghosts.'
const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], [data-no-swipe]'
const SLOP_PX = 10
const SHAKE_MS = 450

type Drag = { orderId: string; near: boolean }
type DragSession = {
  pointerId: number
  orderId: string
  el: HTMLElement
  startX: number
  startY: number
  startedAt: number
  armed: boolean
  timer: number | null
  openedTray: boolean
  cleanup: () => void
}

export default function StationView({ pointId }: { pointId: string }) {
  const t = useT()
  const [lang] = usePosLang()
  const { me, pointsById } = usePos()
  const point = pointsById.get(pointId)
  const data = useLive()
  const { advance, refreshNow } = useLiveActions()
  const { go } = usePosNav()
  const { toast } = usePosToast()
  const sound = useSoundEnabled()

  // ---- clock: one 5 s tick drives aging, clocks and ghost expiry ----------------------------
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const id = window.setInterval(tick, AGING.tickMs)
    const onVis = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // ---- ghosts dismissed on THIS device -----------------------------------------------------
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GHOST_KEY + pointId)
      const arr: unknown = raw ? JSON.parse(raw) : []
      if (Array.isArray(arr)) setDismissed(new Set(arr.filter((x): x is string => typeof x === 'string')))
    } catch {
      /* private mode / bad JSON: nothing dismissed yet, which is the safe default */
    }
  }, [pointId])
  const dismissGhost = useCallback(
    (lineId: string) => {
      setDismissed((prev) => {
        const next = new Set(prev)
        next.add(lineId)
        try {
          window.localStorage.setItem(GHOST_KEY + pointId, JSON.stringify(Array.from(next).slice(-200)))
        } catch {
          /* it just will not persist across a reload */
        }
        return next
      })
    },
    [pointId],
  )

  // ---- cards ---------------------------------------------------------------------------------
  // Ghost expiry only needs minute-ish accuracy, so the cutoff is quantised: cards keep their
  // identity across the 5 s ticks instead of being rebuilt twelve times a minute.
  const ghostEpoch = Math.floor(now / 30_000)
  const { cards, ghostGroups } = useMemo(
    () =>
      buildCards(
        data.orders,
        pointId,
        (id, fallback) => pointsById.get(id)?.name ?? fallback,
        dismissed,
        ghostEpoch * 30_000 - STATION.ghostMs,
      ),
    [data.orders, pointId, pointsById, dismissed, ghostEpoch],
  )
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.order.id, c])), [cards])

  // What has been shown, so only genuinely NEW things animate or chime (see the header).
  const seenCards = useRef(new Set<string>())
  const seenLines = useRef(new Set<string>())
  const freshCards = useRef(new Set<string>())
  const freshLines = useRef(new Set<string>())
  const hydrated = useRef(false)
  const pendingChime = useRef(false)
  // Finished cards still showing as a chip, and which orders had live lines on the last commit.
  const lingerUntil = useRef(new Map<string, number>())
  const prevLive = useRef(new Set<string>())
  const [, bump] = useReducer((n: number) => n + 1, 0)

  if (data.loaded) {
    const seed = !hydrated.current
    for (const c of cards) {
      const id = c.order.id
      const cardIsNew = !seenCards.current.has(id)
      if (cardIsNew) {
        seenCards.current.add(id)
        if (!seed && c.live.length > 0) freshCards.current.add(id)
      }
      for (const l of c.lines) {
        if (seenLines.current.has(l.id)) continue
        seenLines.current.add(l.id)
        if (!seed && l.status === 'sent') {
          pendingChime.current = true
          if (!cardIsNew) freshLines.current.add(l.id)
        }
      }
      if (cardIsNew && !seed && c.live.some((l) => l.status === 'sent')) pendingChime.current = true
      if (c.done) {
        if (prevLive.current.has(id) && !lingerUntil.current.has(id)) {
          lingerUntil.current.set(id, Date.now() + STATION.doneLingerMs)
        }
        freshCards.current.delete(id)
      } else {
        lingerUntil.current.delete(id)
      }
    }
    hydrated.current = true
  }

  const nowMs = Date.now()
  for (const [id, until] of Array.from(lingerUntil.current)) {
    if (until <= nowMs) lingerUntil.current.delete(id)
  }
  const lingering = (id: string) => lingerUntil.current.has(id)

  const activeCards = cards.filter((c) => !c.done || lingering(c.order.id))
  const trayCards = cards
    .filter((c) => c.done && !lingering(c.order.id))
    .sort((a, b) => (latestDeliveredAt(a) < latestDeliveredAt(b) ? 1 : -1))
    .slice(0, STATION.doneTrayMax)
  const doneCount = cards.filter((c) => c.done && !lingering(c.order.id)).length
  const standaloneGhosts = ghostGroups.filter((g) => {
    const c = cardsById.get(g.order.id)
    return !c || c.done
  })
  const liveLines = useMemo(() => cards.flatMap((c) => c.live), [cards])
  const overdue = overdueCount(liveLines, now)
  const criticalIds = cards
    .filter((c) => c.live.some((l) => l.status === 'sent' && overdueCount([l], now) > 0))
    .map((c) => c.order.id)
    .join(',')

  // After every commit: remember who is live (for the linger rule), chime for arrivals, and
  // arrange the wake-up that retires the next lingering chip.
  useEffect(() => {
    prevLive.current = new Set(cards.filter((c) => !c.done).map((c) => c.order.id))
    if (pendingChime.current) {
      pendingChime.current = false
      chime('new')
    }
    if (lingerUntil.current.size > 0) {
      const next = Math.min(...Array.from(lingerUntil.current.values()))
      const id = window.setTimeout(bump, Math.max(30, next - Date.now() + 30))
      return () => window.clearTimeout(id)
    }
  })

  // A card that FIRST goes critical gets the hard beep once; it re-arms if it stops being critical.
  const criticalSeen = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!data.loaded) return
    const ids = new Set(criticalIds ? criticalIds.split(',') : [])
    const seen = criticalSeen.current
    if (seen) {
      let fresh = false
      ids.forEach((id) => {
        if (!seen.has(id)) fresh = true
      })
      if (fresh) chime('critical')
    }
    criticalSeen.current = ids
  }, [criticalIds, data.loaded])

  // ---- advancing --------------------------------------------------------------------------------
  // The store paints at once and rolls back with its own plain-language toast on a conflict.
  const advanceIds = useCallback(
    (ids: readonly string[], from: LiveStatus, to: LiveStatus) => {
      void advance(ids, from, to)
    },
    [advance],
  )
  const pointRef = useRef(point)
  pointRef.current = point
  const advanceCard = useCallback(
    (ids: string[], from: 'sent' | 'preparing' | 'ready', to: 'preparing' | 'ready' | 'delivered') => advanceIds(ids, from, to),
    [advanceIds],
  )
  const advanceLine = useCallback(
    (line: PosItem) => {
      const p = pointRef.current
      if (!p) return
      const a = lineAction(line, p)
      if (a) advanceIds([line.id], a.from as LiveStatus, a.to as LiveStatus)
    },
    [advanceIds],
  )
  const revertLine = useCallback(
    (line: PosItem) => {
      if (line.status === 'ready') advanceIds([line.id], 'ready', 'preparing')
      else if (line.status === 'preparing') advanceIds([line.id], 'preparing', 'sent')
    },
    [advanceIds],
  )
  const undoDelivered = useCallback(
    (_card: StationCard, ids: string[]) => advanceIds(ids, 'delivered', 'ready'),
    [advanceIds],
  )

  // ---- Done tray + dragging a card to it -------------------------------------------------------------
  const [trayOpen, setTrayOpen] = useState(false)
  const closeTray = useCallback(() => setTrayOpen(false), [])
  const toggleTray = useCallback(() => setTrayOpen((o) => !o), [])
  const [drag, setDrag] = useState<Drag | null>(null)
  const [shakeId, setShakeId] = useState<string | null>(null)
  const session = useRef<DragSession | null>(null)
  const proxyEl = useRef<HTMLDivElement | null>(null)
  const lastPos = useRef({ x: 0, y: 0 })
  const trayOpenRef = useRef(trayOpen)
  trayOpenRef.current = trayOpen
  const cardsByIdRef = useRef(cardsById)
  cardsByIdRef.current = cardsById

  const placeProxy = useCallback(() => {
    const el = proxyEl.current
    if (el) el.style.transform = `translate3d(${lastPos.current.x + 14}px, ${lastPos.current.y - 28}px, 0)`
  }, [])

  const fileCard = useCallback(
    (orderId: string) => {
      const c = cardsByIdRef.current.get(orderId)
      if (c && c.done) {
        lingerUntil.current.delete(orderId)
        haptic('impact')
        bump()
        return
      }
      // In progress: refused, gently - a shake and a plain sentence, never a silent snap-back.
      haptic('impact')
      setShakeId(orderId)
      window.setTimeout(() => setShakeId((cur) => (cur === orderId ? null : cur)), SHAKE_MS)
      toast(t('station.done.notYet'), { tone: 'info' })
    },
    [t, toast],
  )

  const endSession = useCallback((s: DragSession) => {
    if (s.timer != null) window.clearTimeout(s.timer)
    s.cleanup()
    try {
      s.el.releasePointerCapture(s.pointerId)
    } catch {
      /* already released */
    }
    if (session.current === s) session.current = null
  }, [])

  const onCardPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>, orderId: string) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if ((e.target as HTMLElement).closest(INTERACTIVE)) return // the big button etc. never start a drag
      if (session.current) return
      const el = e.currentTarget
      const s: DragSession = {
        pointerId: e.pointerId,
        orderId,
        el,
        startX: e.clientX,
        startY: e.clientY,
        startedAt: performance.now(),
        armed: false,
        timer: null,
        openedTray: false,
        cleanup: () => {},
      }
      lastPos.current = { x: e.clientX, y: e.clientY }

      const nearEdge = (x: number) =>
        classifyDrag({ pressedForMs: performance.now() - s.startedAt, x, viewportWidth: window.innerWidth }).nearLeftEdge ||
        (trayOpenRef.current && x <= trayRight())

      const arm = () => {
        s.timer = null
        s.armed = true
        try {
          el.setPointerCapture(s.pointerId)
        } catch {
          /* the pointer is already gone */
        }
        haptic('select')
        setDrag({ orderId, near: nearEdge(lastPos.current.x) })
      }
      s.timer = window.setTimeout(arm, 350)

      const onMove = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== s.pointerId) return
        lastPos.current = { x: ev.clientX, y: ev.clientY }
        if (!s.armed) {
          // Moved before the hold finished: this is a scroll or a swipe, not a drag.
          if (Math.hypot(ev.clientX - s.startX, ev.clientY - s.startY) > SLOP_PX) endSession(s)
          return
        }
        placeProxy()
        const near = nearEdge(ev.clientX)
        if (near && !trayOpenRef.current) {
          s.openedTray = true
          setTrayOpen(true)
        }
        setDrag((cur) => (cur && cur.near !== near ? { ...cur, near } : cur))
      }
      const onUp = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== s.pointerId) return
        const dropped = s.armed && nearEdge(ev.clientX)
        const opened = s.openedTray
        endSession(s)
        setDrag(null)
        if (dropped) fileCard(orderId)
        else if (opened) setTrayOpen(false) // it was opened only by this drag, so put it back
      }
      const onCancel = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== s.pointerId) return
        const opened = s.openedTray
        endSession(s)
        setDrag(null)
        if (opened) setTrayOpen(false)
      }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', onUp)
      el.addEventListener('pointercancel', onCancel)
      s.cleanup = () => {
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', onUp)
        el.removeEventListener('pointercancel', onCancel)
      }
      session.current = s
    },
    [endSession, fileCard, placeProxy],
  )
  useEffect(
    () => () => {
      if (session.current) endSession(session.current)
    },
    [endSession],
  )

  // ---- history: a swipe on the background, or the header button ---------------------------------
  const [askTimeline, setAskTimeline] = useState(false)
  const swipe = useRef<{ x: number; y: number; at: number; interactive: boolean; id: number } | null>(null)
  const openTimeline = useCallback(() => {
    // The horizontal slide. The transition needs the new view committed synchronously.
    runLocalTransition('pos-timeline', 'forward', () => flushSync(() => go({ v: 'timeline', point: pointId })))
  }, [go, pointId])
  const onBgPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    swipe.current = {
      x: e.clientX,
      y: e.clientY,
      at: performance.now(),
      interactive: !!target.closest(`[data-station-card], [data-station-ghosts], .std-chip, ${INTERACTIVE}`),
      id: e.pointerId,
    }
  }
  const onBgPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = swipe.current
    swipe.current = null
    if (!s || s.id !== e.pointerId) return
    const verdict = classifySwipe({
      startX: s.x,
      startY: s.y,
      endX: e.clientX,
      endY: e.clientY,
      startedAtMs: s.at,
      endedAtMs: performance.now(),
      viewportWidth: window.innerWidth,
      startedOnInteractive: s.interactive,
    })
    if (verdict === 'swipe-left') setAskTimeline(true)
  }

  // ---- keyboard: arrows move between cards, 1 / 2 / 3 advance the focused one ---------------------
  const listRef = useRef<HTMLDivElement>(null)
  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const cardEl = target.closest<HTMLElement>('[data-station-card]')
    if (!cardEl || e.ctrlKey || e.metaKey || e.altKey) return
    const kinds: Record<string, 'accept' | 'ready' | 'handover'> = { '1': 'accept', '2': 'ready', '3': 'handover' }
    const kind = kinds[e.key]
    if (kind) {
      e.preventDefault()
      const card = cardsById.get(cardEl.dataset.orderId ?? '')
      const p = pointRef.current
      if (!card || !p) return
      const a = cardAction(card.live, p)
      if (!a) return
      if (a.kind !== kind) {
        const n = a.kind === 'accept' ? 1 : a.kind === 'ready' ? 2 : 3
        toast(t('station.key.wrong', { n, action: t(`station.act.${a.kind}` as const) }), { tone: 'info' })
        return
      }
      haptic('impact')
      advanceIds(a.ids, a.from as LiveStatus, a.to as LiveStatus)
      return
    }
    if (target !== cardEl) return // arrows only steer from the card itself, never from inside a control
    const rtl = getComputedStyle(cardEl).direction === 'rtl'
    const next = e.key === 'ArrowDown' || e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')
    const prev = e.key === 'ArrowUp' || e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')
    if (!next && !prev) return
    const all = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-station-card]') ?? [])
    const i = all.indexOf(cardEl)
    const to = all[i + (next ? 1 : -1)]
    if (to) {
      e.preventDefault()
      to.focus()
      to.scrollIntoView({ block: 'nearest' })
    }
  }

  // ---- render ------------------------------------------------------------------------------------------
  if (!point) return null
  const colour = safeColour(point.colour, '#888888')
  const PointIcon = resolveCategoryIcon(point.icon)
  const empty = liveLines.length === 0 && standaloneGhosts.length === 0 && activeCards.length === 0
  const dragCard = drag ? cardsById.get(drag.orderId) : null

  return (
    <div
      className="station"
      style={{ viewTransitionName: 'pos-timeline' }}
      onPointerDownCapture={() => unlockAudio()}
    >
      <header className="sth">
        <div className="sth-point">
          <span className="sth-icon" style={{ background: colour }} aria-hidden="true">
            <PointIcon size={22} />
          </span>
          <h1 className="sth-name">{point.name}</h1>
        </div>
        <div className="sth-tools">
          <CheckinPill pointId={pointId} />
          <button
            type="button"
            className="sth-btn press"
            aria-pressed={sound}
            aria-label={sound ? t('core.sound.on') : t('core.sound.off')}
            onClick={() => {
              const next = !sound
              setSoundEnabled(next)
              if (next) unlockAudio()
            }}
          >
            {sound ? <Volume2 size={22} aria-hidden="true" /> : <VolumeX size={22} aria-hidden="true" />}
          </button>
          <button type="button" className="sth-btn sth-btn--text press" onClick={openTimeline}>
            <History size={22} aria-hidden="true" />
            <span>{t('station.timeline')}</span>
          </button>
          <span className="sth-me">
            <HandleChip staffId={me.id} handle={me.handle} size="md" />
          </span>
        </div>
      </header>

      <OverdueStrip count={overdue} />
      {data.failed && data.loaded ? (
        <p className="sts-stale" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          {t('station.stale')}
        </p>
      ) : null}

      <div
        className="station-body pos-pane-scroll"
        onPointerDown={onBgPointerDown}
        onPointerUp={onBgPointerUp}
        onPointerCancel={() => {
          swipe.current = null
        }}
      >
        {!data.loaded ? (
          data.failed ? (
            <div className="sts-empty" role="status">
              <p>{t('station.loadFailed')}</p>
              <button type="button" className="pos-btn press" onClick={refreshNow}>
                {t('station.retry')}
              </button>
            </div>
          ) : (
            <div className="station-list" aria-busy="true">
              <SkTicketCard label={t('core.loading')} />
              <SkTicketCard />
              <SkTicketCard />
            </div>
          )
        ) : (
          <>
            {standaloneGhosts.length ? (
              <ul className="stg-stack" data-station-ghosts>
                {standaloneGhosts.flatMap((g) =>
                  g.ghosts.map((l) => (
                    <GhostRow
                      key={l.id}
                      line={l}
                      lang={lang}
                      ticketNo={g.order.ticket_no}
                      customerName={g.order.customer_name}
                      onDismiss={dismissGhost}
                    />
                  )),
                )}
              </ul>
            ) : null}
            <div className="station-list" ref={listRef} onKeyDown={onListKeyDown}>
              {activeCards.map((c) =>
                c.done ? (
                  <DoneChip key={c.order.id} card={c} meId={me.id} isManager={me.isManager} onUndo={undoDelivered} />
                ) : (
                  <OrderCard
                    key={c.order.id}
                    card={c}
                    point={point}
                    now={now}
                    meId={me.id}
                    lang={lang}
                    fresh={freshCards.current.has(c.order.id)}
                    freshLines={freshLines.current}
                    shaking={shakeId === c.order.id}
                    dragging={drag?.orderId === c.order.id}
                    onAdvanceCard={advanceCard}
                    onAdvanceLine={advanceLine}
                    onRevertLine={revertLine}
                    onDismissGhost={dismissGhost}
                    onCardPointerDown={onCardPointerDown}
                  />
                ),
              )}
            </div>
            {empty ? (
              <div className="sts-empty" role="status">
                <p>{t('station.empty')}</p>
              </div>
            ) : null}
          </>
        )}
      </div>

      <DoneTray
        open={trayOpen}
        onToggle={toggleTray}
        onClose={closeTray}
        cards={trayCards}
        count={doneCount}
        dragging={!!drag}
        meId={me.id}
        isManager={me.isManager}
        lang={lang}
        onUndo={undoDelivered}
      />

      {drag && dragCard ? (
        <ModalPortal>
          <div
            className={`stx-proxy${drag.near ? ' is-near' : ''}`}
            aria-hidden="true"
            ref={(el) => {
              proxyEl.current = el
              if (el) placeProxy()
            }}
          >
            <span className="ltr-isolate">{ticketLabel(dragCard.order.ticket_no)}</span>
            {dragCard.order.customer_name ? ` · ${dragCard.order.customer_name}` : ''}
          </div>
        </ModalPortal>
      ) : null}

      <ConfirmSheet
        request={
          askTimeline
            ? {
                title: t('station.swipe.title'),
                body: t('station.swipe.body'),
                confirmLabel: t('station.swipe.yes'),
                cancelLabel: t('station.swipe.no'),
              }
            : null
        }
        onCancel={() => setAskTimeline(false)}
        onConfirm={() => {
          setAskTimeline(false)
          openTimeline()
        }}
      />
    </div>
  )
}
