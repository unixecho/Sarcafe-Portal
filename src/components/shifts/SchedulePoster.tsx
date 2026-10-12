'use client'

import { useEffect, useMemo, useState } from 'react'
import { FileDown, Image as ImageIcon, Link2, Share, X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { buildPosterModel, type PosterModel, type PosterScope } from '@/lib/shifts/poster-model'
import { pdfFromJpeg } from '@/lib/shifts/poster-pdf'
import { canvasBlob, loadPosterAssets, renderPoster } from '@/lib/shifts/poster-render'
import { fileStem, scheduleLink, shareMessage } from '@/lib/shifts/share-text'
import type { ShiftsDB } from '@/lib/shifts/types'

// The shareable week: a picture and a PDF in the Sarcafe look, made on the phone
// from the schedule already on screen (no server, nothing uploaded). Used by the
// employee's schedule, the manager's menu and the old print page, which are all the
// same poster, so a printed or shared week can never differ from another.
//
// Every share carries the branch's name (in the picture, the PDF title, the file name
// and the message) and ends with a link to that branch's schedule page.

const SCENE_BRANCHES = ['maor', 'givat-haviva']

/** A different one of the branch's photographs each week, so a pinned poster is not the same picture forever. */
function sceneFor(branchSlug: string, weekStart: string): string | null {
  if (!SCENE_BRANCHES.includes(branchSlug)) return null
  const week = Math.floor(Date.parse(`${weekStart}T00:00:00Z`) / (7 * 86_400_000))
  return `/backdrops/${branchSlug}-${(week % 3) + 1}-wide.webp`
}

type PosterState = { canvas: HTMLCanvasElement | null; png: Blob | null; url: string | null; error: string | null }

function usePoster(db: ShiftsDB | null, branchSlug: string, scope: PosterScope, weekStart: string, branchName: string): PosterState & { model: PosterModel | null } {
  const model = useMemo(() => (db ? buildPosterModel(db, { weekStart, scope, branchName }) : null), [db, weekStart, scope, branchName])
  // The schedule is re-read every few seconds; only redraw when what the poster says has changed.
  const key = model ? JSON.stringify(model) : ''
  const [state, setState] = useState<PosterState>({ canvas: null, png: null, url: null, error: null })

  useEffect(() => {
    if (!model) {
      setState({ canvas: null, png: null, url: null, error: null })
      return
    }
    let cancelled = false
    let url: string | null = null
    ;(async () => {
      try {
        const family = getComputedStyle(document.body).fontFamily
        await Promise.all(['800 20px', '600 14px', '500 12px'].map((spec) => document.fonts.load(`${spec} ${family}`))).catch(() => undefined)
        const assets = await loadPosterAssets(sceneFor(branchSlug, weekStart))
        if (cancelled) return
        const canvas = renderPoster(model, assets, { scale: 2, fontFamily: family })
        const png = await canvasBlob(canvas, 'image/png')
        if (cancelled) return
        url = URL.createObjectURL(png)
        setState({ canvas, png, url, error: null })
      } catch {
        if (!cancelled) setState({ canvas: null, png: null, url: null, error: 'לא הצלחנו ליצור את התמונה. נסו שוב.' })
      }
    })()
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
    // `model` is captured through `key`: it is rebuilt every render but only matters when its content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, branchSlug, weekStart])

  return { model, ...state }
}

/** Another branch's week, read the same way the schedule itself is (the server decides what this person may see). */
function useOtherBranchDb(enabled: boolean, branchSlug: string, weekStart: string): { db: ShiftsDB | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ key: string; db: ShiftsDB | null; error: string | null }>({ key: '', db: null, error: null })
  const key = `${branchSlug}|${weekStart}`
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/shifts/state?branch=${encodeURIComponent(branchSlug)}&week=${weekStart}`, { cache: 'no-store' })
        const payload = await res.json().catch(() => null)
        if (!res.ok) throw new Error(payload?.error?.message ?? 'שגיאה בטעינת הלוח')
        if (!cancelled) setState({ key, db: payload.db as ShiftsDB, error: null })
      } catch (e) {
        if (!cancelled) setState({ key, db: null, error: e instanceof Error ? e.message : 'שגיאה בטעינת הלוח' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, key, branchSlug, weekStart])
  if (!enabled) return { db: null, loading: false, error: null }
  if (state.key !== key) return { db: null, loading: true, error: null }
  return { db: state.db, loading: false, error: state.error }
}

function saveFile(blob: Blob, name: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
}

/** Preview + the actions: share (the phone's own share sheet), save as PDF, save the picture, share the link. */
export function PosterPanel({
  scope,
  weekStart,
  branchName,
  branchSlug,
  db,
  loading,
  loadError,
}: {
  scope: PosterScope
  weekStart: string
  branchName: string
  /** Defaults to the branch of the surrounding schedule. */
  branchSlug?: string
  /** Defaults to the schedule already loaded by the surrounding provider. */
  db?: ShiftsDB | null
  loading?: boolean
  loadError?: string | null
}) {
  const own = useShifts()
  const slug = branchSlug ?? own.branchSlug
  const source = db === undefined ? own.db : db
  const { model, canvas, png, url, error } = usePoster(source, slug, scope, weekStart, branchName)
  const [busy, setBusy] = useState<'share' | 'pdf' | 'png' | 'link' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const base = fileStem({ scope, branchSlug: slug, weekStart })
  const title = model ? `${model.title} · ${branchName} · ${model.rangeLabel}` : `לוח משמרות · ${branchName}`
  const message = model ? shareMessage({ title: model.title, branchName, rangeLabel: model.rangeLabel, branchSlug: slug }) : scheduleLink(slug)
  const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'
  const shownError = loadError ?? error

  async function pdf(): Promise<Blob> {
    const jpeg = await canvasBlob(canvas!, 'image/jpeg', 0.92)
    return new Blob([pdfFromJpeg(new Uint8Array(await jpeg.arrayBuffer()), canvas!.width, canvas!.height, title)], { type: 'application/pdf' })
  }

  // The phone's share sheet when it can take a file (WhatsApp, Messages, Save to Files, AirDrop…), a download when not.
  // The message (branch, dates, and the link on its own last line) rides along with the file.
  async function deliver(kind: 'share' | 'pdf' | 'png') {
    if (!canvas || !png) return
    setBusy(kind)
    setNote(null)
    try {
      const wantsPdf = kind === 'pdf'
      const blob = wantsPdf ? await pdf() : png
      const file = new File([blob], `${base}.${wantsPdf ? 'pdf' : 'png'}`, { type: blob.type })
      if (canShareFiles && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title, text: message })
      else saveFile(blob, file.name)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setNote('לא הצלחנו לשתף. אפשר לשמור את הקובץ ולשלוח אותו משם.')
    } finally {
      setBusy(null)
    }
  }

  // Some apps drop the words when a file is attached, so the link can also go on its own.
  async function shareLink() {
    setBusy('link')
    setNote(null)
    try {
      if (typeof navigator.share === 'function') await navigator.share({ title, text: message })
      else {
        await navigator.clipboard.writeText(message)
        setNote('הקישור הועתק.')
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setNote('לא הצלחנו לשתף את הקישור.')
    } finally {
      setBusy(null)
    }
  }

  const waiting = !url && !shownError
  return (
    <div className="ew-share">
      <div className="ew-share__stage" aria-busy={waiting}>
        {url ? (
          <img className="ew-poster" src={url} alt={`תצוגה מקדימה: ${title}`} />
        ) : shownError ? (
          <p className="sch-error" role="alert">{shownError}</p>
        ) : (
          <div className="sk ew-poster ew-poster--loading" aria-label={loading ? 'טוען את הלוח' : undefined} />
        )}
      </div>
      <div className="ew-share__actions">
        <button type="button" className="sch-btn sch-btn--primary press" disabled={!url || !!busy} onClick={() => void deliver('share')}>
          <Share size={18} aria-hidden="true" /> {busy === 'share' ? 'מכין…' : canShareFiles ? 'שיתוף' : 'שמירת תמונה'}
        </button>
        <button type="button" className="sch-btn press" disabled={!url || !!busy} onClick={() => void deliver('pdf')}>
          <FileDown size={18} aria-hidden="true" /> {busy === 'pdf' ? 'מכין…' : 'שמירה כ־PDF'}
        </button>
        {canShareFiles && (
          <button type="button" className="sch-btn press" disabled={!url || !!busy} onClick={() => void deliver('png')}>
            <ImageIcon size={18} aria-hidden="true" /> שמירת תמונה
          </button>
        )}
        <button type="button" className="sch-btn press" disabled={!!busy} onClick={() => void shareLink()}>
          <Link2 size={18} aria-hidden="true" /> שיתוף קישור
        </button>
      </div>
      {note && <p className="sch-sub" role="status">{note}</p>}
    </div>
  )
}

export type ShareBranch = { slug: string; name: string }

/**
 * The sheet: pick the branch (when this person works with several), pick whose week to share
 * (employees choose between their own and everyone's), preview, share.
 */
export default function ScheduleShareSheet({
  open,
  onClose,
  weekStart,
  branchName,
  scopes,
  branches,
}: {
  open: boolean
  onClose: () => void
  weekStart: string
  branchName: string
  scopes: PosterScope[]
  /** Every branch this person may share; the one on screen is preselected. Omit for the current branch only. */
  branches?: ShareBranch[]
}) {
  const own = useShifts()
  const [scope, setScope] = useState<PosterScope>(scopes[0]!)
  const [picked, setPicked] = useState<string | null>(null)
  const options = branches && branches.length > 1 ? branches : null
  const slug = options?.some((b) => b.slug === picked) ? picked! : own.branchSlug
  const isOwn = slug === own.branchSlug
  const name = options?.find((b) => b.slug === slug)?.name ?? branchName
  const other = useOtherBranchDb(open && !isOwn, slug, weekStart)

  return (
    <SheetShell open={open} onClose={onClose} labelledBy="ew-share-title" className="sch-sheet">
      <div className="sch-sheet__head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id="ew-share-title" className="sch-sheet__title">
            שיתוף הלוח
          </h2>
          <p className="sch-sheet__sub">תמונה או PDF בעיצוב Sarcafe, עם שם הסניף וקישור ללוח — אפשר לשלוח בוואטסאפ או לשמור.</p>
        </div>
        <button type="button" className="sch-iconbtn press" onClick={onClose} aria-label="סגירה">
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      {(options || scopes.length > 1) && (
        <div className="ew-share__pickers">
          {options && (
            <div className="sch-segment" role="group" aria-label="איזה סניף לשתף">
              {options.map((b) => (
                <button key={b.slug} type="button" aria-pressed={slug === b.slug} className="press" onClick={() => setPicked(b.slug)}>
                  {b.name}
                </button>
              ))}
            </div>
          )}
          {scopes.length > 1 && (
            <div className="sch-segment" role="group" aria-label="מה לשתף">
              {scopes.map((s) => (
                <button key={s} type="button" aria-pressed={scope === s} className="press" onClick={() => setScope(s)}>
                  {s === 'mine' ? 'המשמרות שלי' : 'הלוח המלא'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {open && (
        <PosterPanel
          key={slug}
          scope={scope}
          weekStart={weekStart}
          branchName={name}
          branchSlug={slug}
          db={isOwn ? undefined : other.db}
          loading={!isOwn && other.loading}
          loadError={isOwn ? null : other.error}
        />
      )}
    </SheetShell>
  )
}
