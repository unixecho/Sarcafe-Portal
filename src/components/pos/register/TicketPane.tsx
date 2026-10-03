'use client'

// The ticket: customer, lines grouped by the point that makes them, the slip check, the total
// and the send button. It renders a FRAGMENT of [header, scroller, footer] so the same markup
// serves the tablet's fixed side pane and the phone's bottom sheet (whose panel is a flex column
// and wants exactly those direct children).
//
// Grouping by point is information, never a choice: the colour dot tells the cashier where the
// thing is made so they can say "the toast will be ready at the grill", nothing more.
//
// The send button is never disabled silently — the reason is written under it.

import { useState } from 'react'
import { AlertTriangle, ChevronDown, Lock, MessageSquarePlus, Phone, Plus, Send, Trash2, UserRound } from 'lucide-react'
import {
  groupByPoint, type CartLine, type Draft, type SendGate, type SlipStatus,
} from '@/lib/pos/cart'
import { formatAgorot } from '@/lib/pos/money'
import { normalizePhone } from '@/lib/pos/validate'
import type { LineProblemCode, PosPoint } from '@/lib/pos/types'
import { LIMITS } from '@/lib/pos/vocab'
import { useT } from '@/lib/pos/useT'
import type { StrKey } from '@/lib/pos/i18n'
import { safeColour } from '../shell/safeColour'
import { SlipCheck } from './SlipCheck'
import { TicketLine } from './TicketLine'

export type SendProblem = {
  text: string
  /** lines the problem is about — offered for removal by name */
  removeKeys: string[]
  removeName?: string
  /** the outcome of an add-to-order is unknown: offer to open the order and look */
  openOrder?: boolean
}

export type TicketModel = {
  draft: Draft
  /** lines with their prices refreshed against the current menu */
  lines: CartLine[]
  problems: Record<string, LineProblemCode>
  lang: 'he' | 'en'
  points: readonly PosPoint[]
  pointsById: ReadonlyMap<string, PosPoint>
  total: number
  slip: SlipStatus
  gate: SendGate
  sending: boolean
  sendProblem: SendProblem | null
  /** add-to-order: the customer is the order's and is locked */
  addTo: { ticketNo: number | null; name: string } | null
  /** a blocker specific to add mode (the order is gone / cancelled) */
  addBlock: 'missing' | 'void' | null
  /** the same-name hint */
  hint: { ticketNo: number; name: string } | null
  started: boolean
}

export type TicketActions = {
  onCustomer: (patch: { name?: string; phone?: string }) => void
  onOrderNote: (note: string) => void
  onSlip: (patch: { receiptRef?: string; slipTotal?: string }) => void
  onQty: (key: string, qty: number) => void
  onEdit: (key: string) => void
  onRemove: (key: string) => void
  onSend: () => void
  onClear: () => void
  onNewOrder: () => void
  onHint: () => void
  onDismissProblem: () => void
  onRemoveProblemLines: () => void
  onOpenOrder: () => void
}

const WHY: Record<Exclude<SendGate, { ok: true }>['reason'], StrKey> = {
  closed: 'register.send.closed',
  no_lines: 'register.send.noLines',
  no_name: 'register.send.noName',
  bad_phone: 'register.send.badPhone',
  line_problem: 'register.send.lineProblem',
  offline: 'register.send.offline',
}

export function TicketPane({ model, actions }: { model: TicketModel; actions: TicketActions }) {
  const t = useT()
  const { draft, lines, problems, lang, pointsById, gate, addTo } = model
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)

  const groups = groupByPoint(lines, model.points.map((p) => p.id))
  const locked = addTo !== null
  const phoneBad = normalizePhone(draft.customerPhone) === 'invalid'
  const showPhone = phoneOpen || draft.customerPhone !== ''
  const showNote = noteOpen || draft.orderNote !== ''
  const dirty = draft.lines.length > 0 || draft.customerName.trim() !== ''

  const whyText = model.addBlock
    ? t(model.addBlock === 'void' ? 'register.send.orderVoid' : 'register.send.orderMissing')
    : gate.ok
      ? null
      : t(WHY[gate.reason])
  const blocked = !gate.ok || model.addBlock !== null

  return (
    <>
      <header className="reg-t-head">
        {!model.started && !locked ? (
          <button type="button" className="pos-btn pos-btn--primary reg-new press" onClick={actions.onNewOrder}>
            <Plus size={20} aria-hidden="true" />
            {t('register.new')}
          </button>
        ) : locked ? (
          <div className="reg-locked">
            <Lock size={16} aria-hidden="true" />
            <span className="ltr-isolate">{addTo.ticketNo !== null ? `#${addTo.ticketNo}` : ''}</span>
            <span>{addTo.name}</span>
          </div>
        ) : (
          <div className="reg-cust">
            <div className="reg-cust-row">
              <div className="reg-cust-field">
                <label className="reg-label" htmlFor="reg-t-name">
                  <UserRound size={14} aria-hidden="true" /> {t('register.start.name')}
                </label>
                <input
                  id="reg-t-name"
                  className="pos-input reg-in"
                  type="text"
                  autoComplete="off"
                  maxLength={LIMITS.customerNameMax}
                  aria-invalid={draft.customerName.trim() === ''}
                  value={draft.customerName}
                  onChange={(e) => actions.onCustomer({ name: e.target.value })}
                />
              </div>
              {dirty && (
                <button type="button" className="reg-icon-btn press" aria-label={t('register.clear')} onClick={actions.onClear}>
                  <Trash2 size={20} aria-hidden="true" />
                </button>
              )}
            </div>
            {showPhone ? (
              <div className="reg-cust-field">
                <label className="reg-label" htmlFor="reg-t-phone">
                  <Phone size={14} aria-hidden="true" /> {t('register.start.phone')}
                </label>
                <input
                  id="reg-t-phone"
                  className="pos-input reg-in ltr-isolate"
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  autoComplete="off"
                  maxLength={24}
                  placeholder={t('register.start.phonePlaceholder')}
                  aria-invalid={phoneBad}
                  aria-describedby={phoneBad ? 'reg-t-phone-bad' : undefined}
                  value={draft.customerPhone}
                  onChange={(e) => actions.onCustomer({ phone: e.target.value })}
                />
                {phoneBad && (
                  <p id="reg-t-phone-bad" className="pos-hint pos-hint--bad" role="alert">{t('register.start.badPhone')}</p>
                )}
              </div>
            ) : (
              <button type="button" className="reg-link press" onClick={() => setPhoneOpen(true)}>
                <Phone size={16} aria-hidden="true" />
                {t('register.t.addPhone')}
              </button>
            )}
            {model.hint && (
              <button type="button" className="reg-hint-chip press" onClick={actions.onHint}>
                <Plus size={16} aria-hidden="true" />
                {t('register.hint.add', { n: model.hint.ticketNo, name: model.hint.name })}
              </button>
            )}
          </div>
        )}
      </header>

      <div className="reg-t-scroll pos-pane-scroll">
        {lines.length === 0 ? (
          <p className="reg-t-empty">{model.started || locked ? t('register.t.empty') : t('register.t.emptyStart')}</p>
        ) : (
          groups.map((g) => {
            const point = pointsById.get(g.pointId)
            return (
              <section key={g.pointId || 'none'} className="reg-group" aria-label={point?.name ?? t('register.t.noPoint')}>
                {point && (
                  <h3 className="reg-group-h">
                    <span className="reg-dot" style={{ background: safeColour(point.colour, '#9c9086') }} aria-hidden="true" />
                    {point.name}
                  </h3>
                )}
                <ul className="reg-lines" role="list">
                  {g.lines.map((l) => (
                    <TicketLine
                      key={l.key}
                      line={l}
                      lang={lang}
                      problem={problems[l.key]}
                      onQty={actions.onQty}
                      onEdit={actions.onEdit}
                      onRemove={actions.onRemove}
                    />
                  ))}
                </ul>
              </section>
            )
          })
        )}

        {!locked && (
          <>
            {showNote ? (
              <div className="reg-note">
                <label className="reg-label" htmlFor="reg-t-note">{t('register.t.orderNote')}</label>
                <input
                  id="reg-t-note"
                  className="pos-input reg-in"
                  type="text"
                  autoComplete="off"
                  maxLength={LIMITS.orderNoteMax}
                  placeholder={t('register.t.orderNotePlaceholder')}
                  value={draft.orderNote}
                  onChange={(e) => actions.onOrderNote(e.target.value)}
                />
              </div>
            ) : (
              <button type="button" className="reg-link press" onClick={() => setNoteOpen(true)}>
                <MessageSquarePlus size={16} aria-hidden="true" />
                {t('register.t.addNote')}
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            )}
            <SlipCheck receiptRef={draft.receiptRef} slipTotal={draft.slipTotal} status={model.slip} onChange={actions.onSlip} />
          </>
        )}
      </div>

      <footer className="reg-t-foot">
        {model.sendProblem && (
          <div className="reg-problem" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <div className="reg-problem-body">
              <p>{model.sendProblem.text}</p>
              <div className="reg-problem-actions">
                {model.sendProblem.removeKeys.length > 0 && (
                  <button type="button" className="reg-link press" onClick={actions.onRemoveProblemLines}>
                    {t('register.problem.remove', { name: model.sendProblem.removeName ?? '' })}
                  </button>
                )}
                {model.sendProblem.openOrder && (
                  <button type="button" className="reg-link press" onClick={actions.onOpenOrder}>
                    {t('register.problem.openOrder')}
                  </button>
                )}
                <button type="button" className="reg-link press" onClick={actions.onDismissProblem}>
                  {t('register.problem.dismiss')}
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="reg-total-row">
          <span className="reg-total-label">{t('register.t.total')}</span>
          <span className="reg-total ltr-isolate" aria-live="polite">{formatAgorot(model.total)}</span>
        </div>
        <button
          type="button"
          className="pos-btn pos-btn--primary reg-send press"
          disabled={blocked || model.sending}
          aria-describedby={whyText ? 'reg-send-why' : undefined}
          onClick={actions.onSend}
        >
          <Send size={20} aria-hidden="true" className="reg-flip" />
          {model.sending ? t('register.send.sending') : locked ? t('register.send.add') : t('register.send.go')}
        </button>
        {whyText && (
          <p id="reg-send-why" className="reg-why" role="status">{whyText}</p>
        )}
      </footer>
    </>
  )
}
