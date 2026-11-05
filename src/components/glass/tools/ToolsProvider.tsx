'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { clearDashboardBranchConfirmed } from '@/lib/branches/current'
import { THEME_ROW_ID } from '@/lib/staff/theme'
import { TOOLS, toolById, type ToolEntry, type ToolRole } from '@/lib/tools'
import { cleanQuery, MAX_QUERIES, MAX_USAGE_ENTRIES, type Context, type Usage } from '@/lib/tools/search'
import { glassToast } from '../toast'

// The person's tool history and the one "open this tool" handler shared by the finder, the shortcuts and the tool lists.
// History follows the PERSON across devices through /api/staff/tool-usage. Until the migration is applied the API answers
// synced:false and the history stays on this device (localStorage); the first time sync works, the device's history is merged
// into the account once and the local copy is cleared.

type State = { usage: Usage; queries: string[]; synced: boolean | null }
type Value = { ctx: Context; queries: string[]; synced: boolean | null; badges: Record<string, string>; home: string; open: (entry: ToolEntry, query?: string) => void; track: (entry: ToolEntry) => void; reset: () => void }
const ToolsCtx = createContext<Value | null>(null)
export const TOOL_BADGES_EVENT = 'sarcafe:tool-badges'

const localKey = (staffId: string) => `sarcafe.tools.v1:${staffId}`
function readLocal(staffId: string): { usage: Usage; queries: string[] } {
  try {
    const raw = JSON.parse(window.localStorage.getItem(localKey(staffId)) ?? 'null') as { usage?: Usage; queries?: string[] } | null
    const usage: Usage = {}
    for (const [id, u] of Object.entries(raw?.usage ?? {})) if (toolById(id) && u && Number.isFinite(u.n) && Number.isFinite(u.t)) usage[id] = { n: Math.min(100000, Math.max(1, Math.round(u.n))), t: u.t }
    return { usage, queries: Array.isArray(raw?.queries) ? raw!.queries.filter((q) => typeof q === 'string').slice(0, MAX_QUERIES) : [] }
  } catch { return { usage: {}, queries: [] } }
}
function writeLocal(staffId: string, usage: Usage, queries: string[]) {
  try { window.localStorage.setItem(localKey(staffId), JSON.stringify({ usage, queries })) } catch { /* private mode: not kept */ }
}
function clearLocal(staffId: string) { try { window.localStorage.removeItem(localKey(staffId)) } catch { /* nothing to clear */ } }

async function post(body: unknown): Promise<{ ok: boolean; synced: boolean }> {
  try {
    const response = await fetch('/api/staff/tool-usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true })
    if (!response.ok) return { ok: false, synced: false }
    const data = (await response.json()) as { synced?: boolean }
    return { ok: true, synced: data.synced === true }
  } catch { return { ok: false, synced: false } }
}

export function ToolsProvider({ staffId, roles, hour, badges = {}, home, children }: { staffId: string; roles: ToolRole[]; hour: number; badges?: Record<string, string>; home: string; children: ReactNode }) {
  const router = useRouter()
  const [state, setState] = useState<State>({ usage: {}, queries: [], synced: null })
  const synced = useRef<boolean | null>(null)
  // The pills follow the dashboard's branch: DashboardLive announces new ones after a switch (TOOL_BADGES_EVENT).
  const [liveBadges, setLiveBadges] = useState(badges)
  useEffect(() => {
    const onBadges = (event: Event) => { const detail = (event as CustomEvent<Record<string, string>>).detail; if (detail && typeof detail === 'object') setLiveBadges(detail) }
    window.addEventListener(TOOL_BADGES_EVENT, onBadges)
    return () => window.removeEventListener(TOOL_BADGES_EVENT, onBadges)
  }, [])

  useEffect(() => {
    let alive = true
    const local = readLocal(staffId)
    setState({ ...local, synced: null })
    void (async () => {
      try {
        const response = await fetch('/api/staff/tool-usage', { cache: 'no-store' })
        if (!response.ok) throw new Error('usage')
        const server = (await response.json()) as { synced: boolean; usage: Usage; queries: string[] }
        if (!alive) return
        if (!server.synced) { synced.current = false; setState({ ...local, synced: false }); return }
        synced.current = true
        // This device used the finder before the history was kept on the account: hand it over once.
        if (Object.keys(local.usage).length) {
          const merged = await post({ op: 'merge', usage: Object.fromEntries(Object.entries(local.usage).slice(0, MAX_USAGE_ENTRIES)) })
          if (merged.ok && merged.synced) clearLocal(staffId)
        }
        const usage: Usage = { ...server.usage }
        for (const [id, u] of Object.entries(local.usage)) { const s = usage[id]; usage[id] = s ? { n: Math.max(s.n, u.n), t: Math.max(s.t, u.t) } : u }
        setState({ usage, queries: server.queries.length ? server.queries : local.queries, synced: true })
      } catch {
        if (alive) { synced.current = false; setState({ ...local, synced: false }) }
      }
    })()
    return () => { alive = false }
  }, [staffId])

  const remember = useCallback((id: string, query?: string) => {
    const q = cleanQuery(query)
    setState((s) => {
      const usage = { ...s.usage, [id]: { n: Math.min(100000, (s.usage[id]?.n ?? 0) + 1), t: Date.now() } }
      const queries = q ? [q, ...s.queries.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX_QUERIES) : s.queries
      if (synced.current !== true) writeLocal(staffId, usage, queries)
      return { ...s, usage, queries }
    })
    if (synced.current === true) void post({ op: 'use', id, ...(q ? { q } : {}) })
  }, [staffId])

  const open = useCallback((entry: ToolEntry, query?: string) => {
    if (entry.soon) return
    remember(entry.id, query)
    switch (entry.action) {
      case 'compose': {
        const card = document.getElementById('team-message')
        if (card) { card.scrollIntoView({ block: 'start', behavior: 'smooth' }); window.setTimeout(() => document.getElementById('team-message-text')?.focus({ preventScroll: true }), 380); return }
        router.push(`${home}#team-message`)
        return
      }
      case 'look': {
        const row = document.getElementById(THEME_ROW_ID)
        if (row) { row.scrollIntoView({ block: 'center' }); (row as HTMLButtonElement).click(); return }
        break
      }
      case 'push': {
        const card = document.querySelector('.app-push')
        if (card) { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); return }
        break
      }
      case 'signout':
        void (async () => {
          try {
            const response = await fetch('/api/auth/signout', { method: 'POST' })
            if (!response.ok) throw new Error('signout')
            clearDashboardBranchConfirmed()
            router.push('/login')
            router.refresh()
          } catch { glassToast('ההתנתקות לא הצליחה. נסו שוב.', 'bad') }
        })()
        return
    }
    router.push(entry.href)
  }, [home, remember, router])

  const reset = useCallback(() => {
    clearLocal(staffId)
    setState((s) => ({ ...s, usage: {}, queries: [] }))
    if (synced.current === true) void post({ op: 'reset' }).then((r) => glassToast(r.ok ? 'היסטוריית החיפוש נמחקה בכל המכשירים' : 'לא הצלחנו למחוק את ההיסטוריה', r.ok ? 'ok' : 'bad'))
    else glassToast('היסטוריית החיפוש נמחקה במכשיר הזה', 'ok')
  }, [staffId])

  /** A plain link was followed (a tool row): only remember it, the link does the navigation. */
  const track = useCallback((entry: ToolEntry) => remember(entry.id), [remember])
  // The home screen's tool lists are plain links (DashboardSections inside [data-track-tools]); a click there counts as a use too.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('[data-track-tools] a[href]') as HTMLAnchorElement | null
      if (!link) return
      const path = link.getAttribute('href') ?? ''
      const entry = TOOLS.find((t) => !t.action && !t.soon && t.href === path)
      if (entry) remember(entry.id)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [remember])
  const ctx: Context = useMemo(() => ({ roles, hour, usage: state.usage }), [roles, hour, state.usage])
  const value = useMemo(() => ({ ctx, queries: state.queries, synced: state.synced, badges: liveBadges, home, open, track, reset }), [ctx, state.queries, state.synced, liveBadges, home, open, track, reset])
  return <ToolsCtx.Provider value={value}>{children}</ToolsCtx.Provider>
}

export function useTools(): Value {
  const value = useContext(ToolsCtx)
  if (!value) throw new Error('useTools() outside <ToolsProvider>')
  return value
}
