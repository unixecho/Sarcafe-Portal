import { z } from 'zod'
import { AD_ACTIONS, AD_KINDS, SETTINGS_BOUNDS } from './content-project'

// The two request contracts of the kiosk-content feature, shared by the routes and the pages (no server-only imports):
//   * contentSaveSchema   the owner's one Save on /owner/kiosk (PUT /api/owner/kiosk/content)
//   * feedbackSchema      the public poll's answer (POST /api/kiosk/content/feedback)
// The database functions check every rule again (kiosk_content_save / kiosk_feedback_submit); these are the first,
// friendlier gate.

/** The longest poll body the endpoint reads: three ids, 500 characters of Hebrew, a rating and a request id. */
export const FEEDBACK_MAX_BODY_BYTES = 4096
export const SUGGESTION_MAX = 500
export const MAX_VOTES = 3
export const MAX_ADS = 20
export const MAX_OPTIONS = 12

const HM = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const oneLine = (max: number) => z.string().max(max * 2).transform((s) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()).pipe(z.string().max(max))

export const exceptionSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    closed: z.boolean(),
    open: z.string().regex(HM).nullable(),
    close: z.string().regex(HM).nullable(),
    note: oneLine(80).nullable(),
  })
  .strict()
  .refine((e) => e.closed || (e.open !== null && e.close !== null), { message: 'times required', path: ['open'] })

export const adSchema = z
  .object({
    id: z.string().uuid().nullable(),
    kind: z.enum(AD_KINDS),
    title: oneLine(80).pipe(z.string().min(1)),
    body: oneLine(400),
    action: z.enum(AD_ACTIONS),
    imageUrl: z.string().trim().max(500).nullable(),
    menuItemIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(12),
    enabled: z.boolean(),
  })
  .strict()

export const optionSchema = z
  .object({
    id: z.string().uuid().nullable(),
    label: oneLine(60).pipe(z.string().min(1)),
    enabled: z.boolean(),
  })
  .strict()

const bounded = (b: { min: number; max: number }) => z.number().int().min(b.min).max(b.max)

export const contentSaveSchema = z
  .object({
    settings: z
      .object({
        idleSeconds: bounded(SETTINGS_BOUNDS.idleSeconds),
        graceSeconds: bounded(SETTINGS_BOUNDS.graceSeconds),
        slideSeconds: bounded(SETTINGS_BOUNDS.slideSeconds),
        exceptions: z.array(exceptionSchema).max(60),
      })
      .strict(),
    ads: z.array(adSchema).max(MAX_ADS),
    options: z.array(optionSchema).max(MAX_OPTIONS),
  })
  .strict()

export type ContentSave = z.infer<typeof contentSaveSchema>
export type ContentSaveAd = z.infer<typeof adSchema>
export type ContentSaveOption = z.infer<typeof optionSchema>
export type ContentSaveException = z.infer<typeof exceptionSchema>

export const feedbackSchema = z
  .object({
    optionIds: z.array(z.string().uuid()).max(MAX_VOTES),
    suggestion: z.string().max(SUGGESTION_MAX * 2).optional().default(''),
    rating: z.number().int().min(1).max(5).nullable().optional().default(null),
    requestId: z.string().uuid(),
    /** Honeypot: a person never sees this field; a bot fills it. */
    website: z.string().max(200).optional().default(''),
  })
  .strict()
  .refine((f) => f.suggestion.trim().length <= SUGGESTION_MAX, { message: 'too long', path: ['suggestion'] })

export type FeedbackInput = z.infer<typeof feedbackSchema>

/** Owner-page labels for the card kinds. */
export const KIND_LABELS: Record<(typeof AD_KINDS)[number], string> = {
  location: 'מיקום',
  feedback: 'משוב (QR)',
  loyalty: 'מועדון לקוחות',
  hours: 'שעות פתיחה',
  menu_highlight: 'מומלצים מהתפריט',
  custom: 'מותאם אישית',
}

export const ACTION_LABELS: Record<(typeof AD_ACTIONS)[number], string> = {
  none: 'בלי כפתור',
  join: 'הרשמה למועדון',
  menu: 'פתיחת התפריט',
}
