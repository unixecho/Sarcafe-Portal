'use client'

// One line on the ticket: `{qty}× name · type · size`, the modifiers under it (add green,
// remove red, everything else neutral — colour is never alone: "+" and "בלי" say the same),
// who it is for and any note, and − / + on the side. A tap on the text re-opens Customize.
//
// "− at 1 removes": the cashier never needs a separate delete control for the common case.
// A line that can no longer be sold (sold out since it was added) says so, names itself, and
// swaps the stepper for a remove button — it is never silently dropped.

import { memo } from 'react'
import { AlertTriangle, Minus, Plus, Trash2 } from 'lucide-react'
import { lineTotal, pickName, type CartLine } from '@/lib/pos/cart'
import { describeModifier } from '@/lib/pos/modifiers'
import { formatAgorot } from '@/lib/pos/money'
import type { LineProblemCode } from '@/lib/pos/types'
import { LIMITS } from '@/lib/pos/vocab'
import { useT } from '@/lib/pos/useT'
import { haptic } from '@/lib/haptics'
import { errorText } from '../shell/errorText'

type Props = {
  line: CartLine
  lang: 'he' | 'en'
  problem: LineProblemCode | undefined
  onQty: (key: string, qty: number) => void
  onEdit: (key: string) => void
  onRemove: (key: string) => void
}

function TicketLineBase({ line, lang, problem, onQty, onEdit, onRemove }: Props) {
  const t = useT()
  const { input, preview } = line
  const name = pickName(preview.name, lang)
  const parts = [name]
  if (preview.typeLabel) parts.push(pickName(preview.typeLabel, lang))
  if (preview.variantLabel) parts.push(preview.variantLabel)

  const forName = input.forName
  const note = input.note
  const problemText = problem
    ? problem === 'sold_out' || problem === 'type_sold_out'
      ? t('register.line.soldOut')
      : errorText(t, problem)
    : null

  return (
    <li className={`reg-line${problem ? ' is-bad' : ''}`}>
      <button
        type="button"
        className="reg-line-main press"
        aria-label={t('register.line.edit', { name })}
        onClick={() => onEdit(line.key)}
      >
        <span className="reg-line-title">
          <span className="reg-line-qty ltr-isolate">{input.qty}×</span>
          <span>{parts.join(' · ')}</span>
        </span>
        {preview.modifiers.length > 0 && (
          <span className="reg-line-mods">
            {preview.modifiers.map((m) => (
              <span key={`${m.group_uid}:${m.option_uid}`} className={`reg-mod reg-mod--${m.kind}`}>
                {describeModifier(m, lang)}
              </span>
            ))}
          </span>
        )}
        {(forName || note) && (
          <span className="reg-line-meta">
            {forName && <span>{t('register.line.for', { name: forName })}</span>}
            {note && <span className="reg-line-note">{note}</span>}
          </span>
        )}
        {problemText && (
          <span className="reg-line-bad" role="alert">
            <AlertTriangle size={14} aria-hidden="true" />
            {problemText}
          </span>
        )}
      </button>
      <span className="reg-line-price ltr-isolate">{formatAgorot(lineTotal(line))}</span>
      {problem ? (
        <button type="button" className="reg-line-remove press" aria-label={t('register.line.removeNamed', { name })} onClick={() => onRemove(line.key)}>
          <Trash2 size={18} aria-hidden="true" />
          <span>{t('register.line.remove')}</span>
        </button>
      ) : (
        <span className="reg-line-step" role="group" aria-label={name}>
          <button
            type="button"
            className="press"
            aria-label={input.qty <= 1 ? t('register.line.removeNamed', { name }) : t('register.line.lessNamed', { name })}
            onClick={() => {
              haptic('tick')
              onQty(line.key, input.qty - 1)
            }}
          >
            {input.qty <= 1 ? <Trash2 size={18} aria-hidden="true" /> : <Minus size={18} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="press"
            aria-label={t('register.line.moreNamed', { name })}
            aria-disabled={input.qty >= LIMITS.qtyMax || undefined}
            onClick={() => {
              if (input.qty >= LIMITS.qtyMax) return
              haptic('tick')
              onQty(line.key, input.qty + 1)
            }}
          >
            <Plus size={18} aria-hidden="true" />
          </button>
        </span>
      )}
    </li>
  )
}

export const TicketLine = memo(TicketLineBase)
