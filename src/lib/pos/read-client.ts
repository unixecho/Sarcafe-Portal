'use client'

import type { PosReadQuery } from './api'

/** Opaque employee cookies authenticate this endpoint without granting browser database access. */
export async function readPos<T>(query: PosReadQuery, signal?: AbortSignal): Promise<{ data: T | null; error: unknown }> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value))
  const controller = signal ? null : new AbortController()
  const timeout = controller ? setTimeout(() => controller.abort(), 15000) : null
  try {
    const response = await fetch(`/api/pos/read?${params.toString()}`, { cache: 'no-store', credentials: 'same-origin', signal: signal ?? controller?.signal, headers: { accept: 'application/json' } })
    const body = await response.json() as { data?: T; error?: unknown }
    if (!response.ok || !('data' in body)) return { data: null, error: body.error ?? new Error('read failed') }
    return { data: body.data ?? null, error: null }
  } catch (error) { return { data: null, error } }
  finally { if (timeout) clearTimeout(timeout) }
}