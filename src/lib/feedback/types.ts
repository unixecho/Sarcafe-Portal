// The customer feedback box's vocabulary and its caps — ported from
// AyekaBar's lib/feedback/types.ts. Every cap here is ALSO a CHECK
// constraint in migration 009: an app-layer rule that returns a useful
// message, plus a database rule that holds even if a future route forgets.
// Change one, change the other.

export const FEEDBACK_CATEGORIES = ['business', 'technical'] as const
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]

/** new = owner hasn't looked. read = they have. resolved = they're done.
 *  Deliberately three, not two — "seen" and "dealt with" are different
 *  claims, and collapsing them makes the inbox only ever all-unread or
 *  all-finished. */
export const FEEDBACK_STATUSES = ['new', 'read', 'resolved'] as const
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export const MAX_MESSAGE_LEN = 1000
export const MIN_MESSAGE_LEN = 2
export const MAX_EMAIL_LEN = 254
export const MAX_PAGE_URL_LEN = 300

// Both rate limits go through the same table-backed check_rate_limit()
// every other public write path in this app uses (migration 003).
export const FEEDBACK_RATE_MAX = 5
export const FEEDBACK_RATE_WINDOW_SECONDS = 600
export const FEEDBACK_GLOBAL_RATE_MAX = 60
export const FEEDBACK_GLOBAL_RATE_WINDOW_SECONDS = 600

/** One feedback row, as the owner inbox reads it. */
export interface FeedbackRow {
  id: string
  category: FeedbackCategory
  message: string
  contact_email: string | null
  page_url: string | null
  branch_slug: string | null
  status: FeedbackStatus
  resolved_at: string | null
  created_at: string
}

/** What the public endpoint accepts. camelCase because this is the WIRE
 *  shape the browser sends, not a row. */
export interface FeedbackInput {
  category: FeedbackCategory
  message: string
  contactEmail: string | null
  pageUrl: string | null
  branchSlug: string | null
}
