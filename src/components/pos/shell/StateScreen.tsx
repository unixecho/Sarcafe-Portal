'use client'

// The full-screen "you cannot work yet" states. Never a blank: each one says what is
// going on in plain words and who to ask. They sit INSIDE the shell (top bar kept) so
// the person can still switch language; the screen updates by itself the moment the
// situation changes, so the only buttons are a manual re-check and, for managers, the
// door to where the thing gets fixed.

import type { ReactNode } from 'react'
import { CalendarClock, LockKeyhole, MapPinOff, PowerOff, Settings, UserX, type LucideIcon } from 'lucide-react'
import { useT } from '@/lib/pos/useT'
import type { StrKey } from '@/lib/pos/i18n'
import { usePos, usePosActions } from '../PosProvider'

export type StateKind = 'closed' | 'disabled' | 'nobranch' | 'signedOut' | 'gone'

const COPY: Record<StateKind, { icon: LucideIcon; title: StrKey; body: StrKey }> = {
  closed: { icon: CalendarClock, title: 'core.closed.title', body: 'core.closed.body' },
  disabled: { icon: PowerOff, title: 'core.disabled.title', body: 'core.disabled.body' },
  nobranch: { icon: UserX, title: 'core.nobranch.title', body: 'core.nobranch.body' },
  signedOut: { icon: LockKeyhole, title: 'core.signedOut.title', body: 'core.signedOut.body' },
  gone: { icon: MapPinOff, title: 'core.gone.title', body: 'core.gone.body' },
}

export function StateScreen({ kind, children }: { kind: StateKind; children?: ReactNode }) {
  const t = useT()
  const { me } = usePos()
  const { refreshAll } = usePosActions()
  const { icon: Icon, title, body } = COPY[kind]
  const showAsk = kind === 'closed' || kind === 'disabled' || kind === 'nobranch'
  return (
    <div className="pos-state" role="status">
      <div className="pos-state-card">
        <span className="pos-state-icon" aria-hidden="true">
          <Icon size={34} />
        </span>
        <h1 className="pos-state-title">{t(title)}</h1>
        <p className="pos-state-body">{t(body)}</p>
        {kind === 'closed' ? <p className="pos-state-body">{t('core.closed.ask')}</p> : null}
        {kind === 'closed' && me.isManager ? <p className="pos-state-body">{t('core.closed.managerHint')}</p> : null}
        <div className="pos-state-actions">
          {children}
          {kind === 'signedOut' ? (
            <a className="pos-btn pos-btn--primary press" href="/login">
              {t('core.signedOut.action')}
            </a>
          ) : null}
          {showAsk && me.isManager ? (
            <a className="pos-btn press" href="/owner/pos">
              <Settings size={18} aria-hidden="true" />
              {t('core.closed.managerAction')}
            </a>
          ) : null}
          {showAsk ? (
            <button type="button" className="pos-btn press" onClick={refreshAll}>
              {t('core.closed.check')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
