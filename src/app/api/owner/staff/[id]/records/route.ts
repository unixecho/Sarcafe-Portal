import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireOwner } from '@/lib/owner/guard'
import { loadStaffRecords, privateStaffRoute } from '@/lib/staff/records'

export const GET = privateStaffRoute(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await requireOwner()
  const id = z.string().uuid().parse((await params).id)
  return NextResponse.json(await loadStaffRecords(id, true), { headers: { 'Cache-Control': 'private, no-store' } })
})
