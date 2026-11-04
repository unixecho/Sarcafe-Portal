'use client'

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import PublicBackdrop from '@/components/PublicBackdrop'
import { COPY, type LoyaltyCopy } from '@/lib/loyalty/copy'
import { LOYALTY_LANGS, isEmail, isMobilePhone, normalizePhone, type LoyaltyLang } from '@/lib/loyalty/signup-shared'
import './loyaltysignup.css'

// The public loyalty-club sign-up (the page at /loyaltysignup). One form in three languages; the words are lib/loyalty/copy.ts and
// the server picks the legal version ids from `lang`, so what is on screen is what is recorded. Nothing is kept in the browser
// (no cookies, no browser storage), nothing is sent anywhere but /api/loyaltysignup, and a failure always says that nothing was saved.

// The cart's own artwork behind the page, the same illustrated backdrop as the menu and the poll (the cart is at Givat Haviva).
const BACKDROP_BRANCH = 'givat-haviva'

type Fields ='firstName' | 'phone' | 'email' | 'acknowledged'
type Errors = Partial<Record<Fields, string>>
type Status = 'idle' | 'sending' | 'done'

const newRequestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export default function LoyaltySignupForm({ initialLang, token }: { initialLang: LoyaltyLang; token: string }) {
  const [lang, setLang] = useState<LoyaltyLang>(initialLang)
  const t: LoyaltyCopy = COPY[lang]
  const [firstName, setFirstName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [website, setWebsite] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [banner, setBanner] = useState<{ text: string; reload?: boolean } | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const requestId = useRef<string>('')
  const doneHeading = useRef<HTMLHeadingElement>(null)
  const ids = useId()

  // The browser tab, the page language and the direction follow the chosen language (the root layout says Hebrew).
  useEffect(() => {
    const html = document.documentElement
    const before = { lang: html.lang, dir: html.dir }
    document.title = t.htmlTitle
    html.lang = lang
    html.dir = t.dir
    return () => { html.lang = before.lang; html.dir = before.dir }
  }, [lang, t.htmlTitle, t.dir])

  useEffect(() => { if (status === 'done') doneHeading.current?.focus() }, [status])

  function pickLang(next: LoyaltyLang) {
    if (next === lang) return
    setLang(next)
    setErrors({})
    setBanner(null)
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('lang', next)
      window.history.replaceState(null, '', url)
    } catch { /* the address bar is only a convenience */ }
  }

  function validate(): Errors {
    const found: Errors = {}
    if (firstName.trim().length < 1 || firstName.trim().length > 60) found.firstName = t.errName
    if (!isMobilePhone(phone)) found.phone = t.errPhone
    if (email.trim() !== '' && !isEmail(email.trim())) found.email = t.errEmail
    if (!acknowledged) found.acknowledged = t.errConsent
    return found
  }

  async function post(): Promise<Response> {
    return fetch('/api/loyaltysignup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({
        firstName: firstName.trim(),
        phone: normalizePhone(phone),
        email: email.trim(),
        acknowledged: true,
        marketing,
        requestId: requestId.current,
        lang,
        token,
        website,
      }),
    })
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status === 'sending') return
    setBanner(null)
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) {
      const first = (['firstName', 'phone', 'email', 'acknowledged'] as Fields[]).find((key) => found[key])
      if (first) document.getElementById(`${ids}-${first}`)?.focus()
      return
    }
    if (!requestId.current) requestId.current = newRequestId()
    setStatus('sending')
    try {
      let response = await post()
      let body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; fields?: string[] } | null
      // Sent within seconds of opening the page (a quick typist): the server asks for a moment; wait it out once.
      if (response.status === 429 && body?.error === 'too_fast') {
        await wait(3200)
        response = await post()
        body = (await response.json().catch(() => null)) as typeof body
      }
      if (response.ok && body?.ok) { setStatus('done'); return }
      setStatus('idle')
      if (response.status === 429 && body?.error === 'rate_limited') setBanner({ text: t.errRate })
      else if (body?.error === 'expired') setBanner({ text: t.errExpired, reload: true })
      else if (response.status === 400 && body?.fields?.length) {
        const mapped: Errors = {}
        if (body.fields.includes('firstName')) mapped.firstName = t.errName
        if (body.fields.includes('phone')) mapped.phone = t.errPhone
        if (body.fields.includes('email')) mapped.email = t.errEmail
        setErrors(mapped)
        if (Object.keys(mapped).length === 0) setBanner({ text: t.errGeneric })
      } else setBanner({ text: t.errGeneric })
    } catch {
      setStatus('idle')
      setBanner({ text: t.errOffline })
    }
  }

  const field = (key: Fields) => ({
    id: `${ids}-${key}`,
    'aria-invalid': errors[key] ? (true as const) : undefined,
    'aria-describedby': errors[key] ? `${ids}-${key}-err` : undefined,
  })
  const err = (key: Fields) => (errors[key] ? <p id={`${ids}-${key}-err`} className="ls-error" role="alert">{errors[key]}</p> : null)

  return (
    <PublicBackdrop branchSlug={BACKDROP_BRANCH}>
    <div className="ls" lang={lang} dir={t.dir}>
      <main id="main" tabIndex={-1} className="ls-main">
        <header className="ls-hero">
          <div className="ls-top">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="ls-logo" src="/sarcafe-logo-white.png" alt="Sarcafe" width={76} height={76} />
            <div className="ls-langs" role="group" aria-label={COPY.he.langAria + ' / ' + COPY.en.langAria + ' / ' + COPY.ar.langAria}>
              {LOYALTY_LANGS.map((code) => (
                <button
                  key={code}
                  type="button"
                  lang={code}
                  className="ls-lang"
                  aria-pressed={code === lang}
                  onClick={() => pickLang(code)}
                >
                  {COPY[code].name}
                </button>
              ))}
            </div>
          </div>
          <h1>{t.title}</h1>
          <p className="ls-lead">{t.lead}</p>
        </header>

        <div className="ls-card">
        {status === 'done' ? (
          <section className="ls-done" aria-live="polite">
            <div className="ls-tick" aria-hidden="true">✓</div>
            <h2 ref={doneHeading} tabIndex={-1}>{t.successTitle}</h2>
            <p>{t.successText}</p>
            <p className="ls-fine">{t.successRepeat}</p>
          </section>
        ) : (
          <>
            <ul className="ls-benefits">
              {t.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}
            </ul>
            <p className="ls-fine">{t.clubNote}</p>

            <form onSubmit={onSubmit} noValidate className="ls-form">
              <div className="ls-field">
                <label htmlFor={`${ids}-firstName`}>{t.nameLabel}</label>
                <input {...field('firstName')} name="firstName" type="text" autoComplete="given-name" maxLength={60} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                {err('firstName')}
              </div>

              <div className="ls-field">
                <label htmlFor={`${ids}-phone`}>{t.phoneLabel}</label>
                <input {...field('phone')} name="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" maxLength={20} placeholder="05X-XXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <p className="ls-hint">{t.phoneHint}</p>
                {err('phone')}
              </div>

              <div className="ls-field">
                <label htmlFor={`${ids}-email`}>{t.emailLabel} <span className="ls-optional">({t.optional})</span></label>
                <input {...field('email')} name="email" type="email" inputMode="email" autoComplete="email" dir="ltr" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
                {err('email')}
              </div>

              {/* Honeypot: invisible to a person (and to a screen reader), tempting to a bot. */}
              <div className="ls-trap" aria-hidden="true">
                <label htmlFor={`${ids}-website`}>Website</label>
                <input id={`${ids}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>

              <p className="ls-notice">{t.shortNotice}</p>

              <div className="ls-check">
                <input {...field('acknowledged')} name="acknowledged" type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                <label htmlFor={`${ids}-acknowledged`}>{t.required}</label>
              </div>
              {err('acknowledged')}

              <div className="ls-check">
                <input id={`${ids}-marketing`} name="marketing" type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
                <label htmlFor={`${ids}-marketing`}>{t.marketing}</label>
              </div>

              {banner ? (
                <div className="ls-banner" role="alert">
                  <p>{banner.text}</p>
                  {banner.reload ? <button type="button" className="ls-secondary" onClick={() => window.location.reload()}>{t.reload}</button> : null}
                </div>
              ) : null}

              <button type="submit" className="ls-submit" disabled={status === 'sending'} aria-busy={status === 'sending'}>
                {status === 'sending' ? t.sending : t.submit}
              </button>
            </form>

            <div className="ls-legal">
              <details>
                <summary>{t.readPrivacy}</summary>
                <h2>{t.privacyTitle}</h2>
                <p className="ls-fine">{t.privacyLead}</p>
                {t.privacy.map(([heading, text]) => (
                  <section key={heading}>
                    <h3>{heading}</h3>
                    <p>{text}</p>
                  </section>
                ))}
              </details>
              <details>
                <summary>{t.readTerms}</summary>
                <h2>{t.termsTitle}</h2>
                <p className="ls-fine">{t.termsLead}</p>
                {t.terms.map(([heading, text]) => (
                  <section key={heading}>
                    <h3>{heading}</h3>
                    <p>{text}</p>
                  </section>
                ))}
              </details>
            </div>
          </>
        )}

        <footer className="ls-footer">{t.footer}</footer>
        </div>
      </main>
    </div>
    </PublicBackdrop>
  )
}
