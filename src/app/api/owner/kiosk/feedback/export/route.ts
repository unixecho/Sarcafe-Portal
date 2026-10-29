import { NextResponse } from 'next/server'
import { apiRoute, BadRequest } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { CSV_BOM, csvLine } from '@/lib/pos/server/export'

// Every poll answer (hidden ones marked) as a spreadsheet. Full owner only, never cached. The suggestion is the public's
// free text, so every cell goes through the same formula-injection guard as the other exports.

const HEADERS = ['תאריך', 'הצבעות', 'דירוג', 'הצעה', 'מוסתר'] as const

const stamp = (iso: string) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))

export const GET = apiRoute(async () => {
  await requireOwner()
  const service = createServiceRoleClient()
  const [{ data: options, error: optionsError }, { data, error }] = await Promise.all([
    service.from('kiosk_feedback_options').select('id, label'),
    service
      .from('kiosk_feedback_responses')
      .select('option_ids, rating, suggestion, hidden, created_at')
      .order('created_at', { ascending: true })
      .limit(20000),
  ])
  if (optionsError || error) throw BadRequest('Could not export the answers.')

  const labels = new Map((options ?? []).map((o) => [o.id as string, o.label as string]))
  const lines = [csvLine(HEADERS)]
  for (const row of data ?? []) {
    lines.push(csvLine([
      stamp(row.created_at as string),
      ((row.option_ids as string[] | null) ?? []).map((id) => labels.get(id) ?? '').filter(Boolean).join(' | '),
      row.rating === null || row.rating === undefined ? '' : String(row.rating),
      (row.suggestion as string | null) ?? '',
      row.hidden ? 'כן' : 'לא',
    ]))
  }
  return new NextResponse(CSV_BOM + lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sarcafe-kiosk-poll.csv"',
      'Cache-Control': 'no-store',
    },
  })
})
