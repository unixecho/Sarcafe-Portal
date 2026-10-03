'use client'

// Sound and vibration for the staff screens (blueprint §10.6). Net-new: Ayeka's OMS has
// no sound anywhere, and a cook looking at the pizza oven will not see a new ticket arrive.
//
//  - Tones are synthesised with Web Audio (OscillatorNode): no audio files to host, cache,
//    or fail to load on a flaky connection.
//  - iOS refuses to make any sound until the AudioContext has been created or resumed INSIDE
//    a user gesture, so unlockAudio() must be called from the first tap (sign-in, choosing a
//    point — anything). Until then chime() is silent by design. A chime that arrives while the
//    context is suspended is DROPPED, not queued: scheduled against a frozen clock, a backlog of
//    chimes would all fire at once the moment the next tap resumes it.
//  - One per-device mute, persisted ('sarcafe.pos.sound'). It silences the tones AND the
//    vibration — a muted prep area must not buzz either. Where storage is unavailable (private
//    mode) the toggle still works for the life of the tab.
//  - Chimes of the same kind within MIN_GAP_MS collapse into one: a realtime burst can deliver
//    six new lines in the same instant, and six overlapping chimes is noise, not information.
//  - Nothing here throws and nothing here touches focus or the DOM. This is not haptic() from
//    lib/haptics.ts — that is a tick under a finger, with a hidden iOS checkbox trick that has to
//    juggle focus; this is an alert for something that happened elsewhere.

import { useSyncExternalStore } from 'react'

export type ChimeKind = 'new' | 'critical' | 'ready'

const STORAGE_KEY = 'sarcafe.pos.sound'
const CHANGE_EVENT = 'sarcafe:pos-sound'
const MIN_GAP_MS = 500

type Note = { hz: number; at: number; dur: number; wave: OscillatorType; gain: number }
type Pattern = { notes: readonly Note[]; vibrate: number[] }

// Three sounds a person can tell apart without looking: a rising pair for "something new for
// you", a soft major arpeggio for "ready", and three hard repeating beeps for "this is late".
const PATTERNS: Record<ChimeKind, Pattern> = {
  new: {
    notes: [
      { hz: 659.25, at: 0, dur: 0.16, wave: 'sine', gain: 0.24 },
      { hz: 880, at: 0.14, dur: 0.26, wave: 'sine', gain: 0.24 },
    ],
    vibrate: [70],
  },
  ready: {
    notes: [
      { hz: 523.25, at: 0, dur: 0.22, wave: 'triangle', gain: 0.22 },
      { hz: 659.25, at: 0.11, dur: 0.22, wave: 'triangle', gain: 0.22 },
      { hz: 783.99, at: 0.22, dur: 0.34, wave: 'triangle', gain: 0.22 },
    ],
    vibrate: [40, 60, 40],
  },
  critical: {
    notes: [
      { hz: 988, at: 0, dur: 0.16, wave: 'square', gain: 0.13 },
      { hz: 784, at: 0.22, dur: 0.16, wave: 'square', gain: 0.13 },
      { hz: 988, at: 0.44, dur: 0.16, wave: 'square', gain: 0.13 },
    ],
    vibrate: [200, 100, 200, 100, 200],
  },
}

// ---- Audio context --------------------------------------------------------------------------

type AudioContextCtor = typeof AudioContext

let audioCtx: AudioContext | null = null
let primed = false
const lastChimeAt: Partial<Record<ChimeKind, number>> = {}

function getContext(): AudioContext | null {
  if (audioCtx) return audioCtx
  if (typeof window === 'undefined') return null
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
  if (!Ctor) return null
  try {
    audioCtx = new Ctor()
  } catch {
    return null
  }
  return audioCtx
}

/** Call from the first user gesture (and again from any later one — it is cheap and idempotent). */
export function unlockAudio(): void {
  try {
    const ctx = getContext()
    if (!ctx) return
    // 'interrupted' is iOS's state after a call or a lock; it is not in every lib.dom's union.
    if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') void ctx.resume().catch(() => {})
    if (!primed) {
      // iOS only opens its audio session once something has actually STARTED inside a gesture.
      const src = ctx.createBufferSource()
      src.buffer = ctx.createBuffer(1, 1, 22050)
      src.connect(ctx.destination)
      src.start(0)
      primed = true
    }
  } catch {
    /* no audio on this device: the screens still work, they just do not make noise */
  }
}

function playNotes(ctx: AudioContext, notes: readonly Note[]) {
  const t0 = ctx.currentTime + 0.02
  for (const n of notes) {
    const start = t0 + n.at
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = n.wave
    osc.frequency.setValueAtTime(n.hz, start)
    // A short attack and an exponential release: no click at either edge of the tone.
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(n.gain, start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + n.dur)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(start)
    osc.stop(start + n.dur + 0.03)
    osc.onended = () => {
      try {
        osc.disconnect()
        gain.disconnect()
      } catch {
        /* already gone */
      }
    }
  }
}

function vibrate(pattern: number[]) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern)
  } catch {
    /* blocked until a gesture, or unsupported: seasoning, never the signal */
  }
}

// ---- Mute -----------------------------------------------------------------------------------

let memoryChoice: boolean | null = null

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'off') return false
    if (stored === 'on') return true
  } catch {
    /* fall through to this tab's own choice */
  }
  return memoryChoice ?? true // on by default: a kitchen that never found the toggle should still hear tickets
}

export function setSoundEnabled(on: boolean): void {
  if (typeof window === 'undefined') return
  memoryChoice = on
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    /* private mode: memoryChoice carries it for this tab */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** Live value of the mute, shared across every component and tab. The server snapshot is "on". */
export function useSoundEnabled(): boolean {
  return useSyncExternalStore(subscribe, isSoundEnabled, () => true)
}

// ---- The alert ------------------------------------------------------------------------------

export function chime(kind: ChimeKind): void {
  try {
    if (typeof window === 'undefined' || !isSoundEnabled()) return
    const now = Date.now()
    if (now - (lastChimeAt[kind] ?? 0) < MIN_GAP_MS) return
    lastChimeAt[kind] = now

    const pattern = PATTERNS[kind]
    const ctx = getContext()
    if (ctx) {
      if (ctx.state === 'running') playNotes(ctx, pattern.notes)
      else void ctx.resume().catch(() => {}) // only takes effect inside a gesture; this chime is lost, the next one is not
    }
    vibrate(pattern.vibrate)
  } catch {
    /* an alert must never be the thing that breaks a screen */
  }
}
