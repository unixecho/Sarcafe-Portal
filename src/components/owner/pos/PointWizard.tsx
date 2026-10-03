'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import { haptic } from '@/lib/haptics'
import { resolveCategoryIcon } from '@/lib/menu/icons'
import type { MenuCategory } from '@/lib/menu/types'
import { nameOf } from '@/lib/pos/format'
import type {
  CatalogueCategory, PersonRow, PointConfig, PointSaveResult, PointSummary, RouteConflict, SetupState,
} from '@/lib/pos/owner-api'
import { summarizePoint, type RoutingContext } from '@/lib/pos/routing'
import { POINT_COLOURS, POINT_ICONS, PREP_PRESETS } from '@/lib/pos/vocab'
import { usePosLang, useT } from '@/lib/pos/useT'
import { errorText } from '@/components/pos/shell/errorText'
import { inkOn, safeColour } from '@/components/pos/shell/safeColour'
import type { StrKey } from '@/lib/pos/i18n'
import CategoryTile from './CategoryTile'
import ItemChecklist, { type ChecklistItem } from './ItemChecklist'
import { speedKeyOf } from './PointCard'
import type { Reply } from './SetupWorkspace'
import WizardSteps from './WizardSteps'

// The point wizard: five short steps, one decision each, NOTHING saved until the last.
//
// Everything the owner decides here is a local draft. The summary line and the item
// counts are computed from that draft with the same routing rules the server uses
// (lib/pos/routing.ts) over the other points' real settings, so the sentence under
// "is everything right?" is what the point will actually do — and it updates live as
// they tick.
//
// Conflicts are EXPLAINED, never silently stolen: a category (or a single product) that
// another point makes asks "move it here?" and names that point. Agreeing is remembered
// in `moves`, shown on the tile, and sent as `move: true` on save. If the server still
// finds a conflict (somebody else changed things meanwhile) the summary step lists it
// with the same two choices: move, or go back.
//
// The component is mounted fresh for every opening (the parent keys it), so its draft
// is seeded once from the point being edited and never needs a "reset" effect.

const DRAFT_ID = '__draft__'
const STEP_COUNT = 5

type SpeedKey = (typeof PREP_PRESETS)[number]['key']

type Draft = {
  name: string
  icon: string
  colour: string
  handsOver: boolean
  speed: SpeedKey
  cats: string[]
  items: string[]
  excluded: string[]
  staff: string[]
  /** 'c:<category>' / 'i:<product>' -> the name of the point it is being taken from */
  moves: Record<string, string>
}

type Ask = { key: string; what: string; from: string; apply: () => void }

const toggle = (list: string[], v: string): string[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

function firstFreeColour(used: string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()))
  return POINT_COLOURS.find((c) => !taken.has(c.toLowerCase())) ?? POINT_COLOURS[0]
}

function seedDraft(editing: PointSummary | null, usedColours: string[]): Draft {
  if (editing) {
    const c = editing.config
    return {
      name: c.name, icon: c.icon, colour: c.colour, handsOver: c.handsOver, speed: speedKeyOf(c.prepMinutes),
      cats: [...c.categoryIds], items: [...c.itemUids], excluded: [...c.excludedUids], staff: [...c.staffIds], moves: {},
    }
  }
  return {
    name: '', icon: 'utensils', colour: firstFreeColour(usedColours), handsOver: true, speed: 'medium',
    cats: [], items: [], excluded: [], staff: [], moves: {},
  }
}

export default function PointWizard({
  open,
  editing,
  state,
  onClose,
  save,
  onSaved,
}: {
  open: boolean
  editing: PointSummary | null
  state: SetupState
  onClose: () => void
  save: (config: PointConfig, pointId: string | null, move: boolean) => Promise<Reply<PointSaveResult>>
  onSaved: () => void
}) {
  const t = useT()
  const [lang] = usePosLang()
  const titleId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)

  const pointsRow = state.rows.find((r) => r.id === 'points')
  const peopleRow = state.rows.find((r) => r.id === 'people')
  const routingRow = state.rows.find((r) => r.id === 'routing')
  const points = pointsRow?.id === 'points' ? pointsRow.points : []
  const people: PersonRow[] = peopleRow?.id === 'people' ? peopleRow.people : []
  const unsold = routingRow?.id === 'routing' ? routingRow.unsold : []
  const catalogue = state.catalogue

  // The point being saved. Starts as the one being edited; "add another" clears it so
  // the next save creates instead of overwriting.
  const [targetId, setTargetId] = useState<string | null>(editing?.id ?? null)
  const [draft, setDraft] = useState<Draft>(() => seedDraft(editing, points.map((p) => p.colour)))
  const [step, setStep] = useState(0)
  const [touched, setTouched] = useState(false)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<RouteConflict[] | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const mounted = useRef(false)

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))

  // Move focus to the step's question when the step changes (not on first open — the
  // sheet focuses its own first control). A keyboard or screen-reader user otherwise
  // lands on a Next button whose content has just been replaced.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    headingRef.current?.focus()
  }, [step, done])

  // ---- indexes over the menu -------------------------------------------------------
  const pointName = (id: string | null) => (id ? (points.find((p) => p.id === id)?.name ?? '') : '')
  const catTitle = (c: CatalogueCategory) => nameOf(c.title, lang)

  const index = useMemo(() => {
    const byUid = new Map<string, { name: string; catId: string; catName: string; route: CatalogueCategory['items'][number] }>()
    for (const c of catalogue) for (const it of c.items) byUid.set(it.uid, { name: nameOf(it.name, lang), catId: c.id, catName: nameOf(c.title, lang), route: it })
    return byUid
  }, [catalogue, lang])

  const other = (id: string | null) => !!id && id !== targetId

  // ---- the local routing picture, for the live sentence ------------------------------
  const summary = useMemo(() => {
    const claimedCats = new Set(draft.cats)
    const claimedItems = new Set(draft.items)
    const others = points.filter((p) => p.id !== targetId)
    const ctx: RoutingContext = {
      points: [
        ...others.map((p) => ({ id: p.id, active: true, excluded_uids: p.config.excludedUids })),
        { id: DRAFT_ID, active: true, excluded_uids: draft.excluded },
      ],
      routes: [
        // what the other points keep: an agreed move takes the category / product away from them
        ...others.flatMap((p) => [
          ...p.config.categoryIds.filter((ref) => !claimedCats.has(ref)).map((ref) => ({ kind: 'category' as const, ref, point_id: p.id })),
          ...p.config.itemUids.filter((ref) => !claimedItems.has(ref)).map((ref) => ({ kind: 'item' as const, ref, point_id: p.id })),
        ]),
        ...draft.cats.map((ref) => ({ kind: 'category' as const, ref, point_id: DRAFT_ID })),
        ...draft.items.map((ref) => ({ kind: 'item' as const, ref, point_id: DRAFT_ID })),
      ],
      unsold,
    }
    const cats: MenuCategory[] = catalogue.map((c) => ({
      id: c.id,
      icon: c.icon ?? undefined,
      title: c.title,
      items: c.items.map((i) => ({ uid: i.uid, he: i.name.he, en: i.name.en, ar: i.name.ar })),
    }))
    const sum = summarizePoint(ctx, cats, DRAFT_ID)
    const catOfUid = new Map<string, string>()
    for (const c of catalogue) for (const it of c.items) catOfUid.set(it.uid, c.id)
    const claimedWhole = new Set(sum.categories.map((c) => c.id))
    const extras = sum.items.filter((i) => i.uid && !claimedWhole.has(catOfUid.get(i.uid) ?? '') && !claimedCats.has(catOfUid.get(i.uid) ?? ''))
    const excludedNames = draft.excluded
      .filter((uid) => claimedCats.has(catOfUid.get(uid) ?? ''))
      .map((uid) => index.get(uid)?.name ?? '')
      .filter(Boolean)
    return { count: sum.items.length, categories: sum.categories, extras, excludedNames }
  }, [draft.cats, draft.items, draft.excluded, points, targetId, unsold, catalogue, index])

  const colour = safeColour(draft.colour, POINT_COLOURS[0])
  const speedMinutes = PREP_PRESETS.find((p) => p.key === draft.speed)?.minutes ?? 8
  const nameOk = draft.name.trim().length > 0
  const hasWhat = draft.cats.length > 0 || draft.items.length > 0

  const sentence = useMemo(() => {
    const name = draft.name.trim() || t('owner.setup.wiz.titleNew')
    if (summary.count === 0) return t('owner.setup.sum.nothing', { name })
    const catNames = summary.categories.map((c) => nameOf(c.title, lang)).filter(Boolean)
    const extraNames = summary.extras.map((i) => nameOf(i, lang)).filter(Boolean)
    let what = catNames.join(', ')
    if (extraNames.length) what = what ? what + t('owner.setup.sum.extra', { names: extraNames.join(', ') }) : extraNames.join(', ')
    if (summary.excludedNames.length) what += t('owner.setup.sum.except', { names: summary.excludedNames.join(', ') })
    const count = summary.count === 1 ? t('owner.setup.card.itemOne') : t('owner.setup.card.items', { n: summary.count })
    return t('owner.setup.sum.makes', { name, what, count })
  }, [draft.name, summary, lang, t])

  // ---- the conflict asks -------------------------------------------------------------
  function takeCategory(c: CatalogueCategory) {
    if (draft.cats.includes(c.id)) {
      // un-claiming also forgets what was un-ticked inside it, and any agreed move
      const inside = new Set(c.items.map((i) => i.uid))
      const moves = { ...draft.moves }
      delete moves[`c:${c.id}`]
      patch({ cats: draft.cats.filter((x) => x !== c.id), excluded: draft.excluded.filter((u) => !inside.has(u)), moves })
      haptic('tick')
      return
    }
    const apply = (from?: string) => {
      patch({ cats: [...draft.cats, c.id], moves: from ? { ...draft.moves, [`c:${c.id}`]: from } : draft.moves })
      haptic('select')
    }
    if (other(c.ownerPointId)) {
      const from = pointName(c.ownerPointId)
      setAsk({ key: `c:${c.id}`, what: catTitle(c), from, apply: () => apply(from) })
    } else apply()
  }

  function addItem(uid: string) {
    if (draft.items.includes(uid)) {
      const moves = { ...draft.moves }
      delete moves[`i:${uid}`]
      patch({ items: draft.items.filter((x) => x !== uid), moves })
      haptic('tick')
      return
    }
    const info = index.get(uid)
    const apply = (from?: string) => {
      patch({ items: [...draft.items, uid], moves: from ? { ...draft.moves, [`i:${uid}`]: from } : draft.moves })
      haptic('select')
    }
    // the product's own point (an item-level route) or the point that makes its whole category
    const ownerId = info?.route.route === 'point' && other(info.route.pointId) ? info.route.pointId : null
    if (ownerId) {
      const from = pointName(ownerId)
      setAsk({ key: `i:${uid}`, what: info?.name ?? '', from, apply: () => apply(from) })
    } else apply()
  }

  function toggleExcluded(uid: string) {
    patch({ excluded: toggle(draft.excluded, uid) })
    haptic('tick')
  }

  const askRequest: ConfirmRequest | null = ask
    ? {
        title: t('owner.setup.s2.moveTitle'),
        body: t('owner.setup.s2.moveBody', { what: ask.what, point: ask.from }),
        confirmLabel: t('owner.setup.s2.moveYes'),
        cancelLabel: t('owner.setup.s2.moveNo'),
      }
    : null

  // ---- saving -------------------------------------------------------------------------
  function buildConfig(): PointConfig {
    const claimed = new Set(draft.cats)
    const catOf = (uid: string) => index.get(uid)?.catId ?? ''
    return {
      name: draft.name.trim(),
      icon: draft.icon as PointConfig['icon'],
      colour: draft.colour,
      handsOver: draft.handsOver,
      prepMinutes: speedMinutes,
      categoryIds: draft.cats,
      // a product inside a category this point already makes needs no route of its own
      itemUids: draft.items.filter((uid) => !claimed.has(catOf(uid))),
      excludedUids: draft.excluded.filter((uid) => claimed.has(catOf(uid))),
      staffIds: draft.staff,
    }
  }

  async function doSave(forceMove: boolean) {
    if (saving) return
    setSaving(true)
    setError(null)
    setConflicts(null)
    const r = await save(buildConfig(), targetId, forceMove || Object.keys(draft.moves).length > 0)
    setSaving(false)
    if (!r.ok) {
      setError(errorText(t, r.code))
      return
    }
    const body = r.body
    if (body.ok) {
      haptic('impact')
      onSaved()
      setDone(draft.name.trim())
      return
    }
    if (body.reason === 'conflicts') {
      setConflicts(body.conflicts)
      return
    }
    setError(body.message[lang])
    setStep(0)
  }

  function another() {
    setTargetId(null)
    setDone(null)
    setStep(0)
    setTouched(false)
    setConflicts(null)
    setError(null)
    setOpenCats({})
    setDraft(seedDraft(null, [...points.map((p) => p.colour), draft.colour]))
  }

  const labels = [
    t('owner.setup.wiz.stepName'),
    t('owner.setup.wiz.stepSells'),
    t('owner.setup.wiz.stepTune'),
    t('owner.setup.wiz.stepWorks'),
    t('owner.setup.wiz.stepReview'),
  ]

  function next() {
    if (step === 0 && !nameOk) {
      setTouched(true)
      return
    }
    setStep((s) => Math.min(STEP_COUNT - 1, s + 1))
  }
  function back() {
    if (step === 0) onClose()
    else setStep((s) => s - 1)
  }

  // ---- step 3's two lists ---------------------------------------------------------------
  const chosenCats = catalogue.filter((c) => draft.cats.includes(c.id))
  const otherCats = catalogue.filter((c) => !draft.cats.includes(c.id))

  const excludeItems = (c: CatalogueCategory): ChecklistItem[] =>
    c.items.map((it) => {
      // a product that has its own route to ANOTHER point stays with that point even when
      // this one makes the category — say so instead of offering a tick that does nothing
      const owner = it.route === 'point' && other(it.pointId) && it.via === 'item' && !draft.items.includes(it.uid) ? pointName(it.pointId) : ''
      return {
        uid: it.uid,
        name: nameOf(it.name, lang),
        checked: !owner && !draft.excluded.includes(it.uid),
        disabled: !!owner,
        note: owner ? t('owner.setup.s3.elsewhere', { point: owner }) : null,
      }
    })

  const addItems = (c: CatalogueCategory): ChecklistItem[] =>
    c.items.map((it) => {
      const owner = it.route === 'point' && other(it.pointId) ? pointName(it.pointId) : ''
      const from = draft.moves[`i:${it.uid}`]
      return {
        uid: it.uid,
        name: nameOf(it.name, lang),
        checked: draft.items.includes(it.uid),
        note: from ? t('owner.setup.s3.moves', { point: from }) : owner ? t('owner.setup.s3.elsewhere', { point: owner }) : null,
      }
    })

  const addedIn = (c: CatalogueCategory) => c.items.filter((i) => draft.items.includes(i.uid)).length
  const tickedIn = (c: CatalogueCategory) => c.items.filter((i) => !draft.excluded.includes(i.uid)).length

  const isOpen = (key: string) => !!openCats[key]
  const flip = (key: string) => setOpenCats((s) => ({ ...s, [key]: !s[key] }))

  const movedNames = Object.keys(draft.moves)
    .map((k) => {
      const ref = k.slice(2)
      if (k.startsWith('c:')) {
        const c = catalogue.find((x) => x.id === ref)
        return c ? catTitle(c) : ''
      }
      return index.get(ref)?.name ?? ''
    })
    .filter(Boolean)

  const whoNames = draft.staff.map((id) => people.find((p) => p.id === id)?.handle).filter((x): x is string => !!x)

  // ================================================================================================
  const title = targetId ? t('owner.setup.wiz.titleEdit') : t('owner.setup.wiz.titleNew')

  return (
    <SheetShell open={open} onClose={saving ? () => {} : onClose} labelledBy={titleId} suspended={!!ask} className="os-wizard">
      {/* header — fixed */}
      <div className="os-wizard__head">
        <h2 id={titleId} className="os-wizard__title">
          {title}
        </h2>
        {!done && <WizardSteps step={step} labels={labels} />}
      </div>

      {/* body — the one scrolling region */}
      <div className="sheet-scroll os-wizard__body">
        {done !== null ? (
          <div className="os-done" role="status">
            <span className="os-done__mark" aria-hidden="true">
              <Check size={34} strokeWidth={3} />
            </span>
            <h3 ref={headingRef} tabIndex={-1} className="os-q">
              {t('owner.setup.done.title')}
            </h3>
            <p className="os-note">{t('owner.setup.done.sub', { name: done })}</p>
          </div>
        ) : (
          <>
            {step === 0 && (
              <section aria-labelledby={`${titleId}-q`}>
                <h3 id={`${titleId}-q`} ref={headingRef} tabIndex={-1} className="os-q">
                  {t('owner.setup.s1.q')}
                </h3>
                <label className="os-field">
                  <span className="os-field__label">{t('owner.setup.s1.name')}</span>
                  <input
                    className="os-input"
                    value={draft.name}
                    maxLength={40}
                    placeholder={t('owner.setup.s1.namePh')}
                    aria-invalid={touched && !nameOk}
                    onChange={(e) => patch({ name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') next()
                    }}
                  />
                </label>
                {!nameOk && (
                  <p role={touched ? 'alert' : undefined} className={touched ? 'os-error' : 'os-note os-note--why'}>
                    {t('owner.setup.s1.nameNeeded')}
                  </p>
                )}
                {error && (
                  <p role="alert" className="os-error">
                    {error}
                  </p>
                )}

                <div className="os-field">
                  <span className="os-field__label" id={`${titleId}-icon`}>
                    {t('owner.setup.s1.icon')}
                  </span>
                  <div role="radiogroup" aria-labelledby={`${titleId}-icon`} className="os-icons">
                    {POINT_ICONS.map((key) => {
                      const Icon = resolveCategoryIcon(key)
                      const sel = draft.icon === key
                      return (
                        <button
                          key={key}
                          type="button"
                          role="radio"
                          aria-checked={sel}
                          aria-label={t(`owner.setup.s1.iconName.${key}` as StrKey)}
                          className="os-iconbtn press"
                          data-selected={sel}
                          onClick={() => {
                            patch({ icon: key })
                            haptic('tick')
                          }}
                        >
                          <Icon size={22} strokeWidth={2} aria-hidden="true" />
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="os-field">
                  <span className="os-field__label" id={`${titleId}-colour`}>
                    {t('owner.setup.s1.colour')}
                  </span>
                  <div role="radiogroup" aria-labelledby={`${titleId}-colour`} className="os-swatches">
                    {POINT_COLOURS.map((c, i) => {
                      const sel = draft.colour.toLowerCase() === c.toLowerCase()
                      return (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={sel}
                          aria-label={t('owner.setup.s1.colourN', { n: i + 1 })}
                          className="os-swatch press"
                          data-selected={sel}
                          style={{ background: c, color: inkOn(c) }}
                          onClick={() => {
                            patch({ colour: c })
                            haptic('tick')
                          }}
                        >
                          {sel && <Check size={20} strokeWidth={3} aria-hidden="true" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </section>
            )}

            {step === 1 && (
              <section aria-labelledby={`${titleId}-q`}>
                <h3 id={`${titleId}-q`} ref={headingRef} tabIndex={-1} className="os-q">
                  {t('owner.setup.s2.q')}
                </h3>
                <p className="os-note">{t('owner.setup.s2.hint')}</p>
                {catalogue.length === 0 ? (
                  <p className="os-note">{t('owner.setup.s2.none')}</p>
                ) : (
                  <div className="os-tiles">
                    {catalogue.map((c) => {
                      const selected = draft.cats.includes(c.id)
                      return (
                        <CategoryTile
                          key={c.id}
                          icon={c.icon}
                          title={catTitle(c)}
                          count={c.items.length}
                          selected={selected}
                          soldAt={!selected && other(c.ownerPointId) ? pointName(c.ownerPointId) : null}
                          movesFrom={selected ? (draft.moves[`c:${c.id}`] ?? null) : null}
                          unsold={c.unsold && !c.ownerPointId}
                          onClick={() => takeCategory(c)}
                        />
                      )
                    })}
                  </div>
                )}
                <p className="os-live" aria-live="polite">
                  {draft.cats.length === 1 ? t('owner.setup.s2.chosenOne') : t('owner.setup.s2.chosen', { n: draft.cats.length })}
                  {' · '}
                  {summary.count === 1 ? t('owner.setup.card.itemOne') : t('owner.setup.card.items', { n: summary.count })}
                </p>
              </section>
            )}

            {step === 2 && (
              <section aria-labelledby={`${titleId}-q`}>
                <h3 id={`${titleId}-q`} ref={headingRef} tabIndex={-1} className="os-q">
                  {t('owner.setup.s3.q')}
                </h3>
                <p className="os-note">{t('owner.setup.s3.hint')}</p>

                <h4 className="os-h4">{t('owner.setup.s3.chosenHead')}</h4>
                {chosenCats.length === 0 ? (
                  <p className="os-note">{t('owner.setup.s3.noneChosen')}</p>
                ) : (
                  <>
                    <p className="os-note">{t('owner.setup.s3.chosenHint')}</p>
                    {chosenCats.map((c) => {
                      const key = `x:${c.id}`
                      const open = isOpen(key)
                      return (
                        <div key={c.id} className="os-acc">
                          <button
                            type="button"
                            className="os-acc__head press"
                            aria-expanded={open}
                            aria-label={open ? t('owner.setup.s3.hide', { name: catTitle(c) }) : t('owner.setup.s3.show', { name: catTitle(c) })}
                            onClick={() => flip(key)}
                          >
                            <span className="os-acc__name">{catTitle(c)}</span>
                            <span className="os-acc__count">{t('owner.setup.s3.ofTotal', { a: tickedIn(c), b: c.items.length })}</span>
                            <ChevronDown size={18} strokeWidth={2} aria-hidden="true" className="os-group__chev" data-open={open} />
                          </button>
                          {open && <ItemChecklist label={catTitle(c)} items={excludeItems(c)} onToggle={toggleExcluded} />}
                        </div>
                      )
                    })}
                  </>
                )}

                <h4 className="os-h4">{t('owner.setup.s3.otherHead')}</h4>
                <p className="os-note">{t('owner.setup.s3.otherHint')}</p>
                {otherCats.map((c) => {
                  const key = `a:${c.id}`
                  const open = isOpen(key)
                  const n = addedIn(c)
                  return (
                    <div key={c.id} className="os-acc">
                      <button
                        type="button"
                        className="os-acc__head press"
                        aria-expanded={open}
                        aria-label={open ? t('owner.setup.s3.hide', { name: catTitle(c) }) : t('owner.setup.s3.show', { name: catTitle(c) })}
                        onClick={() => flip(key)}
                      >
                        <span className="os-acc__name">{catTitle(c)}</span>
                        {n > 0 && <span className="os-acc__count os-acc__count--on">{t('owner.setup.s3.added', { n })}</span>}
                        <ChevronDown size={18} strokeWidth={2} aria-hidden="true" className="os-group__chev" data-open={open} />
                      </button>
                      {open && <ItemChecklist label={catTitle(c)} items={addItems(c)} onToggle={addItem} />}
                    </div>
                  )
                })}
                <p className="os-live" aria-live="polite">
                  {summary.count === 1 ? t('owner.setup.card.itemOne') : t('owner.setup.card.items', { n: summary.count })}
                </p>
              </section>
            )}

            {step === 3 && (
              <section aria-labelledby={`${titleId}-q`}>
                <h3 id={`${titleId}-q`} ref={headingRef} tabIndex={-1} className="os-q">
                  {t('owner.setup.s4.q')}
                </h3>

                <fieldset className="os-fieldset">
                  <legend className="os-field__label">{t('owner.setup.s4.handsQ')}</legend>
                  <div className="os-two">
                    {[true, false].map((v) => (
                      <label key={String(v)} className="os-choice" data-selected={draft.handsOver === v}>
                        <input type="radio" name="hands" className="os-choice__input" checked={draft.handsOver === v} onChange={() => patch({ handsOver: v })} />
                        <span className="os-choice__text">
                          <span className="os-choice__title">{v ? t('owner.setup.s4.handsYes') : t('owner.setup.s4.handsNo')}</span>
                          <span className="os-choice__hint">{v ? t('owner.setup.s4.handsYesHint') : t('owner.setup.s4.handsNoHint')}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="os-fieldset">
                  <legend className="os-field__label">{t('owner.setup.s4.speedQ')}</legend>
                  <div className="os-three">
                    {PREP_PRESETS.map((p) => (
                      <label key={p.key} className="os-choice" data-selected={draft.speed === p.key}>
                        <input type="radio" name="speed" className="os-choice__input" checked={draft.speed === p.key} onChange={() => patch({ speed: p.key })} />
                        <span className="os-choice__text">
                          <span className="os-choice__title">{t(`owner.setup.s4.speed.${p.key}`)}</span>
                          <span className="os-choice__hint">{t('owner.setup.s4.speedAbout', { n: p.minutes })}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="os-note">{t('owner.setup.s4.speedWhy')}</p>
                </fieldset>

                <fieldset className="os-fieldset">
                  <legend className="os-field__label">{t('owner.setup.s4.whoQ')}</legend>
                  {people.length === 0 ? (
                    <p className="os-note">{t('owner.setup.s4.whoNone')}</p>
                  ) : (
                    <ul className="os-people">
                      {people.map((p) => {
                        const on = draft.staff.includes(p.id)
                        return (
                          <li key={p.id}>
                            <button
                              type="button"
                              className="os-person press"
                              aria-pressed={on}
                              data-selected={on}
                              onClick={() => {
                                patch({ staff: toggle(draft.staff, p.id) })
                                haptic('tick')
                              }}
                            >
                              <span className="os-handle__dot" aria-hidden="true" style={{ background: safeColour(p.colour, '#B9ADA0') }} />
                              <span className="ltr-isolate">{p.handle}</span>
                              {on && <Check size={16} strokeWidth={3} aria-hidden="true" />}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  <p className="os-note">{t('owner.setup.s4.whoNote')}</p>
                </fieldset>
              </section>
            )}

            {step === 4 && (
              <section aria-labelledby={`${titleId}-q`}>
                <h3 id={`${titleId}-q`} ref={headingRef} tabIndex={-1} className="os-q">
                  {t('owner.setup.s5.q')}
                </h3>
                <div className="os-review" style={{ ['--os-point' as string]: colour }}>
                  <span className="os-card__icon" aria-hidden="true" style={{ background: colour, color: inkOn(colour) }}>
                    {(() => {
                      const Icon = resolveCategoryIcon(draft.icon)
                      return <Icon size={22} strokeWidth={2} />
                    })()}
                  </span>
                  <div>
                    <p className="os-review__line" aria-live="polite">
                      {sentence}
                    </p>
                    <p className="os-review__line">{draft.handsOver ? t('owner.setup.sum.handsYes') : t('owner.setup.sum.handsNo')}</p>
                    <p className="os-review__line">{t('owner.setup.sum.speed', { n: speedMinutes })}</p>
                    {whoNames.length > 0 && <p className="os-review__line">{t('owner.setup.sum.who', { names: whoNames.join(', ') })}</p>}
                    {movedNames.length > 0 && <p className="os-review__line">{t('owner.setup.sum.moves', { names: movedNames.join(', ') })}</p>}
                  </div>
                </div>

                {conflicts && (
                  <div className="os-conflict" role="alert">
                    <h4 className="os-h4">{t('owner.setup.conflict.title')}</h4>
                    <ul>
                      {conflicts.map((c) => (
                        <li key={`${c.kind}:${c.ref}`}>
                          {t('owner.setup.conflict.line', { what: c.label ? nameOf(c.label, lang) : (index.get(c.ref)?.name ?? catalogue.find((x) => x.id === c.ref)?.title.he ?? ''), point: c.pointName })}
                        </li>
                      ))}
                    </ul>
                    <div className="os-conflict__actions">
                      <button type="button" className="os-btn os-btn--primary press" disabled={saving} onClick={() => void doSave(true)}>
                        {t('owner.setup.conflict.move')}
                      </button>
                      <button type="button" className="os-btn os-btn--ghost press" onClick={() => setConflicts(null)}>
                        {t('owner.setup.conflict.back')}
                      </button>
                    </div>
                  </div>
                )}
                {error && (
                  <p role="alert" className="os-error">
                    {error}
                  </p>
                )}
                {!hasWhat && <p className="os-note os-note--why">{t('owner.setup.saveNeedsItems')}</p>}
              </section>
            )}
          </>
        )}
      </div>

      {/* footer — fixed, so the primary action is always inside the viewport */}
      <div className="os-wizard__foot">
        {done !== null ? (
          <>
            <button type="button" className="os-btn os-btn--ghost press" onClick={another}>
              {t('owner.setup.done.another')}
            </button>
            <button type="button" className="os-btn os-btn--primary press" onClick={onClose}>
              {t('owner.setup.done.list')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="os-btn os-btn--ghost press" onClick={back} disabled={saving}>
              {step > 0 ? <ArrowRight size={18} strokeWidth={2} aria-hidden="true" className="os-flip" /> : null}
              {step === 0 ? t('owner.setup.wiz.cancel') : t('owner.setup.wiz.back')}
            </button>
            {step < STEP_COUNT - 1 ? (
              <button type="button" className="os-btn os-btn--primary press" onClick={next} aria-disabled={step === 0 && !nameOk}>
                {t('owner.setup.wiz.next')}
                <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" className="os-flip" />
              </button>
            ) : (
              <button type="button" className="os-btn os-btn--primary press" onClick={() => void doSave(false)} disabled={saving || !hasWhat || !nameOk}>
                {saving ? t('owner.setup.saving') : t('owner.setup.save')}
              </button>
            )}
          </>
        )}
      </div>

      <ConfirmSheet
        request={askRequest}
        onConfirm={() => {
          ask?.apply()
          setAsk(null)
        }}
        onCancel={() => setAsk(null)}
      />
    </SheetShell>
  )
}
