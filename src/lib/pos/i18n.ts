// POS strings. Every visible string lives in lib/pos/i18n/<area>.ts — one file per
// area so parallel work never touches the same file — and is read through
// translate() / useT(). Hebrew is the product language and REQUIRED for every key;
// English is optional and falls back to Hebrew (Ayeka's rule: English may lag).
//
// Keys are typed: `t('register.send')` is a compile error if the key does not exist.
//
// Pure (no React) so check-pos.mjs can verify every key has Hebrew text and that
// every {placeholder} in the Hebrew string also appears in the English one.

import type { PosLang } from './format'
import { coreStrings } from './i18n/core'
import { errorsStrings } from './i18n/errors'
import { registerStrings } from './i18n/register'
import { stationStrings } from './i18n/station'
import { ordersStrings } from './i18n/orders'
import { meStrings } from './i18n/me'
import { ownerStrings } from './i18n/owner'
import { boardStrings } from './i18n/board'

export type Str = { he: string; en?: string }

const ALL = {
  ...coreStrings,
  ...errorsStrings,
  ...registerStrings,
  ...stationStrings,
  ...ordersStrings,
  ...meStrings,
  ...ownerStrings,
  ...boardStrings,
} as const

export type StrKey = keyof typeof ALL
export type { PosLang }

/** "{name}" placeholders are replaced from params; an unknown placeholder is left visible so a typo shows up in review. */
export function translate(key: StrKey, lang: PosLang, params?: Record<string, string | number>): string {
  const entry = (ALL as Record<string, Str>)[key]
  if (!entry) return String(key)
  const raw = lang === 'en' ? (entry.en ?? entry.he) : entry.he
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m))
}

/** For the harness: every key with its raw strings. */
export function allStrings(): Record<string, Str> {
  return ALL as Record<string, Str>
}
