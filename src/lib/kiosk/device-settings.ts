import { z } from 'zod'

// The settings of ONE kiosk tablet (what its control panel and the owner's page change). Pure: no database, no network,
// no server-only imports, so the routes, the owner page and scripts/check-kiosk-device.mjs all run this very file.
//
// What is STORED is sparse: only the values somebody changed. Everything else follows the defaults below, so a default
// can be improved later without rewriting what each tablet saved. `null` in a patch means "back to the default" (for the
// three timings, "follow the branch's timing from /owner/kiosk"). The tablet carries a copy of DEFAULTS in
// prototypes/sarcafe-kiosk-app/overrides/kiosk-config.js; scripts/check-kiosk-device.mjs fails when the two drift.

/** The branch the first kiosk was pinned to, and what a request that names no device (and a registry that is not there yet) is served as. */
export const KIOSK_BRANCH_SLUG = 'givat-haviva'
/** The tablet that already existed (Givat Haviva): what a request that names no device is served as. */
export const DEFAULT_KIOSK_DEVICE = 'givat-haviva-1'
export const DEVICE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

export const KIOSK_LANGS = ['he', 'en', 'ar'] as const
export const CLOSING_SOURCES = ['shift', 'hours', 'shift_then_hours'] as const
export const AD_TRANSITIONS = ['slide', 'fade'] as const
export const TAP_ACTIONS = ['ad', 'main'] as const
export const BATTERY_DISPLAYS = ['tray', 'corner', 'hidden'] as const

export type KioskLang = (typeof KIOSK_LANGS)[number]

export type KioskDeviceSettings = {
  display: {
    /** The header says who is on shift (first names). */
    showEmployees: boolean
    /** The header says when the place closes. */
    showClosing: boolean
    /** Where "closing at" comes from: the end of the running shifts, the opening hours, or the shifts first and the hours when there is no shift. */
    closingSource: (typeof CLOSING_SOURCES)[number]
    showBranch: boolean
    showItemCount: boolean
    /** The "project made by John" line on the welcome screen. */
    showCredit: boolean
    /** The club: the welcome button, the choice card and the ads' join action. */
    clubEnabled: boolean
  }
  ads: {
    /** The two arrow buttons on the sides of the ads. */
    arrows: boolean
    /** Dragging the ads sideways. */
    swipe: boolean
    autoPlay: boolean
    /** Going past the last ad comes back to the first (and the other way round). */
    loop: boolean
    transition: (typeof AD_TRANSITIONS)[number]
    /** What a tap on an ad does: its own action first ('ad'), or always the main screen ('main'). */
    tapAction: (typeof TAP_ACTIONS)[number]
    /** null follows the branch's slide time. */
    slideSeconds: number | null
    /** Ads (their ids) this tablet does not show. */
    hiddenIds: string[]
  }
  timing: {
    /** null follow the branch's times (/owner/kiosk). */
    idleSeconds: number | null
    graceSeconds: number | null
    /** How long the sign-up confirmation stays before the screen goes home. */
    successSeconds: number
    contentRefreshMinutes: number
  }
  language: {
    default: KioskLang
    enabled: KioskLang[]
    showSwitch: boolean
  }
  battery: {
    /** Where the charge shows for staff: pulled down from the top edge, a small badge in a corner, or nowhere (the panel still shows it). */
    display: (typeof BATTERY_DISPLAYS)[number]
    /** The developer is told when the charge falls below `alertPercent` while not charging. */
    alertEnabled: boolean
    alertPercent: number
    /** A second, urgent alert. */
    criticalEnabled: boolean
    criticalPercent: number
  }
}

export const SETTINGS_DEFAULTS: KioskDeviceSettings = {
  display: { showEmployees: true, showClosing: true, closingSource: 'shift_then_hours', showBranch: true, showItemCount: true, showCredit: true, clubEnabled: true },
  ads: { arrows: true, swipe: true, autoPlay: true, loop: true, transition: 'slide', tapAction: 'ad', slideSeconds: null, hiddenIds: [] },
  timing: { idleSeconds: null, graceSeconds: null, successSeconds: 10, contentRefreshMinutes: 15 },
  language: { default: 'he', enabled: ['he', 'en', 'ar'], showSwitch: true },
  battery: { display: 'tray', alertEnabled: true, alertPercent: 50, criticalEnabled: false, criticalPercent: 15 },
}

type Spec =
  | { t: 'bool' }
  | { t: 'enum'; values: readonly string[] }
  | { t: 'int'; min: number; max: number }
  | { t: 'ids'; max: number }
  | { t: 'langs' }
const B: Spec = { t: 'bool' }
const E = (values: readonly string[]): Spec => ({ t: 'enum', values })
const N = (min: number, max: number): Spec => ({ t: 'int', min, max })

/** Every setting, its kind and its bounds: the one table the validation, the merge and the owner page read. */
export const SETTINGS_SPEC: Record<keyof KioskDeviceSettings, Record<string, Spec>> = {
  display: { showEmployees: B, showClosing: B, closingSource: E(CLOSING_SOURCES), showBranch: B, showItemCount: B, showCredit: B, clubEnabled: B },
  ads: { arrows: B, swipe: B, autoPlay: B, loop: B, transition: E(AD_TRANSITIONS), tapAction: E(TAP_ACTIONS), slideSeconds: N(3, 60), hiddenIds: { t: 'ids', max: 20 } },
  timing: { idleSeconds: N(30, 300), graceSeconds: N(5, 30), successSeconds: N(5, 60), contentRefreshMinutes: N(5, 120) },
  language: { default: E(KIOSK_LANGS), enabled: { t: 'langs' }, showSwitch: B },
  battery: { display: E(BATTERY_DISPLAYS), alertEnabled: B, alertPercent: N(10, 90), criticalEnabled: B, criticalPercent: N(5, 40) },
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function valid(spec: Spec, value: unknown): boolean {
  switch (spec.t) {
    case 'bool': return typeof value === 'boolean'
    case 'enum': return typeof value === 'string' && spec.values.includes(value)
    case 'int': return typeof value === 'number' && Number.isInteger(value) && value >= spec.min && value <= spec.max
    case 'ids': return Array.isArray(value) && value.length <= spec.max && value.every((v) => typeof v === 'string' && UUID.test(v)) && new Set(value).size === value.length
    case 'langs': return Array.isArray(value) && value.length >= 1 && value.length <= KIOSK_LANGS.length && value.every((v) => (KIOSK_LANGS as readonly string[]).includes(v)) && new Set(value).size === value.length
  }
}

export type SettingsSparse = { [S in keyof KioskDeviceSettings]?: { [K in keyof KioskDeviceSettings[S]]?: KioskDeviceSettings[S][K] } }
export type SettingsPatch = { [S in keyof KioskDeviceSettings]?: { [K in keyof KioskDeviceSettings[S]]?: KioskDeviceSettings[S][K] | null } }

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Reads what the database holds: keeps every known, valid value and drops the rest (a damaged row never breaks the kiosk). */
export function normalizeStored(raw: unknown): SettingsSparse {
  const out: Record<string, Record<string, unknown>> = {}
  if (!isObject(raw)) return {}
  for (const [section, fields] of Object.entries(SETTINGS_SPEC)) {
    const given = raw[section]
    if (!isObject(given)) continue
    for (const [key, spec] of Object.entries(fields)) {
      if (key in given && valid(spec, given[key])) (out[section] ??= {})[key] = given[key]
    }
  }
  return fixCrossRules(out as SettingsSparse)
}

/** Rules between two settings. A value that breaks one is dropped (back to the default), never half-applied. */
function fixCrossRules(s: SettingsSparse): SettingsSparse {
  const e = effective(s)
  if (!e.language.enabled.includes(e.language.default) && s.language) delete s.language.enabled
  const after = effective(s)
  if (!after.language.enabled.includes(after.language.default) && s.language) delete s.language.default
  if (after.battery.criticalPercent >= after.battery.alertPercent && s.battery) delete s.battery.criticalPercent
  for (const k of Object.keys(s) as Array<keyof SettingsSparse>) if (s[k] && Object.keys(s[k]!).length === 0) delete s[k]
  return s
}

export function effective(stored: SettingsSparse | null | undefined): KioskDeviceSettings {
  const base = SETTINGS_DEFAULTS
  const out = {
    display: { ...base.display, ...(stored?.display ?? {}) },
    ads: { ...base.ads, hiddenIds: [...base.ads.hiddenIds], ...(stored?.ads ?? {}) },
    timing: { ...base.timing, ...(stored?.timing ?? {}) },
    language: { ...base.language, enabled: [...base.language.enabled], ...(stored?.language ?? {}) },
    battery: { ...base.battery, ...(stored?.battery ?? {}) },
  }
  return out as KioskDeviceSettings
}

/** Why a settings patch cannot be applied, in the owner's language; null when it can. Checked on the RESULT of the merge. */
export function crossRuleError(merged: SettingsSparse): string | null {
  const e = effective(merged)
  if (!e.language.enabled.includes(e.language.default)) return 'שפת ברירת המחדל חייבת להיות אחת מהשפות הפעילות.'
  if (e.battery.criticalPercent >= e.battery.alertPercent) return 'סף ההתראה הדחופה חייב להיות נמוך מסף ההתראה הרגילה.'
  return null
}

/** The merge: sections and values from the patch on top of what is stored; null removes a value. Does not validate. */
export function mergeStored(stored: SettingsSparse, patch: SettingsPatch): SettingsSparse {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [section, fields] of Object.entries(stored)) out[section] = { ...(fields as Record<string, unknown>) }
  for (const [section, fields] of Object.entries(patch)) {
    if (!fields) continue
    const target = (out[section] ??= {})
    for (const [key, value] of Object.entries(fields)) {
      if (value === null) delete target[key]
      else target[key] = value
    }
    if (Object.keys(target).length === 0) delete out[section]
  }
  return out as SettingsSparse
}

function zodFor(spec: Spec): z.ZodTypeAny {
  switch (spec.t) {
    case 'bool': return z.boolean()
    case 'enum': return z.enum(spec.values as [string, ...string[]])
    case 'int': return z.number().int().min(spec.min).max(spec.max)
    case 'ids': return z.array(z.string().regex(UUID)).max(spec.max).refine((a) => new Set(a).size === a.length, 'duplicate')
    case 'langs': return z.array(z.enum(KIOSK_LANGS)).min(1).max(KIOSK_LANGS.length).refine((a) => new Set(a).size === a.length, 'duplicate')
  }
}

/** The request contract: any subset of the settings, every value inside its bounds, no unknown key. */
export const settingsPatchSchema: z.ZodType<SettingsPatch> = z
  .object(
    Object.fromEntries(
      Object.entries(SETTINGS_SPEC).map(([section, fields]) => [
        section,
        z
          .object(Object.fromEntries(Object.entries(fields).map(([key, spec]) => [key, zodFor(spec).nullable().optional()])))
          .strict()
          .optional(),
      ]),
    ),
  )
  .strict() as unknown as z.ZodType<SettingsPatch>

/** The shape of a tablet's report (POST /api/kiosk/device). */
export const deviceReportSchema = z
  .object({
    device: z.string().regex(DEVICE_SLUG_PATTERN).optional(),
    battery: z
      .object({
        level: z.number().int().min(0).max(100).nullable().optional(),
        charging: z.boolean().nullable().optional(),
      })
      .strict()
      .optional(),
    app: z.number().int().min(0).max(1_000_000).nullable().optional(),
    web: z.string().max(40).nullable().optional(),
    /** The control panel's "send a test alert": nothing is recorded, one test alert goes to the developer. */
    test: z.literal(true).optional(),
  })
  .strict()

export type DeviceReport = z.infer<typeof deviceReportSchema>

/** The shape of a tablet saving its own settings (PUT /api/kiosk/device). */
export const deviceSaveSchema = z
  .object({
    device: z.string().regex(DEVICE_SLUG_PATTERN).optional(),
    patch: settingsPatchSchema,
  })
  .strict()

/** One-line plain text from a name typed by a person. */
export const deviceNameSchema = z
  .string()
  .max(120)
  .transform((s) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim())
  .pipe(z.string().min(1).max(60))
