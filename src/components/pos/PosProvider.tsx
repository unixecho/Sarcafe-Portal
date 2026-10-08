'use client'

// ============================================================================
// PosProvider — the staff app's shared, slow-changing state, and the ONE place
// that listens for "something changed".
//
// THE API THE SCREENS CONSUME (this header is the contract; wave-2 screens read
// it instead of the code). Every hook below needs <PosApp> above it.
//
//   usePos()            STABLE config + derived data. Re-renders only when the
//                       config really changes (a new point, a menu publish, a
//                       nickname) — never on a poll tick:
//     me                { id, handle, handleConfirmed, colour, isManager }
//     branch            BranchLite | null   (null only on the "no event" screen,
//                       which renders no screen — inside a screen it exists)
//     branchId          string — branch.id, '' only when branch is null
//     branches          the events this person may work (rarely > 1)
//     enabled           the owner's switch for this event (a screen is never
//                       rendered while it is off)
//     session           the open service period, or null (also never null
//                       inside a screen — the shell shows "the event is closed")
//     isTraining        session?.kind === 'training'
//     points            ACTIVE points, sorted (sort_order, then name)
//     pointsById        every point incl. inactive ones — for an old line whose
//                       point was later deactivated. May lack inactive points
//                       until the first refresh: fall back to line.point_name.
//     routes, pointStaff, unsold   raw routing config
//     routing           RoutingContext   (resolveRoute / routeMenu take this)
//     menu              PosMenu | null   (the PUBLISHED menu; the last good one
//                       is always kept — a cashier must always have a menu)
//     pricing           PricingContext | null  (null only while there is no
//                       menu; priceLine / defaultSelections take this)
//     directory         everyone's { id, handle, colour } — for display only
//     colourOf(id)      the person's colour (always a safe #rrggbb)
//     handleOf(id, fallback?)  the person's nickname, '—' if unknown
//
//   useRefreshKey()     number. Bumps on EVERY realtime signal, on the 8 s
//                       backup poll, and when the tab becomes visible — three
//                       sources, ONE signal (blueprint §10.2: the fallback must
//                       drive the same signal the socket drives). Put it in an
//                       effect's deps to refetch your own data:
//                         const key = useRefreshKey()
//                         useEffect(() => { void load() }, [key])
//                       It is NOT in usePos() on purpose: that would re-render
//                       every consumer of the config (the register's 140 item
//                       tiles included) every 8 seconds for nothing.
//   usePosLink()        { connection: 'live'|'connecting'|'off', online, menuStale }
//   usePosSignals()     refreshKey + usePosLink() in one object (re-renders on both)
//   usePosActions()     { refreshAll(), patchMe(partial) } — stable identities
//
//   useLive()  (live/LiveStore.tsx)   the shared orders: { orders, byId, loaded,
//                       failed, backlog, advance, voidItems, refreshNow }. Station,
//                       orders and counts all read this ONE store — never run a
//                       second orders query of your own.
//   usePosNav() (PosNav.tsx)          { view, go, back, openOrder, closeOrder, … }.
//                       Import it from '@/components/pos/PosNav', NOT from PosApp
//                       (PosApp imports every screen; importing it back is a cycle).
//   usePosToast() (shell/Toast.tsx)   { toast(message, { tone }) }
//   errorText(t, code) (shell/errorText.ts)   code -> one plain sentence
//   HandleChip (shell/HandleChip.tsx) a person's nickname in their colour
//
// HOW TO ADD A STRING (an "area" string):
//   1. Open src/lib/pos/i18n/<your area>.ts (register / station / orders / me /
//      owner / board — core and errors belong to the shell).
//   2. Add `'<area>.some.key': { he: '…', en: '…' }` — Hebrew is REQUIRED, English
//      may lag. Keys are typed: t('area.some.key') is a compile error until you do.
//   3. Read it with `const t = useT()` (lib/pos/useT.ts). "{name}" placeholders
//      are filled from the second argument: t('area.key', { name }).
//   Nothing an employee reads may say id / session / status / sync / permission.
//
// SCREENS ARE MOUNTED ONLY WHILE ACTIVE. PosApp renders exactly one view, so a
// flip Register -> Orders -> Register unmounts and remounts the register. Anything
// that must survive a flip (the cart draft) lives in localStorage or in a store,
// never in component state.
//
// WHAT THIS FILE DOES, in the order it happens:
//   * Seeds from the server-rendered bootstrap (first paint is already populated).
//   * Owns the ONE realtime subscription (via the module singleton) + the 8 s
//     backup poll + a visibility catch-up. All three only bump a counter.
//   * On a counter bump, re-reads the small, cheap configuration directly over RLS
//     (session, points, routes, who-works-where, the staff directory) — one hop,
//     and only commits a slice when its content actually changed, so an idle
//     poll re-renders nothing.
//   * Every 30 s (and when the tab returns) asks the API for the things RLS cannot
//     show a browser: the owner's on/off switch, the unsold list, the person's own
//     row. A 401 there means the sign-in expired -> `signedOut`.
//   * Polls the menu every 20 s by its change stamp (cheap when unchanged) and
//     swaps it only when it changed. The last good menu is cached in localStorage:
//     a cashier on dead Wi-Fi must still be able to take an order.
//   * Mirrors the last good configuration to sessionStorage, so if the server could
//     not resolve an event at load, a tablet waking up still paints its last-known
//     state instead of a blank.
//   * Every storage access is in try/catch (private mode, full quota, blocked data).
//
// FAIL-OPEN / FAIL-CLOSED (blueprint §10.5): a failed configuration read keeps the
// previous value — "is the event open?" fails OPEN in the UI because the database
// refuses an order without one anyway; a failed menu poll keeps the last menu.
// ============================================================================

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import { createClient } from '@/lib/supabase/client'
import { posApi } from '@/lib/pos/client'
import {
  getRealtimeStatus, subscribeRealtime, subscribeRealtimeStatus, type RealtimeStatus,
} from '@/lib/pos/realtime'
import {
  DIRECTORY_COLUMNS, POINT_COLUMNS, POINT_STAFF_COLUMNS, ROUTE_COLUMNS, SESSION_COLUMNS,
} from '@/lib/pos/columns'
import { REFRESH } from '@/lib/pos/vocab'
import { staffColourMap } from '@/lib/pos/colour'
import type { PricingContext } from '@/lib/pos/pricing'
import type { RoutingContext } from '@/lib/pos/routing'
import type { BootstrapResponse, BranchLite, PosMe } from '@/lib/pos/api'
import type { PosMenu, PosPoint, PosPointStaff, PosRoute, PosSession, StaffDirEntry } from '@/lib/pos/types'
import { safeColour } from './shell/safeColour'

// ---- types -----------------------------------------------------------------------------

type PosConfig = {
  me: PosMe
  branches: BranchLite[]
  branch: BranchLite | null
  enabled: boolean
  session: PosSession | null
  /** every point the server told us about, active or not */
  allPoints: PosPoint[]
  routes: PosRoute[]
  pointStaff: PosPointStaff[]
  unsold: string[]
  directory: StaffDirEntry[]
}

export type PosContextValue = {
  me: PosMe
  branch: BranchLite | null
  branchId: string
  branches: BranchLite[]
  enabled: boolean
  session: PosSession | null
  isTraining: boolean
  points: PosPoint[]
  pointsById: ReadonlyMap<string, PosPoint>
  routes: PosRoute[]
  pointStaff: PosPointStaff[]
  unsold: string[]
  routing: RoutingContext
  menu: PosMenu | null
  pricing: PricingContext | null
  directory: StaffDirEntry[]
  colourOf: (staffId: string | null | undefined) => string
  handleOf: (staffId: string | null | undefined, fallback?: string) => string
}

export type PosLink = {
  connection: RealtimeStatus
  online: boolean
  /** the menu could not be re-checked for a while; the one on screen is the last good copy */
  menuStale: boolean
  /** the API said our sign-in is no longer valid */
  signedOut: boolean
}

export type PosActions = {
  /** Re-read everything now (the connection pill's tap). */
  refreshAll: () => void
  /** Reflect a change to the person's own row at once (the nickname gate). */
  patchMe: (patch: Partial<PosMe>) => void
}

// ---- contexts ------------------------------------------------------------------------------

const PosCtx = createContext<PosContextValue | null>(null)
const RefreshCtx = createContext<number>(0)
const LinkCtx = createContext<PosLink | null>(null)
const ActionsCtx = createContext<PosActions | null>(null)

function need<T>(v: T | null, name: string): T {
  if (v === null) throw new Error(`${name}() needs <PosApp> above it.`)
  return v
}

export const usePos = (): PosContextValue => need(useContext(PosCtx), 'usePos')
export const useRefreshKey = (): number => useContext(RefreshCtx)
export const usePosLink = (): PosLink => need(useContext(LinkCtx), 'usePosLink')
export const usePosActions = (): PosActions => need(useContext(ActionsCtx), 'usePosActions')
export function usePosSignals(): PosLink & { refreshKey: number } {
  const link = usePosLink()
  const refreshKey = useRefreshKey()
  return useMemo(() => ({ ...link, refreshKey }), [link, refreshKey])
}

// ---- storage (every access guarded) -----------------------------------------------------------

const MENU_KEY = 'sarcafe.pos.menu.'
const BOOT_KEY = 'sarcafe.pos.boot.v1'
/** How often the slow, API-only fields (the on/off switch, the unsold list, our own row) are re-read. */
const BOOTSTRAP_POLL_MS = 30_000
const BOOTSTRAP_MIN_GAP_MS = 10_000
/** Two failed menu checks in a row before we call the menu "stale" — one dropped packet is not news. */
const MENU_STALE_AFTER = 2

function readJson<T>(storage: 'local' | 'session', key: string): T | null {
  try {
    const s = storage === 'local' ? window.localStorage : window.sessionStorage
    const raw = s.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(storage: 'local' | 'session', key: string, value: unknown): void {
  try {
    const s = storage === 'local' ? window.localStorage : window.sessionStorage
    s.setItem(key, JSON.stringify(value))
  } catch {
    /* full quota / private mode: the cache just does not persist */
  }
}

/** A cached menu is only believed if it still looks like one. */
function validMenu(m: unknown): PosMenu | null {
  if (!m || typeof m !== 'object') return null
  const x = m as Partial<PosMenu>
  if (!Array.isArray(x.categories) || typeof x.stamp !== 'string') return null
  return { ...(x as PosMenu), modifierGroups: Array.isArray(x.modifierGroups) ? x.modifierGroups : [] }
}

// ---- helpers --------------------------------------------------------------------------------------

function configFrom(b: BootstrapResponse): PosConfig {
  return {
    me: b.me,
    branches: b.branches,
    branch: b.branch,
    enabled: b.enabled,
    session: b.session,
    allPoints: b.points ?? [],
    routes: b.routes ?? [],
    pointStaff: b.pointStaff ?? [],
    unsold: b.unsold ?? [],
    directory: b.directory ?? [],
  }
}

const sig = (v: unknown): string => JSON.stringify(v)

function sortPoints(points: readonly PosPoint[]): PosPoint[] {
  return points
    .filter((p) => p.active)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'he'))
}

const NEUTRAL = '#9c9086'

// ---- the provider ---------------------------------------------------------------------------------

export function PosProvider({ initial, children }: { initial: BootstrapResponse; children: ReactNode }) {
  const [cfg, setCfg] = useState<PosConfig>(() => configFrom(initial))
  const [menu, setMenu] = useState<PosMenu | null>(() => validMenu(initial.menu))
  const [refreshKey, setRefreshKey] = useState(0)
  const [configKey, setConfigKey] = useState(0)
  const [connection, setConnection] = useState<RealtimeStatus>(initial.me.codeOnly ? 'off' : 'connecting')
  const [online, setOnline] = useState(true)
  const [menuStale, setMenuStale] = useState(false)
  const [signedOut, setSignedOut] = useState(false)

  // Latest values for callbacks that outlive a render (timers, listeners).
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg
  const menuRef = useRef(menu)
  menuRef.current = menu

  const bump = useCallback(() => setRefreshKey((k) => k + 1), [])
  const bumpConfig = useCallback(() => setConfigKey((k) => k + 1), [])

  // ---- configuration slices, committed only when their CONTENT changed -----------------------------

  const patchConfig = useCallback((patch: Partial<PosConfig>) => {
    const cur = cfgRef.current
    const next: PosConfig = { ...cur }
    let changed = false
    for (const k of Object.keys(patch) as (keyof PosConfig)[]) {
      const v = patch[k]
      if (v === undefined) continue
      if (sig(v) !== sig(cur[k])) {
        ;(next as Record<string, unknown>)[k] = v
        changed = true
      }
    }
    if (changed) {
      cfgRef.current = next
      setCfg(next)
    }
  }, [])

  const commitMenu = useCallback((m: PosMenu) => {
    menuRef.current = m
    setMenu(m)
    const id = cfgRef.current.branch?.id
    if (id) writeJson('local', MENU_KEY + id, m)
  }, [])

  // ---- direct reads over RLS: session, points, routes, who works where, the directory ------------------

  const configBusy = useRef(false)
  const configQueued = useRef(false)
  const refreshConfig = useCallback(async () => {
    const branchId = cfgRef.current.branch?.id
    if (!branchId) return
    if (configBusy.current) {
      configQueued.current = true
      return
    }
    configBusy.current = true
    try {
      if (cfgRef.current.me.codeOnly) {
        const response = await posApi.bootstrap(branchId)
        if (!response.ok) {
          if (response.status === 401 || response.code === 'unauthorized') setSignedOut(true)
          return
        }
        setSignedOut(false)
        patchConfig(configFrom(response.data))
        if (response.data.menu && response.data.menu.stamp !== menuRef.current?.stamp) {
          const nextMenu = validMenu(response.data.menu)
          if (nextMenu) { menuRef.current = nextMenu; setMenu(nextMenu) }
        }
        return
      }
      const sb = createClient()
      const [sess, pts, rts, ps, dir] = await Promise.all([
        sb.from('pos_sessions').select(SESSION_COLUMNS).eq('branch_id', branchId).eq('status', 'active').maybeSingle(),
        sb.from('pos_points').select(POINT_COLUMNS).eq('branch_id', branchId).order('sort_order').order('name'),
        sb.from('pos_point_routes').select(ROUTE_COLUMNS).eq('branch_id', branchId),
        sb.from('pos_point_staff').select(POINT_STAFF_COLUMNS),
        sb.from('pos_staff_directory').select(DIRECTORY_COLUMNS),
      ])
      const patch: Partial<PosConfig> = {}
      // A failed read leaves its slice alone (fail-open): an error is never read as "empty".
      if (!sess.error) patch.session = (sess.data as unknown as PosSession | null) ?? null
      const points = !pts.error ? ((pts.data as unknown as PosPoint[] | null) ?? []) : null
      if (points) {
        patch.allPoints = points.map((p) => ({ ...p, excluded_uids: p.excluded_uids ?? [] }))
      }
      if (!rts.error) patch.routes = (rts.data as unknown as PosRoute[] | null) ?? []
      if (!ps.error && points) {
        const mine = new Set(points.map((p) => p.id))
        patch.pointStaff = ((ps.data as unknown as PosPointStaff[] | null) ?? []).filter((x) => mine.has(x.point_id))
      }
      if (!dir.error) patch.directory = (dir.data as unknown as StaffDirEntry[] | null) ?? []
      // Session is the one slice that is a plain `null` when "closed": patchConfig skips
      // `undefined` only, so a real null still commits.
      patchConfig(patch)
    } catch {
      /* offline: keep everything as it was */
    } finally {
      configBusy.current = false
      if (configQueued.current) {
        configQueued.current = false
        void refreshConfig()
      }
    }
  }, [patchConfig])

  useEffect(() => {
    if (configKey > 0) void refreshConfig()
  }, [configKey, refreshConfig])

  // ---- the API-only fields -------------------------------------------------------------------------------

  const bootBusy = useRef(false)
  const bootAt = useRef(0)
  const refreshBootstrap = useCallback(
    async (force = false) => {
      const branch = cfgRef.current.branch
      if (!branch || bootBusy.current) return
      const now = Date.now()
      if (!force && now - bootAt.current < BOOTSTRAP_MIN_GAP_MS) return
      bootBusy.current = true
      bootAt.current = now
      try {
        const r = await posApi.bootstrap(branch.id)
        if (!r.ok) {
          // 401 is "your sign-in ended". Anything else (network, 5xx) is just a missed beat.
          if (r.status === 401 || r.code === 'unauthorized') setSignedOut(true)
          return
        }
        setSignedOut(false)
        const d = r.data
        patchConfig(d.me.codeOnly ? configFrom(d) : { me: d.me, enabled: d.enabled, unsold: d.unsold ?? [], branches: d.branches })
        if (d.menu && d.menu.stamp !== menuRef.current?.stamp) {
          const m = validMenu(d.menu)
          if (m) commitMenu(m)
        }
      } finally {
        bootBusy.current = false
      }
    },
    [patchConfig, commitMenu],
  )

  // ---- the menu: stamp poll, swap only on change, last good copy cached ---------------------------------------

  const menuFails = useRef(0)
  const menuBusy = useRef(false)
  const refreshMenu = useCallback(async () => {
    const branch = cfgRef.current.branch
    if (!branch || menuBusy.current) return
    menuBusy.current = true
    try {
      const r = await posApi.menu(branch.id, menuRef.current?.stamp)
      if (!r.ok) {
        menuFails.current += 1
        if (menuFails.current >= MENU_STALE_AFTER) setMenuStale(true)
        return
      }
      menuFails.current = 0
      setMenuStale(false)
      if (!r.data.unchanged) {
        const m = validMenu(r.data.menu)
        if (m) commitMenu(m)
      }
    } finally {
      menuBusy.current = false
    }
  }, [commitMenu])

  // ---- the three sources of "something changed" — all bump the SAME counter ---------------------------------

  useEffect(() => {
    const unsubscribe = cfg.me.codeOnly ? () => undefined : subscribeRealtime((dirty) => {
      bump()
      // Only these two change what refreshConfig reads and are in the publication;
      // an order change must not trigger five configuration reads per device.
      if (dirty.has('pos_points') || dirty.has('pos_sessions')) bumpConfig()
    })
    const unsubscribeStatus = cfg.me.codeOnly ? () => undefined : subscribeRealtimeStatus(setConnection)
    setConnection(cfg.me.codeOnly ? 'off' : getRealtimeStatus())
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine !== false)

    const poll = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      bump()
      bumpConfig()
    }, REFRESH.backupPollMs)

    const bootPoll = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      void refreshBootstrap()
    }, BOOTSTRAP_POLL_MS)

    const menuPoll = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      void refreshMenu()
    }, REFRESH.menuPollMs)

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      bump()
      bumpConfig()
      void refreshMenu()
      void refreshBootstrap()
    }
    const onOnline = () => {
      setOnline(true)
      bump()
      bumpConfig()
      void refreshMenu()
      void refreshBootstrap(true)
    }
    const onOffline = () => setOnline(false)

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      unsubscribe()
      unsubscribeStatus()
      window.clearInterval(poll)
      window.clearInterval(bootPoll)
      window.clearInterval(menuPoll)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [bump, bumpConfig, refreshBootstrap, refreshMenu, cfg.me.codeOnly])

  // ---- after hydration: caches (kept out of initial state so server and client markup match) ----------------------

  useEffect(() => {
    const branchId = initial.branch?.id
    if (branchId && !initial.menu) {
      const cached = validMenu(readJson('local', MENU_KEY + branchId))
      if (cached && !menuRef.current) {
        menuRef.current = cached
        setMenu(cached)
      }
    }
    if (!initial.branch) {
      // The server could not resolve an event for us. If this tab remembers one, paint
      // that so the cashier is not stranded on a blank; the next read corrects it.
      const snap = readJson<{ cfg?: PosConfig }>('session', BOOT_KEY)
      if (snap?.cfg?.branch && snap.cfg.me.id === initial.me.id && snap.cfg.me.codeOnly === initial.me.codeOnly) {
        cfgRef.current = snap.cfg
        setCfg(snap.cfg)
        const cached = validMenu(readJson('local', MENU_KEY + snap.cfg.branch.id))
        if (cached) {
          menuRef.current = cached
          setMenu(cached)
        }
        bumpConfig()
      }
    }
    // Always check the menu once on arrival: the server-rendered copy may be minutes old on a tablet that slept.
    void refreshMenu()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Last-known-good configuration, for the wake-up case above.
  useEffect(() => {
    if (cfg.branch) writeJson('session', BOOT_KEY, { savedAt: Date.now(), cfg })
  }, [cfg])

  // ---- actions ------------------------------------------------------------------------------------------------

  const refreshAll = useCallback(() => {
    bump()
    bumpConfig()
    void refreshMenu()
    void refreshBootstrap(true)
  }, [bump, bumpConfig, refreshMenu, refreshBootstrap])

  const patchMe = useCallback((patch: Partial<PosMe>) => {
    const cur = cfgRef.current
    const me = { ...cur.me, ...patch }
    const directory = cur.directory.some((d) => d.id === me.id)
      ? cur.directory.map((d) => (d.id === me.id ? { ...d, handle: me.handle, colour: me.colour } : d))
      : [...cur.directory, { id: me.id, handle: me.handle, colour: me.colour }]
    const next = { ...cur, me, directory }
    cfgRef.current = next
    setCfg(next)
  }, [])

  const actions = useMemo<PosActions>(() => ({ refreshAll, patchMe }), [refreshAll, patchMe])

  // ---- derived -----------------------------------------------------------------------------------------------------

  const points = useMemo(() => sortPoints(cfg.allPoints), [cfg.allPoints])
  const pointsById = useMemo(() => new Map(cfg.allPoints.map((p) => [p.id, p])), [cfg.allPoints])

  const routing = useMemo<RoutingContext>(
    () => ({ points, routes: cfg.routes, unsold: cfg.unsold }),
    [points, cfg.routes, cfg.unsold],
  )
  const pricing = useMemo<PricingContext | null>(
    () => (menu ? { categories: menu.categories, modifierGroups: menu.modifierGroups ?? [], routing } : null),
    [menu, routing],
  )

  // The directory should always contain the person using this screen, even in the
  // instant before the first read that includes them.
  const directory = useMemo(
    () =>
      cfg.directory.some((d) => d.id === cfg.me.id)
        ? cfg.directory
        : [...cfg.directory, { id: cfg.me.id, handle: cfg.me.handle, colour: cfg.me.colour }],
    [cfg.directory, cfg.me],
  )
  const colours = useMemo(() => staffColourMap(directory), [directory])
  const handles = useMemo(() => new Map(directory.map((d) => [d.id, d.handle])), [directory])
  const colourOf = useCallback(
    (id: string | null | undefined) => safeColour(id ? colours.get(id) : undefined, NEUTRAL),
    [colours],
  )
  const handleOf = useCallback(
    (id: string | null | undefined, fallback = '—') => (id ? (handles.get(id) ?? fallback) : fallback),
    [handles],
  )

  const value = useMemo<PosContextValue>(
    () => ({
      me: cfg.me,
      branch: cfg.branch,
      branchId: cfg.branch?.id ?? '',
      branches: cfg.branches,
      enabled: cfg.enabled,
      session: cfg.session,
      isTraining: cfg.session?.kind === 'training',
      points,
      pointsById,
      routes: cfg.routes,
      pointStaff: cfg.pointStaff,
      unsold: cfg.unsold,
      routing,
      menu,
      pricing,
      directory,
      colourOf,
      handleOf,
    }),
    [cfg, points, pointsById, routing, menu, pricing, directory, colourOf, handleOf],
  )

  const link = useMemo<PosLink>(
    () => ({ connection, online, menuStale, signedOut }),
    [connection, online, menuStale, signedOut],
  )

  return (
    <ActionsCtx.Provider value={actions}>
      <LinkCtx.Provider value={link}>
        <RefreshCtx.Provider value={refreshKey}>
          <PosCtx.Provider value={value}>{children}</PosCtx.Provider>
        </RefreshCtx.Provider>
      </LinkCtx.Provider>
    </ActionsCtx.Provider>
  )
}
