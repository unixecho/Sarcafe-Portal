import 'server-only'

import { ApiError } from '@/lib/http/errors'
import type { createServiceRoleClient } from '@/lib/supabase/server'
import { TOOL_IDS } from './index'
import { MAX_QUERIES, MAX_USAGE_ENTRIES, type Usage } from './search'

// The tool finder's history, kept per PERSON so it follows them across devices (owner, 2026-11-05). Tables and functions:
// supabase/migrations/20261105090000_staff_tools_messages_qa_runs.sql. Before that migration is applied every call answers
// { synced: false } and the browser keeps the history on the device instead; nothing breaks.

type Service = ReturnType<typeof createServiceRoleClient>
export type StoredUsage = { synced: boolean; usage: Usage; queries: string[] }

/** PostgREST's "that table / function does not exist (yet)". */
export function isMissingObject(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === 'PGRST205' || error.code === 'PGRST202' || error.code === '42P01' || error.code === '42883' || /schema cache|does not exist/i.test(error.message ?? '')
}
const unavailable = () => new ApiError(503, 'unavailable', 'לא הצלחנו לשמור את ההיסטוריה כרגע')

export async function readToolUsage(service: Service, staffId: string): Promise<StoredUsage> {
  const [uses, searches] = await Promise.all([
    service.from('staff_tool_usage').select('tool_id, uses, last_used_at').eq('staff_id', staffId).order('last_used_at', { ascending: false }).limit(MAX_USAGE_ENTRIES),
    service.from('staff_tool_searches').select('query, searched_at').eq('staff_id', staffId).order('searched_at', { ascending: false }).limit(MAX_QUERIES),
  ])
  if (isMissingObject(uses.error) || isMissingObject(searches.error)) return { synced: false, usage: {}, queries: [] }
  if (uses.error || searches.error) throw unavailable()
  const usage: Usage = {}
  for (const row of (uses.data ?? []) as { tool_id: string; uses: number; last_used_at: string }[]) {
    if (!TOOL_IDS.has(row.tool_id)) continue // a tool that was removed from the index
    const t = Date.parse(row.last_used_at)
    usage[row.tool_id] = { n: Math.max(0, Math.min(100000, Number(row.uses) || 0)), t: Number.isFinite(t) ? t : 0 }
  }
  const queries = ((searches.data ?? []) as { query: string }[]).map((r) => r.query).filter((q) => typeof q === 'string')
  return { synced: true, usage, queries }
}

async function call(service: Service, fn: string, args: Record<string, unknown>): Promise<boolean> {
  const { error } = await service.rpc(fn, args)
  if (isMissingObject(error)) return false
  if (error) throw unavailable()
  return true
}

export const recordToolUse = (service: Service, staffId: string, toolId: string, query: string | null) =>
  call(service, 'staff_tool_usage_record', { p_staff_id: staffId, p_tool_id: toolId, p_query: query })
export const mergeToolUsage = (service: Service, staffId: string, usage: Usage) =>
  call(service, 'staff_tool_usage_merge', { p_staff_id: staffId, p_usage: usage })
export const resetToolUsage = (service: Service, staffId: string) => call(service, 'staff_tool_usage_reset', { p_staff_id: staffId })
