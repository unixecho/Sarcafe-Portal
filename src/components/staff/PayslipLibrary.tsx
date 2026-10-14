'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Download, ExternalLink, Eye, FileArchive, FileText, X } from 'lucide-react'
import type { Payslip } from '@/lib/staff/records-types'

// The payslips list: read them in the page (a viewer you can step through month by month) instead of downloading each
// one, and pick several to download together as one zip. The files come through the same private routes as the single
// download, so who may see which payslip is decided on the server, not here.

const MAX_SELECTION = 100
const monthOf = (value: string) => new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' }).format(new Date(`${value.slice(0, 7)}-15T12:00:00Z`))
const shortMonth = (value: string) => new Intl.DateTimeFormat('he-IL', { month: 'short', year: '2-digit', timeZone: 'Asia/Jerusalem' }).format(new Date(`${value.slice(0, 7)}-15T12:00:00Z`))
const uploadedOn = (value: string) => new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeZone: 'Asia/Jerusalem' }).format(new Date(value))
// The column is NOT NULL and constrained to three types, but a list must never fail to render over one row.
const isImage = (type: string | null | undefined) => Boolean(type?.startsWith('image/'))
const viewHref = (id: string) => `/api/staff/payslips/${id}/view`
const downloadHref = (id: string) => `/api/staff/payslips/${id}`
const zipHref = (ids: string[]) => `/api/staff/payslips/zip?ids=${ids.join(',')}`

export default function PayslipLibrary({ payslips }: { payslips: Payslip[] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [viewing, setViewing] = useState<number | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const selectable = payslips.slice(0, MAX_SELECTION).map((slip) => slip.id)
  const everything = selectable.length > 0 && selectable.every((id) => selected.has(id))
  const chosen = payslips.filter((slip) => selected.has(slip.id)).map((slip) => slip.id)

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else if (next.size < MAX_SELECTION) next.add(id)
      return next
    })

  return (
    <>
      <div className="sr-bulk" role="group" aria-label="בחירה והורדה של כמה תלושים">
        <label className="sr-check">
          <input type="checkbox" checked={everything} onChange={() => setSelected(everything ? new Set() : new Set(selectable))} />
          <span>בחירת הכל</span>
        </label>
        <span className="sr-bulk__count" aria-live="polite">{chosen.length === 0 ? 'סמנו תלושים כדי להוריד אותם יחד' : chosen.length === 1 ? 'תלוש אחד נבחר' : `${chosen.length} תלושים נבחרו`}</span>
        {chosen.length > 0 ? (
          <a className="sr-action sr-action--small press" href={zipHref(chosen)} download>
            <FileArchive size={18} aria-hidden="true" />הורדה כ־ZIP
          </a>
        ) : (
          <button type="button" className="sr-action sr-action--small" disabled>
            <FileArchive size={18} aria-hidden="true" />הורדה כ־ZIP
          </button>
        )}
      </div>

      <ul className="sr-list">
        {payslips.map((slip, index) => (
          <li key={slip.id} className={selected.has(slip.id) ? 'sr-list__picked' : undefined}>
            <label className="sr-check sr-check--row">
              <input type="checkbox" checked={selected.has(slip.id)} onChange={() => toggle(slip.id)} aria-label={`בחירת תלוש ${monthOf(slip.pay_month)}`} />
            </label>
            <button
              type="button"
              className="sr-open press"
              aria-label={`צפייה בתלוש ${monthOf(slip.pay_month)}`}
              onClick={(event) => {
                opener.current = event.currentTarget
                setViewing(index)
              }}
            >
              <span className="sr-row-icon"><FileText size={20} aria-hidden="true" /></span>
              <span className="sr-open__copy">
                <strong>{monthOf(slip.pay_month)}</strong>
                <small>{isImage(slip.content_type) ? 'תמונה' : 'PDF'} · הועלה {uploadedOn(slip.uploaded_at)}</small>
              </span>
              <Eye size={19} aria-hidden="true" className="sr-open__eye" />
            </button>
            <a className="sr-download press" href={downloadHref(slip.id)} aria-label={`הורדת תלוש ${monthOf(slip.pay_month)}`}><Download size={20} aria-hidden="true" />הורדה</a>
          </li>
        ))}
      </ul>

      {viewing !== null && (
        <PayslipViewer
          payslips={payslips}
          index={viewing}
          onIndex={setViewing}
          onClose={() => {
            setViewing(null)
            opener.current?.focus()
          }}
        />
      )}
    </>
  )
}

function PayslipViewer({ payslips, index, onIndex, onClose }: { payslips: Payslip[]; index: number; onIndex: (index: number) => void; onClose: () => void }) {
  const slip = payslips[index]!
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const showAsImage = isImage(slip.content_type)
  const label = monthOf(slip.pay_month)

  useEffect(() => {
    setLoaded(false)
    setFailed(false)
    dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [slip.id])

  // While the viewer is open the page behind it does not scroll, and the focus starts on the close button.
  useEffect(() => {
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    return () => {
      document.body.style.overflow = before
    }
  }, [])

  const go = (to: number) => {
    if (to >= 0 && to < payslips.length) onIndex(to)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    } else if (event.key === 'ArrowRight') go(index - 1) // the page is right-to-left: right is the newer month
    else if (event.key === 'ArrowLeft') go(index + 1)
    else if (event.key === 'Tab' && dialog.current) {
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')]
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="sr-viewer" dir="rtl" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog} onKeyDown={onKeyDown}>
      <header className="sr-viewer__bar">
        <button ref={closeButton} type="button" className="sr-viewer__icon press" onClick={onClose} aria-label="סגירת הצפייה"><X size={22} aria-hidden="true" /></button>
        <div className="sr-viewer__title">
          <h2 id={titleId}>תלוש {label}</h2>
          <small>{index + 1} מתוך {payslips.length}</small>
        </div>
        <a className="sr-viewer__icon press" href={viewHref(slip.id)} target="_blank" rel="noopener noreferrer" aria-label="פתיחה בלשונית חדשה"><ExternalLink size={20} aria-hidden="true" /></a>
        <a className="sr-viewer__icon press" href={downloadHref(slip.id)} aria-label={`הורדת תלוש ${label}`}><Download size={20} aria-hidden="true" /></a>
      </header>

      {payslips.length > 1 && (
        <div className="sr-viewer__months" role="tablist" aria-label="חודשי שכר">
          {payslips.map((other, i) => (
            <button key={other.id} type="button" role="tab" aria-selected={i === index} className="press" onClick={() => go(i)}>{shortMonth(other.pay_month)}</button>
          ))}
        </div>
      )}

      <div className="sr-viewer__stage">
        {!loaded && !failed && <p className="sr-viewer__status" role="status">טוען את התלוש…</p>}
        {failed && <p className="sr-viewer__status" role="alert">לא הצלחנו להציג את התלוש כאן. <a href={viewHref(slip.id)} target="_blank" rel="noopener noreferrer">פתיחה בלשונית חדשה</a></p>}
        {showAsImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- a private, per-request image behind a session: not for the image optimiser
          <img key={slip.id} src={viewHref(slip.id)} alt={`תלוש שכר ${label}`} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
        ) : (
          <iframe key={slip.id} title={`תלוש שכר ${label}`} src={`${viewHref(slip.id)}#toolbar=0&navpanes=0&view=FitH`} onLoad={() => setLoaded(true)} />
        )}
      </div>

      <footer className="sr-viewer__nav">
        <button type="button" className="sr-action sr-action--ghost press" disabled={index === 0} onClick={() => go(index - 1)}>
          <ChevronRight size={20} aria-hidden="true" />חודש חדש יותר
        </button>
        <button type="button" className="sr-action sr-action--ghost press" disabled={index === payslips.length - 1} onClick={() => go(index + 1)}>
          חודש ישן יותר<ChevronLeft size={20} aria-hidden="true" />
        </button>
      </footer>
    </div>,
    document.body
  )
}
