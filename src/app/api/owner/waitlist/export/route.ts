import { NextResponse } from 'next/server'
import { apiRoute, BadRequest } from '@/lib/http/errors'
import { requireOwner } from '@/lib/owner/guard'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { CSV_BOM, csvLine } from '@/lib/pos/server/export'

// The sign-up list as a spreadsheet. Full owner only, re-checked on every call, never cached. Cells go through the
// same formula-injection guard as the order export (a name typed as =HYPERLINK(...) cannot run on the owner's laptop).

const HEADERS = ['שם פרטי', 'טלפון', 'דוא״ל', 'הסכמה לשיווק', 'נרשם/ה', 'התעניינות אחרונה'] as const

function stamp(iso: string): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
  return parts
}

export const GET = apiRoute(async () => {
  await requireOwner()
  const service = createServiceRoleClient()
  const { data, error } = await service
    .from('customer_waitlist_contacts')
    .select('first_name, normalized_phone, email, current_marketing_consent, created_at, last_interest_at')
    .order('created_at', { ascending: true })
    .limit(10000)
  if (error) throw BadRequest('Could not export the list.')

  const lines = [csvLine(HEADERS)]
  for (const row of data ?? []) {
    lines.push(csvLine([
      row.first_name as string,
      // 054-1234567: the dash keeps Excel from reading it as a number and dropping the leading zero
      `${(row.normalized_phone as string).slice(0, 3)}-${(row.normalized_phone as string).slice(3)}`,
      (row.email as string | null) ?? '',
      row.current_marketing_consent ? 'כן' : 'לא',
      stamp(row.created_at as string),
      stamp(row.last_interest_at as string),
    ]))
  }
  return new NextResponse(CSV_BOM + lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sarcafe-club-signups.csv"',
      'Cache-Control': 'no-store',
    },
  })
})
