// The notifications gate's RULES — PURE (no React, no DOM, no Supabase). scripts/check-notifications-gate.mjs runs this file.
// Ported from the Ayeka Bar register's gate (ayeka-staff/src/gateRules.ts) and extended for this app.
//
// THE OWNER'S RULE (2026-10-16): when an employee opens their link in a browser the FIRST thing is to show how to put the app
// on the Home Screen and to turn notifications on, before the onboarding even; nobody can enter the dashboard or link their
// account without notifications. One step at a time. So a staff page does not open until this device can be told things:
//
//   0. A phone browser that lives INSIDE another app (Instagram, Facebook, a messenger's own viewer) can neither install nor
//      receive push: the first step is "open this link in Safari / Chrome".
//   1. PHONES (iOS and Android) must run it as an INSTALLED app (Home Screen). On iOS Web Push is delivered only to an
//      installed app; on Android an installed app is the one that stays alive and shows alerts reliably.
//   2. EVERY device must have notifications granted AND a push subscription registered for the person. Granting is a TAP (a
//      browser only prompts from a gesture), so it is a button, never automatic.
//   3. If the person said no, the screen says exactly how to undo that on their platform and re-checks the moment they
//      come back, without a reload.
//
// SURVIVAL AND RECOVERY — the rules that keep the gate from ever being the reason someone cannot work:
//   • The gate is a function of what THIS DEVICE says now, never of stored progress, so closing the app, switching phones or
//     losing the session mid-way just resumes at the right step.
//   • If the server cannot be reached the gate does NOT lock anyone out: permission granted + a local subscription is enough
//     (`subscribed: 'unknown'`); it re-registers by itself when the network is back.
//   • The owner can exempt one employee (push_gate_exempt) for a phone that cannot do push at all, and management can always
//     continue without alerts on a device that cannot do them: an owner is never bricked, a waiter without alerts is the
//     failure the gate exists to prevent.
//   • It re-checks itself while open (focus, visibility, every 30 s): revoking the permission in the phone's settings brings
//     the gate back within a minute instead of leaving someone silently deaf for the rest of the shift.

export type Platform = 'ios' | 'android' | 'desktop'

/** What this device can do right now. Gathered by the component; every rule below is a function of this alone. */
export interface GateEnv {
  platform: Platform
  /** Running as an installed app (Home Screen / `display-mode: standalone`). */
  standalone: boolean
  /** A phone browser embedded in another app (cannot install, cannot do push). */
  inAppBrowser: boolean
  /** The browser has the Push API, service workers and Notification at all. */
  pushSupported: boolean
  permission: 'default' | 'granted' | 'denied' | 'unsupported'
  /** A subscription exists here AND the server has it filed under the person. 'unknown' = the server could not be asked. */
  subscribed: 'yes' | 'no' | 'unknown'
}

export type GateStep = 'browser' | 'install' | 'unsupported' | 'blocked' | 'notifications' | 'done'

export function detectPlatform(userAgent: string, platform: string, maxTouchPoints: number): Platform {
  const ios = /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)
  if (ios) return 'ios'
  return /Android/i.test(userAgent) ? 'android' : 'desktop'
}

/** A phone browser that is a window INSIDE another app. Known app tokens, plus the iOS tell: a WebView has no "Safari/" token
 *  (real Safari, Chrome, Firefox and Edge on iOS all carry one or their own token). */
export function detectInAppBrowser(userAgent: string, platform: Platform): boolean {
  if (platform === 'desktop') return false
  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|MicroMessenger|TikTok|Twitter|LinkedInApp|GSA\/|; wv\)/i.test(userAgent)) return true
  if (platform === 'ios' && /AppleWebKit/.test(userAgent) && !/Safari\//.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent)) return true
  return false
}

/** The ONE decision. Order matters: open-in-a-browser before install, install before permission (on iOS the permission prompt
 *  does not exist in a tab), unsupported before blocked, and `done` only when permission AND a subscription are real
 *  (or the server could not be asked, see above). */
export function gateStep(env: GateEnv): GateStep {
  if (env.platform !== 'desktop' && !env.standalone && env.inAppBrowser) return 'browser'
  if (env.platform !== 'desktop' && !env.standalone) return 'install'
  if (!env.pushSupported || env.permission === 'unsupported') return 'unsupported'
  if (env.permission === 'denied') return 'blocked'
  if (env.permission === 'granted' && env.subscribed !== 'no') return 'done'
  return 'notifications'
}

/** Which of the screen's rows are finished — for the little 1 · 2 list. */
export interface StepRow { key: 'install' | 'notifications'; done: boolean; now: boolean }

export function stepRows(env: GateEnv): StepRow[] {
  const needsInstall = env.platform !== 'desktop'
  const step = gateStep(env)
  const rows: StepRow[] = []
  if (needsInstall) rows.push({ key: 'install', done: env.standalone, now: step === 'install' || step === 'browser' })
  rows.push({ key: 'notifications', done: step === 'done', now: step !== 'install' && step !== 'browser' && step !== 'done' })
  return rows
}

/** How the gate treats a person. `hard`: an employee, no way round except the owner's exemption. `soft`: management, who may
 *  continue without alerts (never bricked). `off`: nobody is signed in, or the owner exempted this employee. */
export type GateMode = 'hard' | 'soft' | 'off'

export function gateModeFor(me: { role?: string | null; badge?: string | null; pushGateExempt?: boolean } | null | undefined): GateMode {
  if (!me) return 'off'
  if (me.pushGateExempt) return 'off'
  if (me.role === 'owner' || me.badge === 'owner' || me.badge === 'developer' || me.badge === 'general_manager' || me.badge === 'manager') return 'soft'
  return 'hard'
}

/** The pages the gate does not stand in front of: the onboarding wizard (it runs the same steps itself, first, with the invite
 *  link as its identity) and nothing else. */
export function gateAppliesTo(pathname: string | null | undefined): boolean {
  if (!pathname) return true
  return !(pathname === '/staff/onboarding' || pathname.startsWith('/staff/onboarding/'))
}

/** How often the gate looks again while the app is open. */
export const GATE_RECHECK_MS = 30_000

/** The key the "continue without alerts" choice of management is kept under, for THIS browser tab only (sessionStorage). */
export const GATE_SKIP_KEY = 'sarcafe:gate-skip:v1'
