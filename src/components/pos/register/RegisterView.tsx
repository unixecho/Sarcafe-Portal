'use client'

// The register: taking an order from the HYP slip. The cashier thinks "who is it for ->
// what do they want -> any tweak -> send" and nothing else; routing, ids and states are
// invisible and automatic (blueprint §1a). This file only ORCHESTRATES — every rule that
// decides something (merge, sellability, may-send, the wire body) is a pure function in
// lib/pos/cart.ts, and every screen part is its own small component.
//
// Speed rules that shaped the code:
//   * one tap on a tile adds it as-is: no await, no spinner, a haptic and a count badge;
//   * the tile handlers are STABLE (they read the latest state through a ref) so the
//     memoised tiles do not all re-render on every tap;
//   * sending enqueues to the outbox and clears the form AT ONCE — the order is on the
//     device before the network is consulted, and the chip shows the rest;
//   * add-to-order is the one thing that is NOT queued (adding is not idempotent), so on a
//     network error it says plainly that it does not know, and never retries by itself.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Lock, ShoppingBag, TriangleAlert } from 'lucide-react'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import SheetShell from '@/components/SheetShell'
import {
  analyseLines, atLineCap, buildAddBody, buildCreateBody, buildLine, canSend, countsOf, draftStorageKey,
  emptyDraft, isBlank, itemCount, itemSellability, lenientLine, pickName, sameNameOrder, slipStatus, tileAction,
  totalAgorot, type CartLine,
} from '@/lib/pos/cart'
import { formatAgorot } from '@/lib/pos/money'
import { parsePriceInput } from '@/lib/pos/validate'
import { findItem } from '@/lib/pos/pricing'
import { useOutbox } from '@/lib/pos/outbox'
import { posApi, type ApiFailure } from '@/lib/pos/client'
import { useLayout } from '@/lib/pos/device'
import type { LineInput } from '@/lib/pos/types'
import { VOID_REASONS } from '@/lib/pos/vocab'
import { usePosLang, useT } from '@/lib/pos/useT'
import { haptic } from '@/lib/haptics'
import { usePos, usePosLink } from '../PosProvider'
import { usePosNav } from '../PosNav'
import { useLive } from '../live/LiveStore'
import { usePosToast } from '../shell/Toast'
import { errorText } from '../shell/errorText'
import { SkMenuGrid } from '../shell/Skeletons'
import CustomItemSheet, { type CustomItemRequest } from './CustomItemSheet'
import CustomizeSheet, { type CustomizeRequest } from './CustomizeSheet'
import { MenuPane, type CategoryEntries } from './MenuPane'
import OrderStartSheet from './OrderStartSheet'
import { SentChip, useTick, type SentChipModel } from './SentChip'
import { TicketPane, type SendProblem, type TicketActions, type TicketModel } from './TicketPane'
import { readDraft, useDraft, writeDraft } from './useDraft'
import './register.css'

type Ask = { kind: 'clear' } | { kind: 'mismatch' } | { kind: 'undo'; clientKey: string }

/** A sent chip lingers this long after the answer arrives, then goes (cancel only works for UNDO.sendWindowS of it). */
const CHIP_LINGER_MS = 120_000

export default function RegisterView({ addTo }: { addTo?: string }) {
  const t = useT()
  const [lang] = usePosLang()
  const { me, branchId, session, menu, pricing, points, pointsById } = usePos()
  const { online } = usePosLink()
  const live = useLive()
  const nav = usePosNav()
  const { toast } = usePosToast()
  const outbox = useOutbox(branchId)
  const { atLeastTablet } = useLayout()
  const { draft, dispatch, hydrated } = useDraft(branchId, me.id, addTo)

  // ---- the draft, re-priced against the CURRENT menu ----------------------------------------
  // A publish mid-event, or a draft restored from yesterday's prices, must not show a stale
  // total. Lines that can no longer be sold are flagged (never dropped) and block sending.
  const analysed = useMemo(() => analyseLines(draft.lines, pricing), [draft.lines, pricing])
  const view = useMemo(() => ({ ...draft, lines: analysed.lines }), [draft, analysed.lines])
  const total = totalAgorot(view)
  const problemCount = Object.keys(analysed.problems).length
  const slip = slipStatus(view)

  // ---- local UI state ---------------------------------------------------------------------------
  const [query, setQuery] = useState('')
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [startOpen, setStartOpen] = useState(false)
  const [startSeq, setStartSeq] = useState(0)
  const [cz, setCz] = useState<CustomizeRequest | null>(null)
  const [custom, setCustom] = useState<CustomItemRequest | null>(null)
  const [ticketOpen, setTicketOpen] = useState(false)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [sending, setSending] = useState(false)
  const [sendProblem, setSendProblem] = useState<SendProblem | null>(null)
  const [chips, setChips] = useState<SentChipModel[]>([])
  const searchRef = useRef<HTMLInputElement>(null)
  const seqRef = useRef(0)
  const sendingRef = useRef(false)
  const pendingRef = useRef<(() => void) | null>(null)
  const autoOpened = useRef(false)
  const lastCustomPoint = useRef('')

  // The latest of everything the stable handlers need. Written every render; read only in handlers.
  const api = useRef({ t, toast, draft, pricing, addTo })
  api.current = { t, toast, draft, pricing, addTo }

  // ---- order-start sheet ----------------------------------------------------------------------------
  const openStart = useCallback(() => {
    setStartSeq((s) => s + 1)
    setStartOpen(true)
  }, [])

  // A fresh, empty register opens the sheet by itself — once. After a SEND it deliberately does not:
  // the confirmation chip (with its cancel button) must stay reachable, and the next tile tap or the
  // "new order" button opens the sheet instead.
  useEffect(() => {
    if (!hydrated || autoOpened.current) return
    autoOpened.current = true
    if (!addTo && session && isBlank(draft)) openStart()
  }, [hydrated, addTo, session, draft, openStart])

  const ensureStarted = useCallback(
    (then: () => void): boolean => {
      const a = api.current
      if (a.addTo || a.draft.customerName.trim() !== '') return true
      pendingRef.current = then
      openStart()
      return false
    },
    [openStart],
  )

  // ---- adding -------------------------------------------------------------------------------------------
  const doAdd = useCallback(
    (uid: string) => {
      const a = api.current
      if (!a.pricing) return
      const r = buildLine({ itemUid: uid, qty: 1 }, a.pricing)
      if (!r.ok) {
        a.toast(errorText(a.t, r.problem.code), { tone: 'error' })
        return
      }
      if (atLineCap(a.draft) && !a.draft.lines.some((l) => l.key === r.line.key)) {
        a.toast(a.t('register.cap'), { tone: 'warn' })
        return
      }
      haptic('tick')
      dispatch({ type: 'add', line: r.line })
    },
    [dispatch],
  )
  const onAdd = useCallback(
    (uid: string) => {
      if (ensureStarted(() => doAdd(uid))) doAdd(uid)
    },
    [ensureStarted, doAdd],
  )
  const openCz = useCallback((uid: string, full: boolean) => {
    seqRef.current += 1
    setCz({ seq: seqRef.current, itemUid: uid, full })
  }, [])
  const onCustomize = useCallback(
    (uid: string, full: boolean) => {
      if (ensureStarted(() => openCz(uid, full))) openCz(uid, full)
    },
    [ensureStarted, openCz],
  )
  const openCustom = useCallback(() => {
    seqRef.current += 1
    setCustom({ seq: seqRef.current })
  }, [])
  const onCustom = useCallback(() => {
    if (ensureStarted(openCustom)) openCustom()
  }, [ensureStarted, openCustom])

  function submitLine(input: LineInput, editKey?: string) {
    if (!pricing) return
    const r = buildLine(input, pricing)
    if (!r.ok) {
      toast(errorText(t, r.problem.code), { tone: 'error' })
      return
    }
    if (editKey) dispatch({ type: 'replaceLine', key: editKey, line: r.line })
    else if (atLineCap(draft) && !draft.lines.some((l) => l.key === r.line.key)) {
      toast(t('register.cap'), { tone: 'warn' })
      return
    } else dispatch({ type: 'add', line: r.line })
    setCz(null)
    setCustom(null)
  }

  function editLine(key: string) {
    const line = view.lines.find((l) => l.key === key)
    if (!line || !pricing) return
    seqRef.current += 1
    if ('custom' in line.input) {
      setCustom({ seq: seqRef.current, initial: line.input, editKey: key })
    } else if (findItem(pricing.categories, line.input.itemUid)) {
      setCz({ seq: seqRef.current, itemUid: line.input.itemUid, initial: line.input, editKey: key, full: true })
    } else {
      toast(t('register.line.gone'), { tone: 'warn' })
    }
  }

  // ---- the menu, precomputed once per publish / routing change ---------------------------------------------
  const entries = useMemo<CategoryEntries[]>(() => {
    if (!menu || !pricing) return []
    return menu.categories.map((category) => ({
      category,
      items: category.items.map((item, i) => ({
        id: item.uid ?? `${category.id}:${i}`,
        item,
        category,
        sell: itemSellability(item, category, pricing),
        action: tileAction(item, category, pricing),
      })),
    }))
  }, [menu, pricing])
  const counts = useMemo(() => countsOf(view.lines), [view.lines])
  const activeId = entries.some((e) => e.category.id === activeCat) ? activeCat : (entries[0]?.category.id ?? null)

  // '/' jumps to the search box, the way a till with a keyboard expects.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (document.querySelector('[role="dialog"],[role="alertdialog"]')) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---- add-to-order mode -------------------------------------------------------------------------------------
  const addOrder = addTo ? live.byId.get(addTo) : undefined
  const addInfo = addTo ? { ticketNo: addOrder?.ticket_no ?? null, name: addOrder?.customer_name ?? '' } : null
  const addBlock: 'missing' | 'void' | null = !addTo
    ? null
    : addOrder?.status === 'void'
      ? 'void'
      : live.loaded && !addOrder
        ? 'missing'
        : null

  // ---- the same-name hint ---------------------------------------------------------------------------------------
  const hintOrder = useMemo(
    () => (addTo ? null : sameNameOrder(live.orders, draft.customerName, Date.now())),
    [live.orders, draft.customerName, addTo],
  )

  // ---- sending -----------------------------------------------------------------------------------------------------
  const gate = canSend(view, {
    sessionActive: !!session && session.status === 'active',
    online,
    addMode: !!addTo,
    problemCount,
  })

  function sendNew() {
    const body = buildCreateBody(view)
    if (!body) return
    try {
      const clientKey = outbox.enqueueCreate(body)
      setChips((cs) => [{ clientKey, name: body.customerName, ticketNo: null, state: 'pending' as const, sentAt: null }, ...cs].slice(0, 4))
    } catch {
      toast(errorText(t, 'internal_error'), { tone: 'error' })
      return
    }
    haptic('impact')
    // Clear AT ONCE: the order is already safe in the outbox on this device.
    dispatch({ type: 'clear', now: Date.now() })
    setSendProblem(null)
    setQuery('')
    setTicketOpen(false)
  }

  function problemFrom(res: ApiFailure): SendProblem {
    if (res.code === 'network') return { text: t('register.add.unknown'), removeKeys: [], openOrder: true }
    const d = res.details ?? {}
    const keys: string[] = []
    if (typeof d.lineIndex === 'number') {
      const l = view.lines[d.lineIndex]
      if (l) keys.push(l.key)
    } else if (typeof d.itemUid === 'string') {
      for (const l of view.lines) if ('itemUid' in l.input && l.input.itemUid === d.itemUid) keys.push(l.key)
    }
    const first = keys.length ? view.lines.find((l) => l.key === keys[0]) : undefined
    const name = first ? pickName(first.preview.name, lang) : ''
    return {
      text: name ? `${name}: ${errorText(t, res.code)}` : errorText(t, res.code),
      removeKeys: keys,
      removeName: name,
    }
  }

  async function sendAdd() {
    const body = buildAddBody(view)
    if (!body || !addTo) return
    sendingRef.current = true
    setSending(true)
    setSendProblem(null)
    const res = await posApi.addItems(addTo, { branchId, lines: body.lines })
    sendingRef.current = false
    setSending(false)
    if (res.ok) {
      haptic('impact')
      // Written straight to storage as well: if the screen was left mid-call, the unmount flush has
      // already saved these lines, and a leftover draft would invite a double add.
      writeDraft(draftStorageKey(branchId, me.id, addTo), emptyDraft(Date.now()))
      dispatch({ type: 'clear', now: Date.now() })
      toast(t('register.add.done', { n: res.data.added, ticket: addInfo?.ticketNo != null ? `#${addInfo.ticketNo}` : '' }), { tone: 'ok' })
      live.refreshNow()
      nav.go({ v: 'register' }, { replace: true })
      return
    }
    setSendProblem(problemFrom(res))
    setTicketOpen(true)
  }

  function onSend() {
    if (!gate.ok || addBlock || sendingRef.current) return
    if (addTo) {
      void sendAdd()
      return
    }
    // A mismatch against the slip never blocks (a terminal discount is legitimate) — it asks once.
    if (slip.kind === 'diff') setAsk({ kind: 'mismatch' })
    else sendNew()
  }

  // ---- the confirmation chips -----------------------------------------------------------------------------------------
  useEffect(
    () =>
      outbox.onSent((s) => {
        setChips((cs) =>
          cs.map((c) => (c.clientKey === s.clientKey ? { ...c, state: 'sent' as const, ticketNo: s.ticketNo, sentAt: Date.now() } : c)),
        )
      }),
    [outbox.onSent],
  )

  // A chip whose order left the outbox without an answer (it was deleted from the waiting list) goes
  // quietly — after a short grace, because the answer and the removal can arrive in either order.
  useEffect(() => {
    const orphans = chips.filter((c) => c.state === 'pending' && !outbox.entries.some((e) => e.clientKey === c.clientKey))
    if (orphans.length === 0) return
    const id = window.setTimeout(
      () =>
        setChips((cs) => cs.filter((c) => !(c.state === 'pending' && orphans.some((o) => o.clientKey === c.clientKey)))),
      2500,
    )
    return () => window.clearTimeout(id)
  }, [chips, outbox.entries])

  const anySent = chips.some((c) => c.state === 'sent')
  const now = useTick(anySent)
  const orderByKey = useMemo(() => {
    const m = new Map<string, (typeof live.orders)[number]>()
    for (const o of live.orders) m.set(o.client_key, o)
    return m
  }, [live.orders])

  const chipModels: SentChipModel[] = chips
    .filter((c) => c.state !== 'sent' || c.sentAt === null || now - c.sentAt < CHIP_LINGER_MS)
    .map((c) => {
      if (c.state !== 'pending') return c
      const e = outbox.entries.find((x) => x.clientKey === c.clientKey)
      return e?.state === 'attention' ? { ...c, state: 'attention' as const, errorCode: e.lastError?.code } : c
    })

  const dismissChip = (clientKey: string) => setChips((cs) => cs.filter((c) => c.clientKey !== clientKey))

  async function undoChip(clientKey: string) {
    const order = orderByKey.get(clientKey)
    if (!order) return
    const reason = VOID_REASONS.find((r) => r.key === 'typo')?.he ?? 'טעות הקלדה'
    const res = await posApi.voidItems(order.id, { branchId, itemIds: null, reason })
    if (res.ok) {
      setChips((cs) => cs.map((c) => (c.clientKey === clientKey ? { ...c, state: 'cancelled' as const } : c)))
      live.refreshNow()
    } else {
      toast(errorText(t, res.code), { tone: 'error' })
    }
  }

  function addToChip(clientKey: string) {
    const order = orderByKey.get(clientKey)
    if (!order) return
    dismissChip(clientKey)
    nav.go({ v: 'register', addTo: order.id })
  }

  function editChip(clientKey: string) {
    const entry = outbox.entries.find((e) => e.clientKey === clientKey)
    if (!entry || !pricing) return
    if (!isBlank(draft)) {
      toast(t('register.sent.finishFirst'), { tone: 'warn' })
      return
    }
    const lines: CartLine[] = []
    for (const raw of entry.body.lines) {
      const input = raw as LineInput
      const r = buildLine(input, pricing)
      const line = r.ok ? r.line : lenientLine(input, pricing)
      if (line) lines.push(line)
    }
    dispatch({
      type: 'load',
      draft: {
        ...emptyDraft(Date.now()),
        customerName: entry.body.customerName,
        customerPhone: entry.body.customerPhone ?? '',
        orderNote: entry.body.note ?? '',
        receiptRef: entry.body.receiptRef ?? '',
        slipTotal: entry.body.slipTotalAgorot != null ? String(entry.body.slipTotalAgorot / 100) : '',
        lines,
      },
    })
    outbox.discard(clientKey)
    dismissChip(clientKey)
  }

  // ---- the same-name hint's action: turn this ticket into an addition ----------------------------------------------
  function takeHint() {
    if (!hintOrder) return
    // The lines move to the add-to-order draft of THAT order, then the screen re-enters in that mode.
    writeDraft(draftStorageKey(branchId, me.id, hintOrder.id), { ...readDraft(draftStorageKey(branchId, me.id, hintOrder.id)), lines: draft.lines })
    dispatch({ type: 'clear', now: Date.now() })
    nav.go({ v: 'register', addTo: hintOrder.id })
  }

  // ---- confirmations -----------------------------------------------------------------------------------------------------
  const slipAgorot = parsePriceInput(view.slipTotal)
  const askChipName = ask?.kind === 'undo' ? (chips.find((c) => c.clientKey === ask.clientKey)?.name ?? '') : ''
  const confirm: ConfirmRequest | null = !ask
    ? null
    : ask.kind === 'clear'
      ? {
          title: t('register.clear.title'),
          body: t('register.clear.body'),
          confirmLabel: t('register.clear.yes'),
          cancelLabel: t('register.clear.no'),
          danger: true,
        }
      : ask.kind === 'mismatch'
        ? {
            title: t('register.mismatch.title'),
            body: t('register.mismatch.body', { system: formatAgorot(total), slip: formatAgorot(slipAgorot ?? 0) }),
            confirmLabel: t('register.mismatch.yes'),
            cancelLabel: t('register.mismatch.no'),
          }
        : {
            title: t('register.undo.title', { name: askChipName }),
            body: t('register.undo.body'),
            confirmLabel: t('register.undo.yes'),
            cancelLabel: t('register.undo.no'),
            danger: true,
          }

  function onConfirm() {
    const a = ask
    setAsk(null)
    if (!a) return
    if (a.kind === 'clear') dispatch({ type: 'clear', now: Date.now() })
    else if (a.kind === 'mismatch') sendNew()
    else void undoChip(a.clientKey)
  }

  // ---- the ticket, one model for the side pane and the phone sheet ---------------------------------------------------------
  const model: TicketModel = {
    draft,
    lines: view.lines,
    problems: analysed.problems,
    lang,
    points,
    pointsById,
    total,
    slip,
    gate,
    sending,
    sendProblem,
    addTo: addInfo,
    addBlock,
    hint: hintOrder ? { ticketNo: hintOrder.ticket_no, name: hintOrder.customer_name } : null,
    started: draft.customerName.trim() !== '',
  }
  const actions: TicketActions = {
    onCustomer: (p) => dispatch({ type: 'setCustomer', ...p }),
    onOrderNote: (note) => dispatch({ type: 'setOrderNote', note }),
    onSlip: (p) => dispatch({ type: 'setSlip', ...p }),
    onQty: (key, qty) => dispatch({ type: 'setQty', key, qty }),
    onEdit: editLine,
    onRemove: (key) => dispatch({ type: 'remove', key }),
    onSend,
    onClear: () => {
      if (draft.lines.length > 0) setAsk({ kind: 'clear' })
      else dispatch({ type: 'clear', now: Date.now() })
    },
    onNewOrder: () => {
      setTicketOpen(false)
      openStart()
    },
    onHint: takeHint,
    onDismissProblem: () => setSendProblem(null),
    onRemoveProblemLines: () => {
      for (const k of sendProblem?.removeKeys ?? []) dispatch({ type: 'remove', key: k })
      setSendProblem(null)
    },
    onOpenOrder: () => {
      if (addTo) nav.openOrder(addTo)
    },
  }

  const closed = !session
  const itemsN = itemCount(view)

  return (
    <div className="reg-root" data-receded={startOpen || undefined}>
      {closed && (
        <div className="reg-banner reg-banner--closed" role="alert">
          <Lock size={18} aria-hidden="true" />
          {t('register.closed')}
        </div>
      )}
      {addInfo && (
        <div className="reg-banner reg-banner--add" role="status">
          <ShoppingBag size={18} aria-hidden="true" />
          <span>
            {t('register.add.banner', {
              ticket: addInfo.ticketNo !== null ? `#${addInfo.ticketNo}` : '',
              name: addInfo.name,
            })}
          </span>
          <button type="button" className="reg-link press" onClick={() => nav.go({ v: 'register' }, { replace: true })}>
            {t('register.add.back')}
          </button>
        </div>
      )}

      <div className="pos-split">
        <div className="reg-main">
          {chipModels.length > 0 && (
            <div className="reg-chips-col">
              {chipModels.map((c) => (
                <SentChip
                  key={c.clientKey}
                  chip={c}
                  orderKnown={orderByKey.has(c.clientKey)}
                  now={now}
                  onUndo={(k) => setAsk({ kind: 'undo', clientKey: k })}
                  onAdd={addToChip}
                  onDismiss={dismissChip}
                  onRetry={(k) => outbox.retry(k)}
                  onEdit={editChip}
                />
              ))}
            </div>
          )}

          {menu ? (
            entries.length > 0 ? (
              <MenuPane
                entries={entries}
                itemCounts={counts.byItem}
                categoryCounts={counts.byCategory}
                lang={lang}
                isManager={me.isManager}
                query={query}
                onQuery={setQuery}
                activeId={activeId}
                onActive={setActiveCat}
                searchRef={searchRef}
                onAdd={onAdd}
                onCustomize={onCustomize}
                onCustom={onCustom}
              />
            ) : (
              <p className="reg-empty" role="status">
                <TriangleAlert size={18} aria-hidden="true" /> {t('register.menu.empty')}
              </p>
            )
          ) : (
            <SkMenuGrid label={t('core.loading')} />
          )}

          {!atLeastTablet && (
            <div className="reg-bar">
              {draft.customerName.trim() === '' && view.lines.length === 0 && !addTo ? (
                <button type="button" className="pos-btn pos-btn--primary reg-bar-btn press" onClick={openStart}>
                  {t('register.new')}
                </button>
              ) : (
                <button type="button" className="pos-btn pos-btn--primary reg-bar-btn press" onClick={() => setTicketOpen(true)}>
                  <span>
                    {t('register.bar.items', { n: itemsN })} · <span className="ltr-isolate">{formatAgorot(total)}</span>
                  </span>
                  <span className="reg-bar-go">
                    {t('register.bar.continue')}
                    <ChevronRight size={18} aria-hidden="true" className="reg-flip" />
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        {atLeastTablet && (
          <aside className="pos-split-side reg-side" aria-label={t('register.t.label')}>
            <TicketPane model={model} actions={actions} />
          </aside>
        )}
      </div>

      {!atLeastTablet && (
        <SheetShell open={ticketOpen} onClose={() => setTicketOpen(false)} labelledBy="reg-ticket-title" suspended={!!ask} className="reg-sheet reg-sheet--ticket">
          <h2 id="reg-ticket-title" className="sr-only">{t('register.t.label')}</h2>
          <TicketPane model={model} actions={actions} />
        </SheetShell>
      )}

      <OrderStartSheet
        open={startOpen}
        seq={startSeq}
        initialName={draft.customerName}
        initialPhone={draft.customerPhone}
        onSubmit={(name, phone) => {
          dispatch({ type: 'setCustomer', name, phone })
          setStartOpen(false)
          const run = pendingRef.current
          pendingRef.current = null
          run?.()
        }}
        onClose={() => {
          pendingRef.current = null
          setStartOpen(false)
        }}
      />

      {pricing && (
        <CustomizeSheet request={cz} ctx={pricing} lang={lang} onSubmit={submitLine} onClose={() => setCz(null)} />
      )}
      <CustomItemSheet
        request={custom}
        points={points}
        defaultPointId={lastCustomPoint.current}
        onSubmit={(input, editKey) => {
          lastCustomPoint.current = input.custom.pointId
          submitLine(input, editKey)
        }}
        onClose={() => setCustom(null)}
      />

      <ConfirmSheet request={confirm} onConfirm={onConfirm} onCancel={() => setAsk(null)} />
    </div>
  )
}
