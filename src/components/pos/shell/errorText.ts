// Turns ANY failure code into one plain sentence an employee can act on.
//
// The server answers errors with { code, message }. `code` is a PosErrorCode (or
// 'network' when the server never answered); `message` is English for developers
// and must never reach a person at a till. Every screen therefore shows
// errorText(t, result.code) and nothing else.
//
// A code this build has never heard of (the server learnt a new one before the
// browser did) degrades to the generic sentence — a calm "something did not work"
// beats a raw 'modifier_qty' on the cashier's screen.

import { allStrings, type StrKey } from '@/lib/pos/i18n'

type Translate = (key: StrKey, params?: Record<string, string | number>) => string

let known: Set<string> | null = null
function knownKeys(): Set<string> {
  if (!known) known = new Set(Object.keys(allStrings()))
  return known
}

export function errorText(t: Translate, code: string | null | undefined): string {
  const key = `errors.${code ?? ''}`
  return knownKeys().has(key) ? t(key as StrKey) : t('errors.generic')
}

/** Anything that carries a `code` (an ApiFailure, an outbox entry's last error). */
export function errorTextOf(t: Translate, failure: { code?: string | null } | null | undefined): string {
  return errorText(t, failure?.code)
}
