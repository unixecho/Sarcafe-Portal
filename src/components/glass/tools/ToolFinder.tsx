'use client'

import { useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { SearchField } from 'glisse'
import { ChevronLeft, History, Search, Zap } from 'lucide-react'
import { completeTools, didYouMean, highlight, recentTools, searchTools, suggestTools, type Hit, type Reason } from '@/lib/tools/search'
import { FINDER_ID } from '../GlassDock'
import { useTools } from './ToolsProvider'
import { toolIcon } from './toolIcons'

// The tool finder: type and it completes, suggests and ranks by what this person opens (on every device), their role and the
// time of day. It opens as the account menu's surface (.gl-pop). ARIA combobox: the input keeps focus, ↑ ↓ move, Enter opens,
// Tab accepts the completion, Esc closes.

const REASON: Record<Reason, string> = { now: 'מתאים עכשיו', frequent: 'בשימוש תכוף', recent: 'לאחרונה', match: '' }
const COMMON: Record<'op' | 'manager' | 'staff', string[]> = {
  op: ['הודעה לצוות', 'אזל', 'החלפה', 'פרסום', 'תלוש'],
  manager: ['הודעה לצוות', 'החלפה', 'אזל', 'חוסרים'],
  staff: ['החלפה', 'אילוץ', 'פתיחה', 'תלוש', 'מי עובד'],
}
type Row = { key: string; hit: Hit; section?: string }

function Marked({ text, q }: { text: string; q: string }) {
  return <>{highlight(text, q).map((part, i) => (part.m ? <mark key={i}>{part.t}</mark> : <span key={i}>{part.t}</span>))}</>
}

export default function ToolFinder({ placeholder = 'חיפוש כלי…' }: { placeholder?: string }) {
  const { ctx, queries, synced, badges, open: openTool, reset } = useTools()
  const uid = useId().replace(/:/g, '')
  const wrap = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  // glisse's clear button carries an English label; the page is Hebrew.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const fix = () => el.querySelectorAll('.lg-input-clear').forEach((b) => b.setAttribute('aria-label', 'ניקוי החיפוש'))
    fix()
    const mo = new MutationObserver(fix)
    mo.observe(el, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [])

  // The dock's "עוד" on a page without the finder comes home as <home>#tool-finder: arrive with the cursor in the search.
  useEffect(() => {
    if (window.location.hash !== `#${FINDER_ID}`) return
    const t = window.setTimeout(() => { wrap.current?.scrollIntoView({ block: 'start' }); input.current?.focus({ preventScroll: true }) }, 120)
    return () => window.clearTimeout(t)
  }, [])

  const trimmed = q.trim()
  const results = useMemo(() => (trimmed ? searchTools(trimmed, ctx) : []), [trimmed, ctx])
  const completions = useMemo(() => (trimmed ? completeTools(trimmed, ctx) : []), [trimmed, ctx])
  const mean = useMemo(() => (trimmed && !results.length ? didYouMean(trimmed, ctx) : null), [trimmed, results.length, ctx])
  const empty = useMemo(() => {
    const top = suggestTools(ctx, 5)
    const ids = new Set(top.map((h) => h.entry.id))
    return { top, recent: recentTools(ctx, 4).filter((h) => !ids.has(h.entry.id)).slice(0, 2) }
  }, [ctx])
  const rows: Row[] = useMemo(() => {
    if (trimmed) return results.map((hit) => ({ key: hit.entry.id, hit }))
    return [
      ...empty.top.map((hit, i) => ({ key: hit.entry.id, hit, section: i === 0 ? 'מומלץ לך עכשיו' : undefined })),
      ...empty.recent.map((hit, i) => ({ key: `r-${hit.entry.id}`, hit, section: i === 0 ? 'נפתחו לאחרונה' : undefined })),
    ]
  }, [trimmed, results, empty])
  useEffect(() => { setActive(0) }, [trimmed])
  useEffect(() => { if (open) document.getElementById(`${uid}-opt-${active}`)?.scrollIntoView({ block: 'nearest' }) }, [active, open, uid])

  const primary = ctx.roles.includes('op') ? 'op' : ctx.roles.includes('manager') ? 'manager' : 'staff'
  const chips = trimmed ? [] : queries.length ? queries : COMMON[primary]
  const listId = `${uid}-list`

  function pick(row: Row | undefined) {
    if (!row) return
    openTool(row.hit.entry, trimmed || undefined)
    setQ('')
    setOpen(false)
    input.current?.blur()
  }
  function accept(text: string) { setQ(`${text} `); setOpen(true); input.current?.focus() }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(Math.max(rows.length - 1, 0), i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { if (open && rows[active]) { e.preventDefault(); pick(rows[active]) } }
    else if (e.key === 'Tab' && open && completions[0] && !e.shiftKey) { e.preventDefault(); accept(completions[0]) }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false) }
  }
  function onBlur(e: FocusEvent) { if (!wrap.current?.contains(e.relatedTarget as Node | null)) setOpen(false) }

  let lastSection = ''
  return (
    <div className="gl-finder" id={FINDER_ID} ref={wrap} onBlur={onBlur}>
      <SearchField
        ref={input}
        id={`${uid}-input`}
        aria-label="חיפוש כלי"
        placeholder={placeholder}
        autoComplete="off"
        enterKeyHint="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && rows[active] ? `${uid}-opt-${active}` : undefined}
        value={q}
        onValueChange={(value) => { setQ(value.slice(0, 80)); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div className="gl-pop gl-finder__pop" onMouseDown={(e) => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault() }}>
          {completions.length > 0 && (
            <div className="gl-finder__row" aria-label="השלמות">
              <span className="gl-finder__label"><Zap size={13} aria-hidden="true" />השלמה</span>
              {completions.slice(0, 3).map((c, i) => (
                <button key={c} type="button" className="gl-chip gl-chip--soft" onClick={() => accept(c)}>
                  <span><Marked text={c} q={trimmed} /></span>{i === 0 && <kbd aria-hidden="true">Tab</kbd>}
                </button>
              ))}
            </div>
          )}
          <div role="listbox" id={listId} aria-label="תוצאות">
            {rows.map((row, i) => {
              const e = row.hit.entry
              const Icon = toolIcon(e.id)
              const head = row.section && row.section !== lastSection ? row.section : null
              if (row.section) lastSection = row.section
              const note = badges[e.id]
              return (
                <div key={row.key} role="presentation">
                  {head && <div className="gl-finder__head">{head}</div>}
                  <button type="button" role="option" id={`${uid}-opt-${i}`} aria-selected={i === active} tabIndex={-1} className={`lg-menu-item gl-finder__opt${i === active ? ' is-active' : ''}`} onMouseMove={() => setActive(i)} onClick={() => pick(row)}>
                    <span className="gl-finder__ico"><Icon size={18} strokeWidth={1.8} aria-hidden="true" /></span>
                    <span className="gl-finder__copy"><strong><Marked text={e.label} q={trimmed} /></strong><small>{e.hint}</small></span>
                    <span className="gl-finder__meta">
                      {note && <span className="gl-pill">{note}</span>}
                      {!note && row.hit.reason && REASON[row.hit.reason] && <span className="gl-pill gl-pill--quiet">{REASON[row.hit.reason]}</span>}
                      {e.kind === 'action' && <span className="gl-pill gl-pill--quiet">פעולה</span>}
                    </span>
                    <ChevronLeft size={16} className="gl-chev" aria-hidden="true" />
                  </button>
                </div>
              )
            })}
            {trimmed && results.length === 0 && (
              <div className="gl-finder__none" role="status">
                <Search size={20} aria-hidden="true" />
                <strong>לא מצאנו כלי בשם ״{trimmed}״</strong>
                {mean ? <button type="button" className="gl-chip gl-chip--soft" onClick={() => accept(mean)}>התכוונת ל־{mean}?</button> : <small>אפשר לנסות מילה אחרת, כמו ״הודעה״, ״אזל״ או ״החלפה״</small>}
              </div>
            )}
          </div>
          {chips.length > 0 && (
            <div className="gl-finder__row">
              <span className="gl-finder__label"><History size={13} aria-hidden="true" />{queries.length ? 'חיפשת לאחרונה' : 'חיפושים נפוצים'}</span>
              {chips.map((c) => <button key={c} type="button" className="gl-chip gl-chip--soft" onClick={() => { setQ(c); input.current?.focus() }}>{c}</button>)}
            </div>
          )}
          <div className="gl-finder__foot">
            <span>{synced ? 'ההמלצות לפי מה שפתחת בעבר בכל המכשירים, התפקיד והשעה' : 'ההמלצות לפי מה שפתחת בעבר במכשיר הזה, התפקיד והשעה'}</span>
            <button type="button" className="gl-finder__reset" onClick={reset}>איפוס</button>
          </div>
        </div>
      )}
      <p className="sr-only" aria-live="polite">{open && trimmed ? `${results.length} תוצאות` : ''}</p>
    </div>
  )
}
