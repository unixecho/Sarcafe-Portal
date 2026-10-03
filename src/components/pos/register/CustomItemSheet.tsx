'use client'

// "Another item": a hand-typed line for whatever is on the slip but not on the menu — free
// tap water needs a real line, so a price of 0 is valid. The cashier picks the point that
// makes it as plain tiles; the server re-checks that the point exists and is active.

import { useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import { formatAgorot } from '@/lib/pos/money'
import { normalizeNote, parsePriceInput } from '@/lib/pos/validate'
import type { LineInput, PosPoint } from '@/lib/pos/types'
import { LIMITS } from '@/lib/pos/vocab'
import { useT } from '@/lib/pos/useT'
import { haptic } from '@/lib/haptics'
import { safeColour } from '../shell/safeColour'

type CustomInput = Extract<LineInput, { custom: unknown }>

export type CustomItemRequest = { seq: number; initial?: CustomInput; editKey?: string }

type Props = {
  request: CustomItemRequest | null
  points: PosPoint[]
  defaultPointId: string
  onSubmit: (input: CustomInput, editKey?: string) => void
  onClose: () => void
}

const NAME_MAX = LIMITS.pointNameMax + 20 // the same cap priceLine() applies

export default function CustomItemSheet({ request, points, defaultPointId, onSubmit, onClose }: Props) {
  const last = useRef<CustomItemRequest | null>(null)
  if (request) last.current = request
  const shown = request ?? last.current
  return (
    <SheetShell open={!!request} onClose={onClose} labelledBy="reg-custom-title" className="reg-sheet">
      {shown && <Body key={shown.seq} req={shown} points={points} defaultPointId={defaultPointId} onSubmit={onSubmit} onClose={onClose} />}
    </SheetShell>
  )
}

function Body({ req, points, defaultPointId, onSubmit, onClose }: { req: CustomItemRequest } & Omit<Props, 'request'>) {
  const t = useT()
  const init = req.initial
  const [name, setName] = useState(init?.custom.name ?? '')
  const [price, setPrice] = useState(init ? String(init.custom.priceAgorot / 100).replace('.', ',') : '')
  const [pointId, setPointId] = useState(init?.custom.pointId ?? (points.some((p) => p.id === defaultPointId) ? defaultPointId : (points[0]?.id ?? '')))
  const [qty, setQty] = useState(init?.qty ?? 1)
  const [note, setNote] = useState(init?.note ?? '')

  const cleanName = normalizeNote(name, NAME_MAX)
  const agorot = parsePriceInput(price)
  const priceOk = agorot !== null && agorot <= LIMITS.customUnitAgorotMax
  const pointOk = points.some((p) => p.id === pointId)

  const why = !cleanName
    ? t('register.custom.needName')
    : price.trim() === ''
      ? t('register.custom.needPrice')
      : !priceOk
        ? t('register.custom.badPrice')
        : !pointOk
          ? t('register.custom.needPoint')
          : null

  function submit() {
    if (why || agorot === null || !cleanName) return
    haptic('impact')
    const forName = init?.forName
    onSubmit(
      {
        custom: { name: cleanName, priceAgorot: agorot, pointId },
        qty,
        ...(normalizeNote(note, LIMITS.lineNoteMax) ? { note: normalizeNote(note, LIMITS.lineNoteMax) } : {}),
        ...(forName ? { forName } : {}),
      },
      req.editKey,
    )
  }

  return (
    <form
      className="reg-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <header className="reg-cz-head">
        <h2 id="reg-custom-title" className="pos-sheet-title">{t('register.custom.title')}</h2>
      </header>

      <div className="sheet-scroll reg-cz-body">
        <label className="reg-label" htmlFor="reg-custom-name">{t('register.custom.name')}</label>
        <input
          id="reg-custom-name"
          className="pos-input reg-in"
          type="text"
          maxLength={NAME_MAX}
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label className="reg-label" htmlFor="reg-custom-price">{t('register.custom.price')}</label>
        <input
          id="reg-custom-price"
          className="pos-input reg-in ltr-isolate"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          dir="ltr"
          aria-invalid={price.trim() !== '' && !priceOk}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <p className="pos-hint">{t('register.custom.priceHint')}</p>

        {points.length > 1 && (
          <section className="reg-cz-sec" aria-labelledby="reg-custom-point">
            <h3 id="reg-custom-point" className="reg-cz-h"><span>{t('register.custom.point')}</span></h3>
            <div className="reg-chips" role="radiogroup" aria-labelledby="reg-custom-point">
              {points.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={pointId === p.id}
                  className={`reg-chip press${pointId === p.id ? ' is-on' : ''}`}
                  onClick={() => {
                    haptic('select')
                    setPointId(p.id)
                  }}
                >
                  <span className="reg-dot" style={{ background: safeColour(p.colour, '#9c9086') }} aria-hidden="true" />
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <label className="reg-label" htmlFor="reg-custom-note">{t('register.cz.note')}</label>
        <input
          id="reg-custom-note"
          className="pos-input reg-in"
          type="text"
          maxLength={LIMITS.lineNoteMax}
          autoComplete="off"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <footer className="reg-cz-foot">
        {why && (
          <p id="reg-custom-why" className="reg-why" role="status">{why}</p>
        )}
        <div className="reg-cz-actions">
          <div className="reg-stepper" role="group" aria-label={t('register.cz.qty')}>
            <button type="button" className="press" aria-label={t('register.cz.less')} aria-disabled={qty <= 1 || undefined} onClick={() => { haptic('tick'); setQty((q) => Math.max(1, q - 1)) }}>
              <Minus size={20} aria-hidden="true" />
            </button>
            <output className="ltr-isolate" aria-live="polite">{qty}</output>
            <button type="button" className="press" aria-label={t('register.cz.more')} aria-disabled={qty >= LIMITS.qtyMax || undefined} onClick={() => { haptic('tick'); setQty((q) => Math.min(LIMITS.qtyMax, q + 1)) }}>
              <Plus size={20} aria-hidden="true" />
            </button>
          </div>
          <button type="submit" className="pos-btn pos-btn--primary reg-cz-add press" disabled={!!why} aria-describedby={why ? 'reg-custom-why' : undefined}>
            <span>{req.editKey ? t('register.cz.update') : t('register.cz.add')}</span>
            {agorot !== null && priceOk && <span className="ltr-isolate">{formatAgorot(agorot * qty)}</span>}
          </button>
        </div>
        <button type="button" className="reg-cancel press" onClick={onClose}>{t('register.cancel')}</button>
      </footer>
    </form>
  )
}
