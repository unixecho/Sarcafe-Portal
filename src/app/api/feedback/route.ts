import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { getCustomerFeedbackEnabled } from '@/lib/settings/server'
import { validateFeedbackInput } from '@/lib/feedback/validate'
import {
  FEEDBACK_RATE_MAX,
  FEEDBACK_RATE_WINDOW_SECONDS,
  FEEDBACK_GLOBAL_RATE_MAX,
  FEEDBACK_GLOBAL_RATE_WINDOW_SECONDS,
} from '@/lib/feedback/types'

// The customer feedback box's write path — ported from AyekaBar's
// /api/feedback/route.ts. Deliberately bare: no requireOwner()/
// requireStaff(), not even a session — a suggestion box behind a login
// wall collects nothing. It's one of the very few public write paths in
// this app, so the guard rails are order-of-operations, not
// authentication:
//
//   1. Same-origin only (Origin/Content-Type) — a signed row should never
//      be attributable to someone who didn't submit it, and requiring
//      application/json closes the simple-request CSRF hole outright.
//   2. A body-size ceiling, checked from the header before the body is read.
//   3. Two rate limits — per-IP, then global (see lib/feedback/types.ts).
//   4. A honeypot, answered with 200 so a script learns nothing.
//   5. The owner's switch, re-read here rather than trusted from the page.
//   6. Validation (lib/feedback/validate.ts), returning the exact object
//      inserted.
//
// No IP is stored — used only transiently for rate limiting. Errors are
// codes, not sentences: the portal/menu pages are the trilingual surface,
// and lib/feedback/i18n.ts maps each code into the visitor's own language.

const MAX_BODY_BYTES = 16_384
const HONEYPOT_FIELD = 'company'

function refuse(code: string, status: number) {
  return NextResponse.json({ error: code }, { status })
}

// Lets client-rendered pages (the portal, which has no server wrapper to
// fetch this through server-side) decide whether to render FeedbackButton
// at all, without needing a dedicated settings endpoint. Display only —
// POST above re-reads the same switch regardless of what this returns.
export async function GET() {
  return NextResponse.json({ enabled: await getCustomerFeedbackEnabled() })
}

export async function POST(request: NextRequest) {
  try {
    // ---- 1. Same-origin only ---------------------------------------------
    const origin = request.headers.get('origin')
    if (origin) {
      let originHost: string | null = null
      try {
        originHost = new URL(origin).host
      } catch {
        originHost = null
      }
      const host = request.headers.get('host')
      if (!originHost || !host || originHost !== host) return refuse('bad_request', 403)
    }

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().includes('application/json')) {
      return refuse('bad_request', 415)
    }

    // ---- 2. Size -----------------------------------------------------------
    const declared = Number(request.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return refuse('message_too_long', 413)
    }

    // ---- 3. Rate limits ------------------------------------------------------
    const ip = clientIp(request)
    if (!(await checkRateLimit(`feedback:${ip}`, FEEDBACK_RATE_MAX, FEEDBACK_RATE_WINDOW_SECONDS))) {
      return refuse('rate_limited', 429)
    }
    if (!(await checkRateLimit('feedback:global', FEEDBACK_GLOBAL_RATE_MAX, FEEDBACK_GLOBAL_RATE_WINDOW_SECONDS))) {
      return refuse('rate_limited', 429)
    }

    const body = await request.json().catch(() => null)
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return refuse('bad_request', 400)
    }

    // ---- 4. Honeypot ---------------------------------------------------------
    const honeypot = (body as Record<string, unknown>)[HONEYPOT_FIELD]
    if (typeof honeypot === 'string' && honeypot.trim() !== '') {
      return NextResponse.json({ ok: true })
    }

    // ---- 5. The owner's switch ------------------------------------------------
    if (!(await getCustomerFeedbackEnabled())) return refuse('disabled', 403)

    // ---- 6. Validation ---------------------------------------------------------
    const parsed = validateFeedbackInput(body)
    if (!parsed.ok) return refuse(parsed.error, 400)

    // Sarcafe has no customer accounts, so — unlike AyekaBar's customer_id
    // resolution here — there is nothing to look up beyond what
    // validateFeedbackInput already normalized. branch_slug is the analog:
    // captured from the calling page, not an identity.
    const { error } = await createServiceRoleClient()
      .from('customer_feedback')
      .insert({
        category: parsed.value.category,
        message: parsed.value.message,
        contact_email: parsed.value.contactEmail,
        page_url: parsed.value.pageUrl,
        branch_slug: parsed.value.branchSlug,
      })

    if (error) {
      console.error('feedback insert failed:', error.code, error.message)
      return refuse('server', 500)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('feedback route error:', err)
    return refuse('server', 500)
  }
}
