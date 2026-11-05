'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Seg from '@/components/glass/Seg'
import type { QaSuite } from '@/lib/qa/report'

// The two reports of every run, one tap apart (owner, 2026-11-05): the dashboard's and the kiosk's. Each label carries its status.
const MARK = { pass: '✓', warn: '!', fail: '✗' } as const
export default function QaSuiteSwitch({ suite, suites }: { suite: QaSuite; suites: Record<QaSuite, 'pass' | 'warn' | 'fail' | null> }) {
  const router = useRouter()
  const label = (s: QaSuite, name: string) => `${name}${suites[s] ? ` ${MARK[suites[s]!]}` : ''}`
  return (
    <Seg fill label="הדוח של" value={suite} onChange={(v) => router.replace(`/staff/dev/qa?suite=${v}`)}
      items={[{ value: 'dashboard', label: label('dashboard', 'לוח הבקרה') }, { value: 'kiosk', label: label('kiosk', 'הקיוסק') }]} />
  )
}

/** Opened from the 07:00 notification on a failure (?focus=problems): straight to the problems, which glow for a moment. */
export function FocusProblems({ on }: { on: boolean }) {
  useEffect(() => {
    if (!on) return
    const el = document.getElementById('problems')
    if (!el) return
    const t = window.setTimeout(() => {
      el.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      el.classList.add('qa-problems--focus')
    }, 250)
    return () => window.clearTimeout(t)
  }, [on])
  return null
}
