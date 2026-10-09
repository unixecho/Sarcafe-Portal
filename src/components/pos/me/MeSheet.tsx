'use client'

// The person's own sheet, opened from the chip in the top bar: language, sounds, where
// this device works, nickname, quick sign-in code, and the way out.
//
// "החלפת משתמש" is the prominent button on purpose. On a shared station tablet the next
// person's first move is to take over the screen, and signing out then landing on the
// keypad (/login?quick=1) is one tap instead of a hunt through the account menu. Signing
// out uses the same mechanism as SignOutButton (POST /api/auth/signout, clear the
// remembered branch, then route) — the server decides what a sign-out means, this sheet
// only asks.
//
// Nothing here is technical: an employee sees their number, their nickname, a language
// and a sound switch. Failures are one plain sentence, never a code.

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeftRight, Check, KeyRound, LogOut, MapPin, Pencil, Settings2, Volume2, VolumeX } from 'lucide-react'
import SheetShell from '@/components/SheetShell'
import Switch from '@/components/Switch'
import { clearDashboardBranchConfirmed } from '@/lib/branches/current'
import { haptic } from '@/lib/haptics'
import { posApi } from '@/lib/pos/client'
import { setSoundEnabled, unlockAudio, useSoundEnabled } from '@/lib/pos/alerts'
import { handleProblem } from '@/lib/pos/validate'
import { LIMITS } from '@/lib/pos/vocab'
import { useT, usePosLang } from '@/lib/pos/useT'
import type { StrKey } from '@/lib/pos/i18n'
import { usePos, usePosActions } from '../PosProvider'
import { usePosNav, viewOfPost, type PostChoice } from '../PosNav'
import { usePosToast } from '../shell/Toast'
import { HandleChip } from '../shell/HandleChip'
import { errorText } from '../shell/errorText'
import QuickCodeSheet from './QuickCodeSheet'
import './me.css'

const PROBLEM_KEY: Record<'too_short' | 'too_long' | 'bad_chars', StrKey> = {
  too_short: 'core.handle.tooShort',
  too_long: 'core.handle.tooLong',
  bad_chars: 'core.handle.badChars',
}

const choiceKey = (c: PostChoice): string => (c.kind === 'station' ? `station:${c.point}` : c.kind)

export default function MeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const [lang, setLang] = usePosLang()
  const router = useRouter()
  const { me, points, pointsById } = usePos()
  const { patchMe, refreshAll } = usePosActions()
  const { savedPost, savePost, go } = usePosNav()
  const { toast } = usePosToast()
  const soundOn = useSoundEnabled()
  const titleId = useId()
  const nickId = useId()

  const [pickOpen, setPickOpen] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nick, setNick] = useState(me.handle)
  const [nickBusy, setNickBusy] = useState(false)
  const [nickFailure, setNickFailure] = useState<string | null>(null)
  const [takenFor, setTakenFor] = useState<string | null>(null)
  const [outBusy, setOutBusy] = useState<'switch' | 'out' | null>(null)
  const [outFailure, setOutFailure] = useState(false)
  const nickRef = useRef<HTMLInputElement>(null)

  // Closing the sheet drops half-finished edits: the next opening starts from what is saved.
  useEffect(() => {
    if (open) return
    setRenaming(false)
    setPickOpen(false)
    setNick(me.handle)
    setNickFailure(null)
    setTakenFor(null)
    setOutFailure(false)
  }, [open, me.handle])

  useEffect(() => {
    if (renaming) nickRef.current?.focus()
  }, [renaming])

  // ---- the saved landing choice ---------------------------------------------------------------
  const placeName = (c: PostChoice | null): string => {
    if (!c) return t('me.where.none')
    if (c.kind === 'register') return t('me.where.register')
    if (c.kind === 'orders') return t('me.where.orders')
    const p = pointsById.get(c.point)
    return p && p.active ? t('me.where.station', { name: p.name }) : t('me.where.stationGone')
  }

  const choices: { choice: PostChoice; label: string }[] = [
    { choice: { kind: 'register' }, label: t('me.where.register') },
    { choice: { kind: 'orders' }, label: t('me.where.orders') },
    ...points.map((p) => ({ choice: { kind: 'station', point: p.id } as PostChoice, label: t('me.where.station', { name: p.name }) })),
  ]

  function choose(c: PostChoice) {
    haptic('select')
    savePost(c)
    setPickOpen(false)
    onClose()
    go(viewOfPost(c), { replace: true })
  }

  // ---- nickname: the same rules as the first-run gate ------------------------------------------------
  const trimmed = nick.trim()
  const problem = handleProblem(trimmed)
  const same = trimmed.toLowerCase() === me.handle.toLowerCase() && trimmed === me.handle
  const taken = takenFor !== null && takenFor.toLowerCase() === trimmed.toLowerCase()
  const canSaveNick = !problem && !taken && !same && !nickBusy

  let nickMessage: string | null = null
  if (problem) nickMessage = t(PROBLEM_KEY[problem])
  else if (taken) nickMessage = t('core.handle.taken')
  else if (nickFailure) nickMessage = nickFailure
  else if (same) nickMessage = t('me.nick.same')
  else nickMessage = t('core.handle.hint')
  const nickBad = !!problem || taken || !!nickFailure

  async function saveNick() {
    if (!canSaveNick) return
    setNickBusy(true)
    setNickFailure(null)
    const r = await posApi.setHandle({ handle: trimmed })
    setNickBusy(false)
    if (r.ok) {
      patchMe({ handle: r.data.handle, handleConfirmed: true })
      refreshAll()
      setRenaming(false)
      toast(t('me.nick.done'), { tone: 'ok' })
      return
    }
    if (r.code === 'conflict' || r.details?.reason === 'taken') {
      setTakenFor(trimmed)
      nickRef.current?.focus()
      return
    }
    setNickFailure(r.code === 'network' ? errorText(t, 'network') : t('core.handle.failed'))
  }

  // ---- leaving ------------------------------------------------------------------------------------------
  async function leave(kind: 'switch' | 'out') {
    if (outBusy) return
    setOutBusy(kind)
    setOutFailure(false)
    try {
      const res = await fetch('/api/auth/signout', { method: 'POST' })
      if (!res.ok) {
        // A refusal must free the button and say so — a button stuck disabled with no word is the bug this guards.
        setOutFailure(true)
        setOutBusy(null)
        return
      }
      clearDashboardBranchConfirmed()
      router.push(kind === 'switch' ? '/login?quick=1' : '/login')
      router.refresh()
    } catch {
      setOutFailure(true)
      setOutBusy(null)
    }
  }

  const nested = pickOpen || codeOpen

  return (
    <>
      <SheetShell open={open} onClose={onClose} labelledBy={titleId} suspended={nested}>
        <header className="me-head">
          <div className="me-who">
            <HandleChip staffId={me.id} handle={me.handle} size="md" />
            {typeof me.employeeNo === 'string' ? (
              <span className="me-no">{t('me.employeeNo', { n: me.employeeNo })}</span>
            ) : null}
          </div>
          <h2 id={titleId} className="pos-sheet-title">
            {t('me.title')}
          </h2>
        </header>

        <div className="sheet-scroll me-scroll">
          {/* the prominent one: the next person takes over this device */}
          <button
            type="button"
            className="pos-btn pos-btn--primary me-switch press"
            onClick={() => void leave('switch')}
            disabled={outBusy !== null}
          >
            <ArrowLeftRight size={22} aria-hidden="true" />
            <span className="me-switch-text">
              <span>{outBusy === 'switch' ? t('me.signout.busy') : t('me.switch.title')}</span>
              <span className="me-switch-hint">{t('me.switch.hint')}</span>
            </span>
          </button>

          <section className="me-card">
            <h3 className="me-title">{t('me.lang.title')}</h3>
            <div role="group" aria-label={t('me.lang.title')} className="me-seg">
              {(['he', 'en'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`me-seg-btn press${lang === l ? ' is-on' : ''}`}
                  aria-pressed={lang === l}
                  lang={l}
                  onClick={() => {
                    haptic('select')
                    setLang(l)
                  }}
                >
                  {lang === l ? <Check size={18} aria-hidden="true" /> : null}
                  <span>{t(l === 'he' ? 'me.lang.he' : 'me.lang.en')}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="me-card">
            <button
              type="button"
              role="switch"
              aria-checked={soundOn}
              className="me-row me-row--switch press"
              onClick={() => {
                const next = !soundOn
                // Turning sound on is the gesture the browser needs before it will play anything.
                if (next) unlockAudio()
                setSoundEnabled(next)
                haptic('select')
              }}
            >
              <span className="me-row-icon" aria-hidden="true">
                {soundOn ? <Volume2 size={22} /> : <VolumeX size={22} />}
              </span>
              <span className="me-row-text">
                <span className="me-row-title">{t('me.sound.title')}</span>
                <span className="me-row-sub">{soundOn ? t('me.sound.on') : t('me.sound.off')}</span>
              </span>
              <Switch on={soundOn} />
            </button>
            <p className="me-hint">{t('me.sound.hint')}</p>
          </section>

          <section className="me-card">
            <div className="me-row">
              <span className="me-row-icon" aria-hidden="true">
                <MapPin size={22} />
              </span>
              <span className="me-row-text">
                <span className="me-row-title">{t('me.where.title')}</span>
                <span className="me-row-sub">{placeName(savedPost)}</span>
              </span>
              <button type="button" className="pos-btn press" onClick={() => setPickOpen(true)} aria-haspopup="dialog">
                {t('me.where.change')}
              </button>
            </div>
            <p className="me-hint">{t('me.where.hint')}</p>
          </section>

          <section className="me-card">
            <div className="me-row">
              <span className="me-row-icon" aria-hidden="true">
                <Pencil size={22} />
              </span>
              <span className="me-row-text">
                <span className="me-row-title">{t('me.nick.title')}</span>
                <span className="me-row-sub">{me.handle}</span>
              </span>
              {!renaming ? (
                <button
                  type="button"
                  className="pos-btn press"
                  onClick={() => {
                    setNick(me.handle)
                    setRenaming(true)
                  }}
                >
                  {t('me.nick.change')}
                </button>
              ) : null}
            </div>
            {renaming ? (
              <form
                className="me-nick"
                onSubmit={(e) => {
                  e.preventDefault()
                  void saveNick()
                }}
              >
                <label htmlFor={`${nickId}-input`} className="sr-only">
                  {t('core.handle.label')}
                </label>
                <input
                  id={`${nickId}-input`}
                  ref={nickRef}
                  className="pos-input"
                  value={nick}
                  onChange={(e) => {
                    setNick(e.target.value)
                    setNickFailure(null)
                  }}
                  maxLength={LIMITS.handleMax + 8}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  aria-invalid={nickBad}
                  aria-describedby={`${nickId}-hint`}
                />
                <p id={`${nickId}-hint`} className={`pos-hint${nickBad ? ' pos-hint--bad' : ''}`} role={nickBad ? 'alert' : undefined}>
                  {nickMessage}
                </p>
                <div className="me-actions">
                  <button type="button" className="pos-btn press" onClick={() => setRenaming(false)} disabled={nickBusy}>
                    {t('me.nick.cancel')}
                  </button>
                  <button type="submit" className="pos-btn pos-btn--primary press" disabled={!canSaveNick}>
                    {nickBusy ? t('core.handle.saving') : t('me.nick.save')}
                  </button>
                </div>
              </form>
            ) : null}
          </section>

          {/* a quick-login session may not change its own code: the row is simply absent */}
          {!me.quickSession ? (
            <section className="me-card">
              <button type="button" className="me-row me-row--btn press" onClick={() => setCodeOpen(true)} aria-haspopup="dialog">
                <span className="me-row-icon" aria-hidden="true">
                  <KeyRound size={22} />
                </span>
                <span className="me-row-text">
                  <span className="me-row-title">{t('me.quick.row')}</span>
                  <span className="me-row-sub">{t('me.quick.hint')}</span>
                </span>
              </button>
            </section>
          ) : null}

          {me.isManager ? (
            <section className="me-card">
              <a className="me-row me-row--btn press" href="/owner/pos">
                <span className="me-row-icon" aria-hidden="true">
                  <Settings2 size={22} />
                </span>
                <span className="me-row-text">
                  <span className="me-row-title">{t('me.manager.link')}</span>
                </span>
              </a>
            </section>
          ) : null}

          <button
            type="button"
            className="pos-btn me-out press"
            onClick={() => void leave('out')}
            disabled={outBusy !== null}
          >
            <LogOut size={20} aria-hidden="true" />
            <span>{outBusy === 'out' ? t('me.signout.busy') : t('me.signout')}</span>
          </button>
          {outFailure ? (
            <p className="pos-hint pos-hint--bad" role="alert">
              {t('me.signout.failed')}
            </p>
          ) : null}
        </div>
      </SheetShell>

      {/* where this device works: a list, because there are only a handful of places */}
      <SheetShell open={pickOpen} onClose={() => setPickOpen(false)} labelledBy={`${titleId}-pick`}>
        <h2 id={`${titleId}-pick`} className="pos-sheet-title">
          {t('me.where.pick')}
        </h2>
        <div className="sheet-scroll me-pick" role="group" aria-labelledby={`${titleId}-pick`}>
          {choices.map(({ choice, label }) => {
            const on = savedPost !== null && choiceKey(savedPost) === choiceKey(choice)
            return (
              <button
                key={choiceKey(choice)}
                type="button"
                className={`me-pick-btn press${on ? ' is-on' : ''}`}
                aria-pressed={on}
                onClick={() => choose(choice)}
              >
                <span>{label}</span>
                {on ? (
                  <span className="me-pick-on">
                    <Check size={18} aria-hidden="true" />
                    {t('me.where.current')}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </SheetShell>

      <QuickCodeSheet
        open={codeOpen}
        onClose={() => setCodeOpen(false)}
        employeeNo={me.employeeNo ?? null}
        hasPasscode={!!me.hasPasscode}
      />
    </>
  )
}
