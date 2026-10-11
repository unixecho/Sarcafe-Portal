'use client'

import Link from 'next/link'
import { PosterPanel } from '@/components/shifts/SchedulePoster'
import { useShifts } from '@/components/shifts/ShiftsProvider'

// /owner/schedule/print, kept so every old link and bookmark still works. It used to
// be a plain black-on-white table for the browser's own print-to-PDF; it now shows
// the same poster as the share sheet (SchedulePoster.tsx) — share it, save it as a
// PDF or a picture, or print it. Only the picture prints; the buttons stay on screen.
export default function PrintView({ branchName }: { branchName: string }) {
  const { db, loading, weekStart } = useShifts()
  return (
    <div className="ew-printpage">
      <nav className="no-print ew-printpage__nav" aria-label="ניווט">
        <Link href="/owner/schedule">חזרה ללוח</Link>
        <Link href="/staff">בית</Link>
      </nav>
      <h1 className="no-print">שיתוף והדפסה</h1>
      {loading || !db ? <p className="no-print">טוען…</p> : <PosterPanel scope="everyone" weekStart={weekStart} branchName={branchName} />}
      <button type="button" className="no-print sch-btn press" onClick={() => window.print()} style={{ alignSelf: 'center' }}>
        הדפסה
      </button>
    </div>
  )
}
