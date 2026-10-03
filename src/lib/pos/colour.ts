// Staff colours. Pure.
//
// When `staff.colour` is null the colour is assigned by DETERMINISTIC ROUND-ROBIN
// over the id-sorted people who have none — never a hash. Ayeka measured a
// hash-mod-8 landing 3 of 5 people on the same colour; round-robin is
// collision-free for up to as many people as the palette has colours, and every
// device computes the identical assignment on its own with no coordination.

import type { StaffDirEntry } from './types'
import { STAFF_FALLBACK_PALETTE } from './vocab'

export function staffColourMap(directory: readonly StaffDirEntry[]): Map<string, string> {
  const out = new Map<string, string>()
  const colourless: string[] = []
  const taken = new Set<string>()
  for (const e of directory) {
    if (e.colour) {
      out.set(e.id, e.colour)
      taken.add(e.colour.toLowerCase())
    } else colourless.push(e.id)
  }
  colourless.sort()
  // Hand out the palette colours nobody has CHOSEN first: an explicit `staff.colour` that happens
  // to equal a palette entry would otherwise give two people the same colour while the palette
  // still has free ones. Only when every colour is taken does the cycle reuse one. The result
  // stays deterministic and order-independent — it depends only on the directory's contents.
  const free = STAFF_FALLBACK_PALETTE.filter((c) => !taken.has(c.toLowerCase()))
  const pool: readonly string[] = free.length > 0 ? free : STAFF_FALLBACK_PALETTE
  colourless.forEach((id, i) => out.set(id, pool[i % pool.length] as string))
  return out
}

/** The one-letter avatar disc: first character of the handle. */
export function handleInitial(handle: string | null | undefined): string {
  const first = Array.from((handle ?? '').trim())[0]
  return first ? first.toUpperCase() : '?'
}
