'use client'

import { useEffect, useMemo, useState } from 'react'
import { FileDown, Image as ImageIcon, Share, X } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { buildPosterModel, type PosterModel, type PosterScope } from '@/lib/shifts/poster-model'
import { pdfFromJpeg } from '@/lib/shifts/poster-pdf'
import { canvasBlob, loadPosterAssets, renderPoster } from '@/lib/shifts/poster-render'

// The shareable week: a picture and a PDF in the Sarcafe look, made on the phone
// from the schedule already on screen (no server, nothing uploaded). Used by the
// employee's schedule, the manager's menu and the old print page, which are all the
// same poster, so a printed or shared week can never differ from another.

const SCENE_BRANCHES = ['maor', 'givat-haviva']

/** A different one of the branch's photographs each week, so a pinned poster is not the same picture forever. */
function sceneFor(branchSlug: string, weekStart: string): string | null {
  if (!SCENE_BRANCHES.includes(branchSlug)) return null
  const week = Math.floor(Date.parse(`${weekStart}T00:00:00Z`) / (7 * 86_400_000))
  return `/backdrops/${branchSlug}-${(week % 3) + 1}-wide.webp`
}

type PosterState = { canvas: HTMLCanvasElement | null; png: Blob | null; url: string | null; error: string | null }

function usePoster(scope: PosterScope, weekStart: string, branchName: string): PosterState & { model: PosterModel | null } {
  const { db, branchSlug } = useShifts()
  const model = useMemo(() => (db ? buildPosterModel(db, { weekStart, scope, branchName }) : null), [db, weekStart, scope, branchName])
  // The schedule is re-read every few seconds; only redraw when what the poster says has changed.
  const key = model ? JSON.stringify(model) : ''
  const [state, setState] = useState<PosterState>({ canvas: null, png: null, url: null, error: null })

  useEffect(() => {
    if (!model) return
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

function saveFile(blob: Blob, name: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
}

/** Preview + the actions: share (the phone's own share sheet), save as PDF, save the picture. */
export function PosterPanel({ scope, weekStart, branchName }: { scope: PosterScope; weekStart: string; branchName: string }) {
  const { model, canvas, png, url, error } = usePoster(scope, weekStart, branchName)
  const [busy, setBusy] = useState<'share' | 'pdf' | 'png' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const base = `sarcafe-${scope === 'mine' ? 'my-shifts' : 'schedule'}-${weekStart}`
  const title = model ? `${model.title} · ${model.rangeLabel}` : 'לוח משמרות'
  const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'

  async function pdf(): Promise<Blob> {
    const jpeg = await canvasBlob(canvas!, 'image/jpeg', 0.92)
    return new Blob([pdfFromJpeg(new Uint8Array(await jpeg.arrayBuffer()), canvas!.width, canvas!.height, title)], { type: 'application/pdf' })
  }

  // The phone's share sheet when it can take a file (WhatsApp, Messages, Save to Files, AirDrop…), a download when not.
  async function deliver(kind: 'share' | 'pdf' | 'png') {
    if (!canvas || !png) return
    setBusy(kind)
    setNote(null)
    try {
      const wantsPdf = kind === 'pdf'
      const blob = wantsPdf ? await pdf() : png
      const file = new File([blob], `${base}.${wantsPdf ? 'pdf' : 'png'}`, { type: blob.type })
      if (kind !== 'png' && canShareFiles && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title })
      else saveFile(blob, file.name)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setNote('לא הצלחנו לשתף. אפשר לשמור את הקובץ ולשלוח אותו משם.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="ew-share">
      <div className="ew-share__stage" aria-busy={!url && !error}>
        {url ? <img className="ew-poster" src={url} alt={`תצוגה מקדימה: ${title}`} /> : error ? <p className="sch-error" role="alert">{error}</p> : <div className="sk ew-poster ew-poster--loading" />}
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
      </div>
      {note && <p className="sch-sub" role="status">{note}</p>}
    </div>
  )
}

/** The sheet: pick whose week to share (employees choose between their own and everyone's), preview, share. */
export default function ScheduleShareSheet({
  open,
  onClose,
  weekStart,
  branchName,
  scopes,
}: {
  open: boolean
  onClose: () => void
  weekStart: string
  branchName: string
  scopes: PosterScope[]
}) {
  const [scope, setScope] = useState<PosterScope>(scopes[0]!)
  return (
    <SheetShell open={open} onClose={onClose} labelledBy="ew-share-title" className="sch-sheet">
      <div className="sch-sheet__head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id="ew-share-title" className="sch-sheet__title">
            שיתוף הלוח
          </h2>
          <p className="sch-sheet__sub">תמונה או PDF בעיצוב Sarcafe — אפשר לשלוח בוואטסאפ או לשמור.</p>
        </div>
        <button type="button" className="sch-iconbtn press" onClick={onClose} aria-label="סגירה">
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="sheet-scroll" style={{ gap: 14 }}>
        {scopes.length > 1 && (
          <div className="sch-segment" role="group" aria-label="מה לשתף">
            {scopes.map((s) => (
              <button key={s} type="button" aria-pressed={scope === s} className="press" onClick={() => setScope(s)}>
                {s === 'mine' ? 'המשמרות שלי' : 'הלוח המלא'}
              </button>
            ))}
          </div>
        )}
        {open && <PosterPanel scope={scope} weekStart={weekStart} branchName={branchName} />}
      </div>
    </SheetShell>
  )
}
