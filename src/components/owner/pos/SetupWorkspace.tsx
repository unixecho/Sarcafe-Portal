'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import ModalPortal from '@/components/ModalPortal'
import { setCurrentBranchCookie } from '@/lib/branches/current'
import type {
  PointConfig, PointDeactivateResult, PointSaveResult, PointSummary, ReadinessRow, SessionAction, SessionActionOk,
  SessionActionRefused, SettingsPatchBody, SettingsPayload, SettingsRefused, SetupState,
} from '@/lib/pos/owner-api'
import { usePosLang, useT } from '@/lib/pos/useT'
import { errorText } from '@/components/pos/shell/errorText'
import EventSheet, { type EventSource } from './EventSheet'
import OwnerPosHeader, { type EventLite } from './OwnerPosHeader'
import PointWizard from './PointWizard'
import ReadinessList from './ReadinessList'

import './setup.css'

// The owner's setup page. It owns the state and every call to /api/owner/pos/*; the
// rows, the wizard and the sheets below it are given plain callbacks and know nothing
// about fetch.
//
// FIRST PAINT is the server's: the page reads the checklist and passes it in as
// `initial`, so there is no spinner and no flash of an empty list. After that the
// checklist is refreshed silently whenever something changes (and when the tab comes
// back into view) — the old content stays on screen until the new arrives, so a card
// never blinks or jumps.
//
// OPTIMISTIC where it is cheap and obviously right: deciding an unrouted item removes
// its row at once and puts it back, with a plain sentence, if the save is refused. The
// saves are run one after another because the "not sold" list is replaced whole — two
// in flight at once would silently lose one of them.

/** A transport-level answer. A refusal ("already sold at another point") is NOT a failure: it
 *  is `ok: true` with the refusal as the body, because the screen has something to offer for it. */
export type Reply<T> = { ok: true; body: T } | { ok: false; code: string }

async function call<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<Reply<T>> {
  try {
    const res = await fetch(path, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    // an expired sign-in is bounced to the login page, which fetch follows and reads as 200 HTML
    if (res.redirected && /\/login/.test(res.url)) return { ok: false, code: 'unauthorized' }
    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      return { ok: false, code: res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : 'internal_error' }
    }
    const env = json as { error?: { code?: string } } | null
    if (env && typeof env === 'object' && env.error) return { ok: false, code: env.error.code ?? 'internal_error' }
    if (!res.ok && !(env && typeof env === 'object' && 'ok' in env)) return { ok: false, code: 'internal_error' }
    return { ok: true, body: json as T }
  } catch {
    return { ok: false, code: 'network' }
  }
}

type Notice = { id: number; text: string; tone: 'ok' | 'bad' } | null
type WizardState = { key: number; open: boolean; editing: PointSummary | null }

export default function SetupWorkspace({
  events,
  sources,
  initialSlug,
  initial,
  canCreateEvent,
}: {
  events: EventLite[]
  sources: EventSource[]
  initialSlug: string
  initial: SetupState | null
  canCreateEvent: boolean
}) {
  const t = useT()
  const [lang] = usePosLang()
  const router = useRouter()
  const slug = initialSlug
  const [state, setState] = useState<SetupState | null>(initial)
  const [loadFailed, setLoadFailed] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [wizard, setWizard] = useState<WizardState>({ key: 0, open: false, editing: null })
  const [eventSheet, setEventSheet] = useState(false)
  const [stopping, setStopping] = useState<PointSummary | null>(null)
  const [turningOn, setTurningOn] = useState(false)

  // the saves that are still on their way: while any are, a refresh must not overwrite
  // the optimistic picture with the server's older one
  const inFlight = useRef(0)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const noticeTimer = useRef<number | undefined>(undefined)

  const notify = useCallback((text: string, tone: 'ok' | 'bad' = 'ok') => {
    setNotice({ id: Date.now(), text, tone })
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), tone === 'bad' ? 6000 : 3200)
  }, [])
  useEffect(() => () => window.clearTimeout(noticeTimer.current), [])

  // ---- reading --------------------------------------------------------------------------
  const reload = useCallback(async () => {
    if (!slug || inFlight.current > 0) return
    const r = await call<SetupState>('GET', `/api/owner/pos/setup?branch=${encodeURIComponent(slug)}`)
    if (inFlight.current > 0) return
    if (r.ok) {
      setState(r.body)
      setLoadFailed(false)
    } else setLoadFailed(true)
  }, [slug])

  // the server could not read it for first paint -> read it now; otherwise only refresh
  // when the owner comes back to the tab (they may have fixed something in the editor)
  useEffect(() => {
    if (slug && !initial) void reload()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  /** Run a write after the ones before it, hand its answer to `onResult`, then refresh. */
  const queued = useCallback(
    function <T>(job: () => Promise<Reply<T>>, onResult: (r: Reply<T>) => void): Promise<Reply<T>> {
      inFlight.current += 1
      const run = chain.current.then(job, job)
      chain.current = run.catch(() => undefined)
      return run.then(
        (r) => {
          inFlight.current -= 1
          onResult(r)
          void reload()
          return r
        },
        () => {
          inFlight.current -= 1
          void reload()
          return { ok: false, code: 'internal_error' } as Reply<T>
        },
      )
    },
    [reload],
  )

  // ---- the writes -------------------------------------------------------------------------
  const patchSettings = useCallback(
    (body: Omit<SettingsPatchBody, 'branch'>) =>
      call<SettingsPayload | SettingsRefused>('PATCH', '/api/owner/pos/settings', { branch: slug, ...body }),
    [slug],
  )

  const turnOn = useCallback(async () => {
    if (turningOn) return
    setTurningOn(true)
    const r = await queued(() => patchSettings({ enabled: true }), () => undefined)
    setTurningOn(false)
    if (!r.ok) notify(errorText(t, r.code), 'bad')
    else if ('ok' in r.body && r.body.ok === false) notify(r.body.message[lang], 'bad')
    else notify(t('owner.setup.event.turnedOn'))
  }, [turningOn, queued, patchSettings, notify, t, lang])

  const rotateBoard = useCallback(async () => {
    const r = await queued(() => patchSettings({ rotateBoardToken: true }), () => undefined)
    if (!r.ok) {
      notify(errorText(t, r.code), 'bad')
      return false
    }
    if ('ok' in r.body && r.body.ok === false) {
      notify(r.body.message[lang], 'bad')
      return false
    }
    return true
  }, [queued, patchSettings, notify, t, lang])

  const runSession = useCallback(
    (action: SessionAction) =>
      queued(() => call<SessionActionOk | SessionActionRefused>('POST', '/api/owner/pos/session', { branch: slug, action }), () => undefined),
    [queued, slug],
  )

  const savePoint = useCallback(
    (config: PointConfig, pointId: string | null, move: boolean) =>
      queued(
        () =>
          pointId
            ? call<PointSaveResult>('PATCH', '/api/owner/pos/points', { branch: slug, pointId, config, ...(move ? { move: true } : {}) })
            : call<PointSaveResult>('POST', '/api/owner/pos/points', { branch: slug, config, ...(move ? { move: true } : {}) }),
        () => undefined,
      ),
    [queued, slug],
  )

  const stopPoint = useCallback(
    async (p: PointSummary) => {
      const r = await queued(
        () => call<PointDeactivateResult>('DELETE', `/api/owner/pos/points?branch=${encodeURIComponent(slug)}&pointId=${encodeURIComponent(p.id)}`),
        () => undefined,
      )
      if (!r.ok) notify(errorText(t, r.code), 'bad')
      else if (r.body.ok === false) notify(t('owner.setup.stop.refused'), 'bad')
      else notify(t('owner.setup.stop.done'))
    },
    [queued, slug, notify, t],
  )

  // ---- the unrouted list: decided on the spot, undone if refused -----------------------------
  /** Take rows out of the list now; the returned function puts them back. */
  function hideUnrouted(uids: string[]): () => void {
    const gone = new Set(uids)
    let removed: SetupState['rows'] = []
    setState((s) => {
      if (!s) return s
      removed = s.rows
      return {
        ...s,
        rows: s.rows.map((row: ReadinessRow) => (row.id === 'routing' ? { ...row, unrouted: row.unrouted.filter((u) => !gone.has(u.uid)) } : row)),
      }
    })
    return () =>
      setState((s) => {
        if (!s) return s
        const before = removed.find((r) => r.id === 'routing')
        if (!before || before.id !== 'routing') return s
        const back = before.unrouted.filter((u) => gone.has(u.uid))
        return {
          ...s,
          rows: s.rows.map((row: ReadinessRow) => (row.id === 'routing' ? { ...row, unrouted: [...row.unrouted, ...back] } : row)),
        }
      })
  }

  function assign(uids: string[], pointId: string) {
    const point = state?.rows.flatMap((r) => (r.id === 'points' ? r.points : [])).find((p) => p.id === pointId)
    if (!point) return
    const undo = hideUnrouted(uids)
    const config: PointConfig = {
      ...point.config,
      itemUids: Array.from(new Set([...point.config.itemUids, ...uids])),
      // an item being given to this point must not stay on its opt-out list
      excludedUids: point.config.excludedUids.filter((u) => !uids.includes(u)),
    }
    void queued(
      () => call<PointSaveResult>('PATCH', '/api/owner/pos/points', { branch: slug, pointId, config }),
      (r) => {
        if (r.ok && r.body.ok) {
          notify(t('owner.setup.unrouted.assigned', { point: point.name }))
          return
        }
        undo()
        notify(r.ok && !r.body.ok ? r.body.message[lang] : r.ok ? t('errors.generic') : errorText(t, r.code), 'bad')
      },
    )
  }

  function markUnsold(uids: string[]) {
    const routing = state?.rows.find((r) => r.id === 'routing')
    if (!routing || routing.id !== 'routing') return
    const undo = hideUnrouted(uids)
    const unsold = Array.from(new Set([...routing.unsold, ...uids.map((u) => `i:${u}`)]))
    void queued(
      () => patchSettings({ unsold }),
      (r) => {
        if (r.ok && !('ok' in r.body && r.body.ok === false)) {
          notify(t('owner.setup.unrouted.markedUnsold'))
          return
        }
        undo()
        notify(r.ok && 'ok' in r.body && r.body.ok === false ? r.body.message[lang] : r.ok ? t('errors.generic') : errorText(t, r.code), 'bad')
      },
    )
  }

  // ---- creating an event ---------------------------------------------------------------------
  async function createEvent(name: string, cloneSlug: string | null): Promise<string | null> {
    // The web address of a one-off event is made for the owner; nobody should have to
    // invent an English "code" for a festival.
    const newSlug = `ev-${Date.now().toString(36)}`
    const r = await call<{ slug: string; cloneFailed?: boolean }>('POST', '/api/owner/branches', {
      slug: newSlug,
      name: { he: name },
      kind: 'event',
      ...(cloneSlug ? { cloneFromSlug: cloneSlug } : {}),
    })
    if (!r.ok) return errorText(t, r.code)
    setCurrentBranchCookie(r.body.slug ?? newSlug)
    // switch the register on straight away — creating an event to look at an empty "off"
    // checklist would be one more thing to do. A failure here just leaves row 1 asking.
    await call('PATCH', '/api/owner/pos/settings', { branch: r.body.slug ?? newSlug, enabled: true })
    notify(r.body.cloneFailed ? t('owner.setup.event.cloneFailed') : t('owner.setup.event.created'), r.body.cloneFailed ? 'bad' : 'ok')
    router.refresh()
    return null
  }

  // ---- the wizard ----------------------------------------------------------------------------
  const openWizard = (editing: PointSummary | null) => setWizard((w) => ({ key: w.key + 1, open: true, editing }))
  const closeWizard = () => setWizard((w) => ({ ...w, open: false }))

  const eventName = events.find((e) => e.slug === slug)?.label ?? state?.branch.name.he ?? ''

  const stopRequest: ConfirmRequest | null = useMemo(
    () =>
      stopping
        ? {
            title: t('owner.setup.stop.title', { name: stopping.name }),
            body: stopping.liveItems > 0 ? `${t('owner.setup.card.busy', { n: stopping.liveItems })}. ${t('owner.setup.stop.refused')}` : t('owner.setup.stop.body'),
            confirmLabel: t('owner.setup.stop.confirm'),
            cancelLabel: t('owner.setup.wiz.cancel'),
            danger: true,
          }
        : null,
    [stopping, t],
  )

  return (
    <>
      <main id="main" tabIndex={-1} className="os-page">
        <OwnerPosHeader events={events} current={slug} />
        {loadFailed && !state ? (
          <div className="os-empty" role="alert">
            <p>{t('owner.setup.loadFailed')}</p>
            <button type="button" className="os-btn os-btn--primary press" onClick={() => void reload()}>
              {t('owner.setup.retry')}
            </button>
          </div>
        ) : !state && slug ? (
          // the server could not read it for first paint and the client read is on its way
          <ul className="os-rows" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="sk os-skel" />
            ))}
          </ul>
        ) : (
          <ReadinessList
            state={state}
            eventName={eventName}
            canCreateEvent={canCreateEvent}
            onCreateEvent={() => setEventSheet(true)}
            onTurnOn={() => void turnOn()}
            turningOn={turningOn}
            onAddPoint={() => openWizard(null)}
            onEditPoint={(p) => openWizard(p)}
            onStopPoint={(p) => setStopping(p)}
            onAssign={assign}
            onUnsold={markUnsold}
            onRotateBoard={rotateBoard}
            runSession={runSession}
            onSessionDone={notify}
            notify={notify}
            onRetry={() => void reload()}
          />
        )}
      </main>

      {state && wizard.key > 0 && (
        <PointWizard
          key={wizard.key}
          open={wizard.open}
          editing={wizard.editing}
          state={state}
          onClose={closeWizard}
          save={savePoint}
          onSaved={() => void reload()}
        />
      )}

      <EventSheet open={eventSheet} onClose={() => setEventSheet(false)} sources={sources} onCreate={createEvent} />

      <ConfirmSheet
        request={stopRequest}
        onConfirm={() => {
          const p = stopping
          setStopping(null)
          if (p) void stopPoint(p)
        }}
        onCancel={() => setStopping(null)}
      />

      {notice && (
        <ModalPortal>
          <div className="os-toast" data-tone={notice.tone} role={notice.tone === 'bad' ? 'alert' : 'status'} key={notice.id}>
            {notice.text}
          </div>
        </ModalPortal>
      )}
    </>
  )
}
