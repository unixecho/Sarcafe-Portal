'use client'

// The language of the staff app: Hebrew by default, English on request, remembered
// per device. A tiny external store (useSyncExternalStore) rather than context so
// ANY component — including the portalled sheets — reads it with no provider above.

import { useCallback, useSyncExternalStore } from 'react'
import { translate, type StrKey } from './i18n'
import type { PosLang } from './format'

const KEY = 'sarcafe.pos.lang'
const EVENT = 'sarcafe:pos-lang'

function read(): PosLang {
  try {
    return window.localStorage.getItem(KEY) === 'en' ? 'en' : 'he'
  } catch {
    return 'he'
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function usePosLang(): [PosLang, (lang: PosLang) => void] {
  // server snapshot is always 'he' — first paint matches the document's lang/dir
  const lang = useSyncExternalStore(subscribe, read, () => 'he' as PosLang)
  const setLang = useCallback((next: PosLang) => {
    try {
      window.localStorage.setItem(KEY, next)
    } catch {
      /* private mode: the choice just will not persist */
    }
    window.dispatchEvent(new Event(EVENT))
  }, [])
  return [lang, setLang]
}

export function useT() {
  const [lang] = usePosLang()
  return useCallback((key: StrKey, params?: Record<string, string | number>) => translate(key, lang, params), [lang])
}
