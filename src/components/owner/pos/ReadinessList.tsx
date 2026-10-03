'use client'

import Link from 'next/link'
import { CalendarPlus, ClipboardList, Plus, Power, Users } from 'lucide-react'
import type {
  BoardRow, EventRow, MenuRow, PeopleRow, PointsRow, PointSummary, ReadinessId, ReadinessStatus, RoutingRow,
  SessionAction, SessionActionOk, SessionActionRefused, SessionRowSetup, SetupState,
} from '@/lib/pos/owner-api'
import { useT } from '@/lib/pos/useT'
import { safeColour } from '@/components/pos/shell/safeColour'
import type { StrKey } from '@/lib/pos/i18n'
import BoardLinkCard from './BoardLinkCard'
import PointCard from './PointCard'
import ReadinessRowView from './ReadinessRow'
import SessionButton from './SessionButton'
import type { Reply } from './SetupWorkspace'
import UnroutedList from './UnroutedList'

// The checklist itself: seven rows in the order the owner should do them, each saying
// in one plain sentence where it stands and offering one big button. The first row
// that is not finished is marked as the next step, so the page tells the owner what to
// do instead of presenting a form. Rows that depend on an earlier one say what they
// are waiting for rather than just going grey.

type Props = {
  /** null => there is no event yet: only the first row is shown */
  state: SetupState | null
  eventName: string
  canCreateEvent: boolean
  onCreateEvent: () => void
  onTurnOn: () => void
  turningOn: boolean
  onAddPoint: () => void
  onEditPoint: (p: PointSummary) => void
  onStopPoint: (p: PointSummary) => void
  onAssign: (uids: string[], pointId: string) => void
  onUnsold: (uids: string[]) => void
  onRotateBoard: () => Promise<boolean>
  runSession: (a: SessionAction) => Promise<Reply<SessionActionOk | SessionActionRefused>>
  onSessionDone: (message: string, tone?: 'ok' | 'bad') => void
  notify: (text: string, tone?: 'ok' | 'bad') => void
  onRetry: () => void
}

const find = <T extends { id: ReadinessId }>(state: SetupState | null, id: T['id']) => state?.rows.find((r) => r.id === id) as T | undefined

export default function ReadinessList(p: Props) {
  const t = useT()
  const state = p.state

  const event = find<EventRow>(state, 'event')
  const menu = find<MenuRow>(state, 'menu')
  const points = find<PointsRow>(state, 'points')
  const routing = find<RoutingRow>(state, 'routing')
  const people = find<PeopleRow>(state, 'people')
  const board = find<BoardRow>(state, 'board')
  const session = find<SessionRowSetup>(state, 'session')

  // the step to do next = the first row that is neither done nor merely waiting
  const order: { id: ReadinessId; status: ReadinessStatus; known: boolean }[] = state
    ? state.rows.map((r) => ({ id: r.id, status: r.status, known: r.known }))
    : []
  const nextId = order.find((r) => r.known && r.status === 'attention')?.id ?? null
  const titleOf = (id: ReadinessId) => t(`owner.setup.${id}.title` as StrKey)
  const sessionOpen = !!session?.active
  const allReady = !!state && state.canOpen && !sessionOpen

  // ---- no event yet -----------------------------------------------------------------
  if (!state) {
    return (
      <ol className="os-rows">
        <ReadinessRowView
          n={1}
          title={t('owner.setup.event.title')}
          status="attention"
          isNext
          summary={p.canCreateEvent ? t('owner.setup.event.none') : t('owner.setup.event.noneManager')}
          action={
            p.canCreateEvent ? (
              <button type="button" className="os-btn os-btn--big os-btn--primary press" onClick={p.onCreateEvent}>
                <CalendarPlus size={22} strokeWidth={2} aria-hidden="true" />
                {t('owner.setup.event.createFirst')}
              </button>
            ) : null
          }
        />
      </ol>
    )
  }

  const menuBlocked = menu?.status === 'blocked'
  const blockedBy = session?.blockedBecause ?? null
  const sessionReason = blockedBy
    ? t(`owner.setup.session.blocked.${blockedBy === 'event' || blockedBy === 'menu' || blockedBy === 'points' || blockedBy === 'routing' ? blockedBy : 'other'}` as StrKey)
    : t('owner.setup.session.blocked.other')

  return (
    <>
      <p className="os-next" role="status">
        {allReady ? t('owner.setup.allReady') : nextId ? t('owner.setup.next', { title: titleOf(nextId) }) : t('owner.setup.intro')}
      </p>
      <ol className="os-rows">
        {/* 1. the event */}
        {event && (
          <ReadinessRowView
            n={1}
            title={t('owner.setup.event.title')}
            status={event.status}
            known={event.known}
            isNext={nextId === 'event'}
            onRetry={p.onRetry}
            delay={0}
            summary={event.enabled ? t('owner.setup.event.on', { name: p.eventName }) : t('owner.setup.event.off', { name: p.eventName })}
            action={
              <>
                {!event.enabled && (
                  <button type="button" className="os-btn os-btn--big os-btn--primary press" disabled={p.turningOn} onClick={p.onTurnOn}>
                    <Power size={22} strokeWidth={2} aria-hidden="true" />
                    {t('owner.setup.event.turnOn')}
                  </button>
                )}
                {p.canCreateEvent && (
                  <button type="button" className="os-btn os-btn--ghost press" onClick={p.onCreateEvent}>
                    <CalendarPlus size={18} strokeWidth={2} aria-hidden="true" />
                    {t('owner.setup.event.create')}
                  </button>
                )}
              </>
            }
          />
        )}

        {/* 2. the menu */}
        {menu && (
          <ReadinessRowView
            n={2}
            title={t('owner.setup.menu.title')}
            status={menu.status}
            known={menu.known}
            isNext={nextId === 'menu'}
            onRetry={p.onRetry}
            delay={40}
            summary={
              !menu.published
                ? t('owner.setup.menu.empty')
                : menu.unpublishedChanges
                  ? t('owner.setup.menu.unpublished', { items: menu.itemCount, cats: menu.categoryCount })
                  : menu.itemsWithoutId > 0
                    ? t('owner.setup.menu.noId')
                    : t('owner.setup.menu.ok', { items: menu.itemCount, cats: menu.categoryCount })
            }
            action={
              <Link href="/owner/editor" className={`os-btn ${menu.status === 'done' ? 'os-btn--ghost' : 'os-btn--primary os-btn--big'} press`}>
                <ClipboardList size={menu.status === 'done' ? 18 : 22} strokeWidth={2} aria-hidden="true" />
                {menu.status === 'done' ? t('owner.setup.menu.edit') : t('owner.setup.menu.publish')}
              </Link>
            }
          />
        )}

        {/* 3. selling points */}
        {points && (
          <ReadinessRowView
            n={3}
            title={t('owner.setup.points.title')}
            status={points.status}
            known={points.known}
            isNext={nextId === 'points'}
            onRetry={p.onRetry}
            delay={80}
            reason={t('owner.setup.points.addBlocked')}
            summary={
              points.points.length === 0
                ? t('owner.setup.points.none')
                : points.points.length === 1
                  ? t('owner.setup.points.one')
                  : t('owner.setup.points.some', { n: points.points.length })
            }
            action={
              <button
                type="button"
                className={`os-btn ${points.points.length === 0 ? 'os-btn--big os-btn--primary' : 'os-btn--ghost'} press`}
                disabled={menuBlocked}
                onClick={p.onAddPoint}
              >
                <Plus size={points.points.length === 0 ? 22 : 18} strokeWidth={2.25} aria-hidden="true" />
                {t('owner.setup.points.add')}
              </button>
            }
          >
            {points.known && points.points.length > 0 && (
              <ul className="os-cards">
                {points.points.map((pt, i) => (
                  <PointCard
                    key={pt.id}
                    point={pt}
                    people={people?.people ?? []}
                    delay={i * 30}
                    onEdit={() => p.onEditPoint(pt)}
                    onStop={() => p.onStopPoint(pt)}
                  />
                ))}
              </ul>
            )}
          </ReadinessRowView>
        )}

        {/* 4. everything has a point — the gate for opening */}
        {routing && (
          <ReadinessRowView
            n={4}
            title={t('owner.setup.routing.title')}
            status={routing.status}
            known={routing.known}
            isNext={nextId === 'routing'}
            onRetry={p.onRetry}
            delay={120}
            reason={t('owner.setup.routing.blocked')}
            summary={
              routing.unrouted.length === 0
                ? t('owner.setup.routing.ok')
                : (
                    <>
                      <strong>{routing.unrouted.length === 1 ? t('owner.setup.routing.one') : t('owner.setup.routing.some', { n: routing.unrouted.length })}</strong>
                      <span className="os-row__hint">{t('owner.setup.routing.hint')}</span>
                    </>
                  )
            }
          >
            {routing.known && routing.status === 'attention' && routing.unrouted.length > 0 && points && (
              <UnroutedList items={routing.unrouted} points={points.points} onAssign={p.onAssign} onUnsold={p.onUnsold} />
            )}
          </ReadinessRowView>
        )}

        {/* 5. people */}
        {people && (
          <ReadinessRowView
            n={5}
            title={t('owner.setup.people.title')}
            status={people.status}
            known={people.known}
            isNext={nextId === 'people'}
            onRetry={p.onRetry}
            delay={160}
            summary={
              people.people.length === 0
                ? t('owner.setup.people.none')
                : people.unconfirmed === 0
                  ? t('owner.setup.people.ok')
                  : (
                      <>
                        <strong>{people.unconfirmed === 1 ? t('owner.setup.people.one') : t('owner.setup.people.some', { n: people.unconfirmed })}</strong>
                        <span className="os-row__hint">{t('owner.setup.people.hint')}</span>
                      </>
                    )
            }
            action={
              <Link href="/owner/staff" className="os-btn os-btn--ghost press">
                <Users size={18} strokeWidth={2} aria-hidden="true" />
                {t('owner.setup.people.manage')}
              </Link>
            }
          >
            {people.known && people.unconfirmed > 0 && (
              <div className="os-people-list">
                <span className="os-card__whoLabel">{t('owner.setup.people.list')}</span>
                <ul className="os-handles">
                  {people.people
                    .filter((x) => !x.handleConfirmed)
                    .map((x) => (
                      <li key={x.id} className="os-handle">
                        <span className="os-handle__dot" aria-hidden="true" style={{ background: safeColour(x.colour, '#B9ADA0') }} />
                        <span className="ltr-isolate">{x.handle}</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </ReadinessRowView>
        )}

        {/* 6. the orders board */}
        {board && (
          <ReadinessRowView
            n={6}
            title={t('owner.setup.board.title')}
            status={board.status}
            known={board.known}
            isNext={nextId === 'board'}
            onRetry={p.onRetry}
            delay={200}
            summary={t('owner.setup.board.desc')}
          >
            {board.known && <BoardLinkCard row={board} enabled={!!event?.enabled} onRotate={p.onRotateBoard} notify={p.notify} />}
          </ReadinessRowView>
        )}

        {/* 7. open */}
        {session && (
          <ReadinessRowView
            n={7}
            title={t('owner.setup.session.title')}
            status={session.status}
            known={session.known}
            isNext={nextId === 'session'}
            onRetry={p.onRetry}
            delay={240}
            reason={sessionReason}
            summary={session.active ? (session.active.kind === 'training' ? t('owner.setup.session.isTraining') : t('owner.setup.session.isOpen')) : t('owner.setup.session.closed')}
          >
            {session.known && (
              <SessionButton
                row={session}
                canOpen={state.canOpen}
                blockedText={state.canOpen ? null : sessionReason}
                run={p.runSession}
                onDone={p.onSessionDone}
              />
            )}
          </ReadinessRowView>
        )}
      </ol>
    </>
  )
}
