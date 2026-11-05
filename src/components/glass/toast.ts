'use client'

// One way to tell the person what happened, from any client component: glassToast('נשלח', 'ok').
// Good news is green ('ok'), bad news and errors are red ('bad'); <GlassToaster> (mounted by <GlassPage>) draws them.
export type ToastTone = 'ok' | 'bad' | 'neutral'
export type ToastDetail = { message: string; tone: ToastTone }
export const TOAST_EVENT = 'sarcafe:toast'

export function glassToast(message: string, tone: ToastTone = 'neutral') {
  if (typeof window === 'undefined' || !message) return
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail: { message: message.slice(0, 200), tone } }))
}
