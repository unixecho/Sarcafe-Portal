import { z } from 'zod'

// The public loyalty-club sign-up page (/loyaltysignup), shared by the page, its client form and the endpoint. Pure: no server-only
// imports, so scripts/check-loyalty-signup.mjs runs this very file.
//
// The visitor agrees to the words on screen in the language on screen, so each language has its own version ids and the page sends
// only `lang`: the server derives the three ids from it (the page and the stored consent can never disagree). These are the WEB
// texts (src/lib/loyalty/copy.ts); the kiosk's are separate (prototypes/sarcafe-kiosk-app/overrides/kiosk-legal.js).

export const LOYALTY_LANGS = ['he', 'en', 'ar'] as const
export type LoyaltyLang = (typeof LOYALTY_LANGS)[number]

export const WEB_LEGAL_VERSIONS: Record<LoyaltyLang, { privacy: string; consent: string; terms: string }> = {
  he: { privacy: 'web-privacy-he-v2-2026-11-04', consent: 'web-consent-he-v2-2026-11-04', terms: 'web-terms-he-v2-2026-11-04' },
  en: { privacy: 'web-privacy-en-v2-2026-11-04', consent: 'web-consent-en-v2-2026-11-04', terms: 'web-terms-en-v2-2026-11-04' },
  ar: { privacy: 'web-privacy-ar-v2-2026-11-04', consent: 'web-consent-ar-v2-2026-11-04', terms: 'web-terms-ar-v2-2026-11-04' },
}

export const isLoyaltyLang = (value: unknown): value is LoyaltyLang => typeof value === 'string' && (LOYALTY_LANGS as readonly string[]).includes(value)

/** The language to open in: ?lang=, else the browser's first supported language, else Hebrew. */
export function pickLanguage(param: string | null | undefined, acceptLanguage: string | null | undefined): LoyaltyLang {
  if (isLoyaltyLang(param)) return param
  for (const part of (acceptLanguage ?? '').split(',')) {
    const code = part.split(';')[0]?.trim().toLowerCase().slice(0, 2)
    if (code === 'iw') return 'he'
    if (isLoyaltyLang(code)) return code
  }
  return 'he'
}

/** 05X-XXXXXXX from what a person types (spaces, dashes, +972, 972). Anything else comes back as digits only (and fails the check). */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return /^9725\d{8}$/.test(digits) ? `0${digits.slice(3)}` : digits
}
export const isMobilePhone = (raw: string) => /^05\d{8}$/.test(normalizePhone(raw))
export const isEmail = (raw: string) => raw.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)

/** The longest body the endpoint reads. */
export const MAX_BODY_BYTES = 2048

export const webSignupSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60),
    phone: z.string().trim().min(9).max(20),
    email: z.string().trim().max(254).optional().default(''),
    /** The required confirmation (privacy notice, terms, 18+). Must be literally true. */
    acknowledged: z.literal(true),
    /** The separate, optional marketing consent. */
    marketing: z.boolean(),
    requestId: z.string().uuid(),
    lang: z.enum(LOYALTY_LANGS),
    /** Issued by the page (src/lib/loyalty/signup-server.ts): proves the form was loaded, not posted blind. */
    token: z.string().min(10).max(120),
    /** Honeypot: a person never sees this field; a bot fills it. */
    website: z.string().max(200).optional().default(''),
  })
  .strict()

export type WebSignupInput = z.infer<typeof webSignupSchema>
