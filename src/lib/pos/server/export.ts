// CSV export — one row per order LINE, for the accountant and for the morning after.
//
// WHAT IS DELIBERATELY NOT HERE: the customer's phone. A spreadsheet is copied, mailed
// and kept forever; the phone is personal data with a retention clock, so it lives only
// in the manager screens. The columns are fixed by the brief.
//
// Opens in Excel with Hebrew intact because of the UTF-8 BOM. Cells are RFC-4180 quoted,
// and any text cell that begins with = + - @ (or a tab / CR) gets a leading apostrophe so
// a customer typing `=HYPERLINK(...)` as their name cannot run a formula on the owner's
// laptop. Money is written as plain decimals (12.50), never with a currency sign, so a
// SUM works.

import { ITEM_STATUSES } from '@/lib/pos/types'
import type { ItemStatus, PosItem, PosSession } from '@/lib/pos/types'
import type { ExportQuery } from '@/lib/pos/owner-api'
import { describeModifier } from '@/lib/pos/modifiers'
import { nameOf } from '@/lib/pos/format'
import { directoryMap, fetchAll, iso, readBranch, readDirectory, unwrap, type Service } from '@/lib/pos/server/readiness'
import { dateRangeMs, zonedParts } from '@/lib/pos/server/stats'

export const CSV_BOM = '﻿'

export const CSV_HEADERS = [
  'כרטיס', 'שעה', 'לקוח', 'נרשם על ידי', 'עמדה', 'פריט', 'תוספות', 'כמות', 'מחיר ליחידה', 'סכום',
  'מצב', 'התקבל על ידי', 'מוכן בשעה', 'נמסר על ידי', 'סיבת ביטול',
] as const

const STATUS_WORDS: Record<ItemStatus, string> = {
  sent: 'ממתין',
  preparing: 'בהכנה',
  ready: 'מוכן',
  delivered: 'נמסר',
  voided: 'בוטל',
}

/** One cell, safe to paste into a spreadsheet. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value)
  // Formula injection: Excel / Sheets treat a leading = + - @ (and tab / CR) as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvLine(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',')
}

/** 1250 -> "12.50". Integer agorot in, plain decimal out. */
export function agorotToDecimal(agorot: number): string {
  const sign = agorot < 0 ? '-' : ''
  const a = Math.abs(Math.round(agorot))
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`
}

const pad = (n: number) => String(n).padStart(2, '0')
function stamp(t: string | null, tz: string, withDate: boolean): string {
  if (!t) return ''
  const v = Date.parse(t)
  if (!Number.isFinite(v)) return ''
  const p = zonedParts(v, tz)
  const clock = `${pad(p.h)}:${pad(p.mi)}`
  return withDate ? `${p.y}-${pad(p.mo)}-${pad(p.d)} ${clock}` : clock
}

type ExportOrder = {
  id: string
  session_id: string
  ticket_no: number
  customer_name: string
  created_by_handle: string
  created_at: string
}
type ExportItem = Pick<
  PosItem,
  | 'order_id' | 'seq' | 'point_name' | 'name' | 'type_label' | 'variant_label' | 'modifiers' | 'qty' | 'unit_agorot'
  | 'status' | 'claimed_by' | 'ready_at' | 'delivered_by' | 'void_reason'
>

const ITEM_EXPORT_COLUMNS =
  'order_id, seq, point_name, name, type_label, variant_label, modifiers, qty, unit_agorot, status, claimed_by, ready_at, delivered_by, void_reason'
const ID_CHUNK = 120 // the ids travel in the URL; keep every request comfortably short

/** Builds the whole file in memory. An event is a few thousand lines — a few hundred KB. */
export async function buildCsv(
  service: Service,
  branch: { id: string; slug: string },
  query: ExportQuery
): Promise<{ csv: string; filename: string; rows: number }> {
  const [info, dirRead] = await Promise.all([readBranch(service, branch), readDirectory(service)])
  const dmap = directoryMap(dirRead.data)
  const tz = info.timezone

  const sessions = unwrap<Pick<PosSession, 'id' | 'kind'>[] | null>(
    await service.from('pos_sessions').select('id, kind').eq('branch_id', branch.id)
  ) ?? []
  const trainingIds = sessions.filter((s) => s.kind === 'training').map((s) => s.id)
  const explicit = query.session && query.session !== 'all' ? query.session : null
  const { fromMs, toMs } = dateRangeMs(query.from, query.to, tz)

  const orders = await fetchAll<ExportOrder>((from, to) => {
    let q = service
      .from('pos_orders')
      .select('id, session_id, ticket_no, customer_name, created_by_handle, created_at')
      .eq('branch_id', branch.id)
    if (explicit) q = q.eq('session_id', explicit)
    else if (query.training !== '1' && trainingIds.length > 0) q = q.not('session_id', 'in', `(${trainingIds.join(',')})`)
    if (fromMs !== null) q = q.gte('created_at', iso(fromMs))
    if (toMs !== null) q = q.lt('created_at', iso(toMs))
    return q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)
  })

  const itemsByOrder = new Map<string, ExportItem[]>()
  for (let i = 0; i < orders.length; i += ID_CHUNK) {
    const ids = orders.slice(i, i + ID_CHUNK).map((o) => o.id)
    const items = await fetchAll<ExportItem>((from, to) =>
      service
        .from('pos_order_items')
        .select(ITEM_EXPORT_COLUMNS)
        .in('order_id', ids)
        .order('order_id', { ascending: true })
        .order('seq', { ascending: true })
        .range(from, to)
    )
    for (const it of items) {
      const g = itemsByOrder.get(it.order_id)
      if (g) g.push(it)
      else itemsByOrder.set(it.order_id, [it])
    }
  }

  const handleOf = (id: string | null) => (id ? dmap.get(id)?.handle ?? '' : '')
  const lines: string[] = [csvLine(CSV_HEADERS)]
  let rows = 0
  for (const o of orders) {
    for (const it of itemsByOrder.get(o.id) ?? []) {
      const item = [nameOf(it.name, 'he'), it.type_label ? nameOf(it.type_label, 'he') : '', it.variant_label ?? '']
        .filter(Boolean)
        .join(' ')
      const mods = (it.modifiers ?? []).map((m) => describeModifier(m, 'he')).join('; ')
      lines.push(
        csvLine([
          `#${o.ticket_no}`,
          stamp(o.created_at, tz, true),
          o.customer_name,
          o.created_by_handle,
          it.point_name,
          item,
          mods,
          it.qty,
          agorotToDecimal(it.unit_agorot),
          agorotToDecimal(it.unit_agorot * it.qty),
          STATUS_WORDS[it.status] ?? (ITEM_STATUSES.includes(it.status) ? it.status : ''),
          handleOf(it.claimed_by),
          stamp(it.ready_at, tz, false),
          handleOf(it.delivered_by),
          it.status === 'voided' ? it.void_reason ?? '' : '',
        ])
      )
      rows += 1
    }
  }

  const day = stamp(new Date().toISOString(), tz, true).slice(0, 10)
  return { csv: CSV_BOM + lines.join('\r\n') + '\r\n', filename: `${info.slug}-orders-${day}.csv`, rows }
}
