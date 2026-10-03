'use client'

// FilterBar — and the small shared kit every ops screen leans on (one file,
// because the brief names a fixed set of files and these pieces are too small
// to deserve their own).
//
//   FilterBar / ChipGroup / FieldSelect / TextField / DateField / SwitchRow
//                      the filter controls (iOS-native: SelectSheet + Switch, never a native select)
//   Who                a person as a coloured disc + nickname (HandleChip needs <PosApp>, which
//                      the owner pages are not inside — so this is its owner-side twin)
//   OpsIcon            lucide name -> icon (the server and describeEvent() send names, not components)
//   Banner             one honest "could not load" / "could not refresh" strip
//   opsGet             typed fetch for /api/owner/pos/* — NEVER throws (a dropped Wi-Fi is a value)
//   useOpsResource     stale-while-revalidate: the old numbers stay on screen, dimmed, while the
//                      new ones load. A refetch must never blank or move anything.
//   usePagedRows       cursor pagination that appends and never re-keys the rows it already shows
//   BranchBar          the shared branch chips, hidden when there is only one
//
// Text a person reads goes through t(); a failure is worded by errorText(), never a code.

import {
  useCallback, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import {
  AtSign, Ban, Bell, BellRing, Check, ChevronDown, Circle, CircleAlert, CircleCheck, Eraser, Flame, GraduationCap,
  Hand, Hourglass, KeyRound, Layers, LogIn, LogOut, PackageX, Pencil, Play, Plus, Power, Receipt, Route, Settings,
  ShieldCheck, SlidersHorizontal, Square, Store, Timer, Undo2, X, type LucideIcon,
} from 'lucide-react'
import BranchSwitcher from '@/components/BranchSwitcher'
import SelectSheet, { type SelectOption } from '@/components/SelectSheet'
import Switch from '@/components/Switch'
import { haptic } from '@/lib/haptics'
import type { Branch } from '@/lib/branches'
import { handleInitial, staffColourMap } from '@/lib/pos/colour'
import type { StaffDirEntry } from '@/lib/pos/types'
import { useT } from '@/lib/pos/useT'
import { inkOn, safeColour } from '@/components/pos/shell/safeColour'
import { errorText } from '@/components/pos/shell/errorText'

// ---- time -----------------------------------------------------------------------------

/** A zone Intl accepts, else the bar's own. NEVER the viewer's: the server renders these rows
 *  first (in UTC on Vercel) and the browser must produce the identical text, or hydration
 *  disagrees about every time on the page. */
export const DEFAULT_ZONE = 'Asia/Jerusalem'
function zoneOrUndefined(tz?: string | null): string {
  if (!tz) return DEFAULT_ZONE
  try {
    new Intl.DateTimeFormat('he-IL', { timeZone: tz })
    return tz
  } catch {
    return DEFAULT_ZONE
  }
}

/** HH:MM (24 h) in the event's own time zone — a manager abroad still reads the bar's clock. */
export function clock(iso: string | null | undefined, tz?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zoneOrUndefined(tz) })
}

/** "14.9" — the day, for rows that are not from today. */
export function dayLabel(iso: string | null | undefined, tz?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: zoneOrUndefined(tz) })
}

/** Today's date and this one's, compared in the event's zone. */
export function isSameDay(a: string, b: number, tz?: string | null): boolean {
  const z = zoneOrUndefined(tz)
  const f = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: z })
  return f(Date.parse(a)) === f(b)
}

// ---- icons ----------------------------------------------------------------------------

const ICONS: Record<string, LucideIcon> = {
  receipt: Receipt, plus: Plus, pencil: Pencil, flame: Flame, bell: Bell, hand: Hand, check: Check, 'undo-2': Undo2,
  x: X, ban: Ban, 'circle-check': CircleCheck, play: Play, square: Square, eraser: Eraser, store: Store, route: Route,
  'log-in': LogIn, 'log-out': LogOut, 'at-sign': AtSign, 'key-round': KeyRound, settings: Settings,
  'shield-check': ShieldCheck, circle: Circle, 'graduation-cap': GraduationCap, power: Power, timer: Timer,
  layers: Layers, 'package-x': PackageX, 'bell-ring': BellRing, hourglass: Hourglass,
}

export function OpsIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = ICONS[name] ?? Circle
  return <Icon size={size} strokeWidth={2.1} aria-hidden="true" />
}

// ---- people ---------------------------------------------------------------------------

/** The colour of anyone in a directory (always a safe #rrggbb). Memoised on the directory. */
export function useColours(directory: readonly StaffDirEntry[]): (id: string | null | undefined) => string {
  const map = useMemo(() => staffColourMap(directory), [directory])
  return useCallback((id) => safeColour(id ? map.get(id) : null, '#9c9086'), [map])
}

export function Who({ handle, colour }: { handle: string | null | undefined; colour?: string | null }) {
  const c = safeColour(colour, '#9c9086')
  return (
    <span className="ops-who">
      <span className="ops-avatar" aria-hidden="true" style={{ background: c, color: inkOn(c) }}>
        {handleInitial(handle)}
      </span>
      <span className="ops-who-name">{handle?.trim() || '—'}</span>
    </span>
  )
}

// ---- small shared surfaces ------------------------------------------------------------

export function Banner({
  tone = 'warn', icon, children, action,
}: { tone?: 'warn' | 'danger' | 'info'; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`ops-banner ops-banner--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="ops-banner-icon" aria-hidden="true">{icon ?? <CircleAlert size={18} />}</span>
      <span className="ops-banner-text">{children}</span>
      {action}
    </div>
  )
}

export function BranchBar({
  branches, value, onChange, disabled,
}: { branches: Branch[]; value: string; onChange: (slug: string) => void; disabled?: boolean }) {
  if (branches.length < 2) return null
  return (
    <div className="ops-branchbar">
      <BranchSwitcher branches={branches} value={value} onChange={onChange} disabled={disabled} />
    </div>
  )
}

// ---- network --------------------------------------------------------------------------

export type Fetched<T> = { ok: true; data: T } | { ok: false; code: string }

const TIMEOUT_MS = 15_000

function codeForStatus(status: number): string {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'internal_error'
  return 'bad_request'
}

/** GET /api/owner/pos/<path>. Never throws; an unknown query value is simply left out. */
export async function opsGet<T>(path: string, params: Record<string, string | undefined>): Promise<Fetched<T>> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, v)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`/api/owner/pos/${path}?${qs.toString()}`, {
      cache: 'no-store', credentials: 'same-origin', signal: ctl.signal,
    })
    // An expired sign-in is bounced to /login and fetch follows it: that is "sign in again", not "flaky".
    if (res.redirected && /\/login/.test(res.url)) return { ok: false, code: 'unauthorized' }
    const text = await res.text()
    let body: unknown = null
    try {
      body = JSON.parse(text)
    } catch {
      /* a captive portal's HTML */
    }
    if (!res.ok) {
      const code = (body as { error?: { code?: unknown } } | null)?.error?.code
      return { ok: false, code: typeof code === 'string' ? code : codeForStatus(res.status) }
    }
    if (body === null || typeof body !== 'object') return { ok: false, code: 'network' }
    return { ok: true, data: body as T }
  } catch {
    return { ok: false, code: 'network' }
  } finally {
    clearTimeout(timer)
  }
}

/** One screen's data: the last good answer stays up while the next one loads. */
export function useOpsResource<T>(
  path: string,
  params: Record<string, string | undefined>,
  initial: T | null,
) {
  const key = JSON.stringify([path, params])
  const paramsRef = useRef(params)
  paramsRef.current = params
  const [state, setState] = useState<{ data: T | null; failed: string | null; busy: boolean }>({
    data: initial, failed: null, busy: false,
  })
  const seq = useRef(0)
  const firstKey = useRef(initial ? key : null)

  const load = useCallback(async () => {
    const mine = ++seq.current
    setState((s) => (s.busy ? s : { ...s, busy: true }))
    const r = await opsGet<T>(path, paramsRef.current)
    if (mine !== seq.current) return // a newer request owns the screen
    if (r.ok) setState({ data: r.data, failed: null, busy: false })
    else setState((s) => ({ data: s.data, failed: r.code, busy: false }))
    // `key` already encodes path + params
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    // The server-rendered first paint is already the answer for the first key.
    if (firstKey.current === key) {
      firstKey.current = null
      return
    }
    void load()
  }, [key, load])

  return { ...state, reload: load }
}

type PageShape<R> = { rows: R[]; nextCursor: string | null; directory: StaffDirEntry[] }

/** Cursor pagination that APPENDS: the rows already on screen keep their identity. */
export function usePagedRows<R>(
  path: string,
  params: Record<string, string | undefined>,
  initial: PageShape<R> | null,
  rowKey: (r: R) => string | number,
) {
  const key = JSON.stringify([path, params])
  const paramsRef = useRef(params)
  paramsRef.current = params
  const [rows, setRows] = useState<R[]>(initial?.rows ?? [])
  const [cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null)
  const [directory, setDirectory] = useState<StaffDirEntry[]>(initial?.directory ?? [])
  const [loaded, setLoaded] = useState(initial !== null)
  const [busy, setBusy] = useState(false)
  const [moreBusy, setMoreBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const seq = useRef(0)
  const firstKey = useRef(initial ? key : null)
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor

  const first = useCallback(async () => {
    const mine = ++seq.current
    setBusy(true)
    const r = await opsGet<PageShape<R>>(path, paramsRef.current)
    if (mine !== seq.current) return
    setBusy(false)
    if (!r.ok) {
      setFailed(r.code)
      return
    }
    setFailed(null)
    setRows(r.data.rows)
    setCursor(r.data.nextCursor)
    setDirectory(r.data.directory)
    setLoaded(true)
    setMoreBusy(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const more = useCallback(async () => {
    const c = cursorRef.current
    if (!c) return
    const mine = ++seq.current
    setMoreBusy(true)
    const r = await opsGet<PageShape<R>>(path, { ...paramsRef.current, cursor: c })
    if (mine !== seq.current) return
    setMoreBusy(false)
    if (!r.ok) {
      setFailed(r.code)
      return
    }
    setFailed(null)
    setRows((prev) => {
      const seen = new Set(prev.map(rowKey))
      return [...prev, ...r.data.rows.filter((x) => !seen.has(rowKey(x)))]
    })
    setCursor(r.data.nextCursor)
    setDirectory((d) => (r.data.directory.length ? r.data.directory : d))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (firstKey.current === key) {
      firstKey.current = null
      return
    }
    void first()
  }, [key, first])

  return { rows, directory, loaded, busy, moreBusy, failed, hasMore: cursor !== null, more, reload: first }
}

/** What a failure says, in plain words (no codes). */
export function useFailureText(): (code: string | null) => string {
  const t = useT()
  return useCallback((code) => errorText(t, code), [t])
}

// ---- filter controls ------------------------------------------------------------------

export function FilterBar({
  children, activeCount, onReset, busy,
}: { children: ReactNode; activeCount: number; onReset: () => void; busy?: boolean }) {
  const t = useT()
  // On a phone the controls fold behind one button; from 720px up they are always laid out.
  const [open, setOpen] = useState(false)
  return (
    <section className="ops-filter" aria-label={t('owner.ops.filter.title')} aria-busy={busy || undefined}>
      <div className="ops-filter-head">
        <button
          type="button"
          className="ops-filter-toggle press"
          aria-expanded={open}
          onClick={() => {
            haptic()
            setOpen((o) => !o)
          }}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
          <span>{t('owner.ops.filter.title')}</span>
          {activeCount > 0 && <span className="ops-count-badge">{activeCount}</span>}
          <ChevronDown size={16} aria-hidden="true" className="ops-filter-chev" data-open={open} />
        </button>
        {activeCount > 0 && (
          <button type="button" className="ops-link-btn press" onClick={onReset}>
            <X size={16} aria-hidden="true" />
            {t('owner.ops.filter.reset')}
          </button>
        )}
      </div>
      <div className={`ops-filter-body${open ? ' is-open' : ''}`}>{children}</div>
    </section>
  )
}

export function Field({ label, children, grow }: { label: string; children: ReactNode; grow?: boolean }) {
  // The label is real text on the group; SelectSheet and the inputs carry their own accessible names.
  return (
    <div className={`ops-field${grow ? ' ops-field--grow' : ''}`}>
      <span className="ops-field-label">{label}</span>
      {children}
    </div>
  )
}

export function ChipGroup({
  label, value, options, onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string; icon?: ReactNode }[]
  onChange: (v: string) => void
}) {
  return (
    <Field label={label}>
      <div className="ops-chips" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="ops-chip press"
            aria-pressed={o.value === value}
            onClick={() => {
              haptic()
              onChange(o.value)
            }}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
    </Field>
  )
}

export function FieldSelect({
  label, value, options, placeholder, onChange,
}: { label: string; value: string; options: SelectOption[]; placeholder: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <SelectSheet label={label} value={value} options={options} placeholder={placeholder} onChange={onChange} />
    </Field>
  )
}

export function TextField({
  label, value, onChange, placeholder, inputMode,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  inputMode?: 'text' | 'search'
}) {
  return (
    <label className="ops-field ops-field--grow">
      <span className="ops-field-label">{label}</span>
      <input
        className="ops-input"
        type="search"
        inputMode={inputMode ?? 'search'}
        enterKeyHint="search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

export function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="ops-field">
      <span className="ops-field-label">{label}</span>
      <input className="ops-input ltr-isolate" type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

export function SwitchRow({
  label, hint, on, onChange,
}: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="ops-switch press"
      onClick={() => {
        haptic()
        onChange(!on)
      }}
    >
      <span className="ops-switch-text">
        <span>{label}</span>
        {hint && <span className="ops-switch-hint">{hint}</span>}
      </span>
      <Switch on={on} />
    </button>
  )
}
