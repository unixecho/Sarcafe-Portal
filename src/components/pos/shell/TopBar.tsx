'use client'

// The top bar. dir="ltr" on purpose: the language and sound controls sit at the
// PHYSICAL left and the person at the physical right whichever language is on, so
// a cashier who flips to English does not have to hunt for them (Ayeka's rule for
// pinned chrome). Only the TEXT inside is localised.
//
// The middle cluster holds the warnings (connection, unsent orders). It renders
// nothing when all is well, and CSS hides the empty cluster so no gap is left.

import { LayoutGrid, Languages, Settings, Volume2, VolumeX } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { setSoundEnabled, unlockAudio, useSoundEnabled } from '@/lib/pos/alerts'
import { usePosLang, useT } from '@/lib/pos/useT'
import { usePos } from '../PosProvider'
import { usePosNav } from '../PosNav'
import { ConnectionPill } from './ConnectionPill'
import { EventPill } from './EventPill'
import { HandleChip } from './HandleChip'
import { OutboxPill } from './OutboxPill'

export function TopBar({ onOpenMe }: { onOpenMe: () => void }) {
  const t = useT()
  const [lang, setLang] = usePosLang()
  const sound = useSoundEnabled()
  const { me, pointsById } = usePos()
  const { view, go } = usePosNav()
  const textDir = lang === 'en' ? 'ltr' : 'rtl'

  let postName = t('core.top.postHome')
  if (view.v === 'register') postName = t('core.top.postRegister')
  else if (view.v === 'orders') postName = t('core.top.postOrders')
  else if (view.v === 'station' || view.v === 'timeline') postName = pointsById.get(view.point)?.name ?? postName

  return (
    <header className="pos-topbar" dir="ltr">
      <div className="pos-tb-left">
        <button
          type="button"
          className="pos-iconbtn press"
          aria-label={t('core.lang.toggle')}
          onClick={() => {
            setLang(lang === 'he' ? 'en' : 'he')
            haptic('tick')
          }}
        >
          <Languages size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="pos-iconbtn press"
          aria-pressed={sound}
          aria-label={sound ? t('core.sound.on') : t('core.sound.off')}
          onClick={() => {
            const next = !sound
            setSoundEnabled(next)
            // Browsers only let a page make sound after a tap; this IS that tap.
            if (next) unlockAudio()
          }}
        >
          {sound ? <Volume2 size={20} aria-hidden="true" /> : <VolumeX size={20} aria-hidden="true" />}
        </button>
        {me.isManager ? (
          <a className="pos-iconbtn pos-iconbtn--wide-only press" href="/owner/pos" aria-label={t('core.top.manager')}>
            <Settings size={20} aria-hidden="true" />
          </a>
        ) : null}
      </div>

      <div className="pos-tb-mid" dir={textDir}>
        <ConnectionPill />
        <OutboxPill />
      </div>

      <div className="pos-tb-right" dir={textDir}>
        <EventPill />
        <button
          type="button"
          className="pos-chip pos-chip--post press"
          aria-label={t('core.top.switchPost', { name: postName })}
          onClick={() => go({ v: 'home' })}
        >
          <LayoutGrid size={20} aria-hidden="true" />
          <span className="pos-chip-text">{postName}</span>
        </button>
        <button
          type="button"
          className="pos-chip pos-chip--me press"
          aria-label={t('core.top.me', { name: me.handle })}
          onClick={onOpenMe}
        >
          <HandleChip staffId={me.id} handle={me.handle} size="md" />
        </button>
      </div>
    </header>
  )
}
