// The QA suite's world: two branches, a published week (and a draft one that must never be messaged), an owner, a developer,
// a general manager, employees with and without notifications, an inactive one and an all-branch one switched off at one branch.
// Invented names only. Dates are relative to "today" on the Jerusalem calendar so the suite works any day.
import { fakeJwt } from './supabase.mjs'

export const ID = {
  gh: '11111111-1111-4111-8111-111111111111',
  maor: '22222222-2222-4222-8222-222222222222',
  owner: 'a0000000-0000-4000-8000-000000000001',
  dev: 'a0000000-0000-4000-8000-000000000002',
  gm: 'a0000000-0000-4000-8000-000000000003',
  dana: 'a0000000-0000-4000-8000-000000000004',   // GH, notifications on
  itai: 'a0000000-0000-4000-8000-000000000005',   // GH, notifications OFF
  noa: 'a0000000-0000-4000-8000-000000000006',    // Maor, notifications on
  roi: 'a0000000-0000-4000-8000-000000000007',    // GH, INACTIVE, notifications on
  shira: 'a0000000-0000-4000-8000-000000000008',  // every branch, notifications on, switched off at Maor
  weekGh: 'b0000000-0000-4000-8000-000000000001',
  weekMaor: 'b0000000-0000-4000-8000-000000000002',
  weekDraft: 'b0000000-0000-4000-8000-000000000003',
  shiftTodayAm: 'c0000000-0000-4000-8000-000000000001',
  shiftTodayPm: 'c0000000-0000-4000-8000-000000000002',
  shiftTomorrowAm: 'c0000000-0000-4000-8000-000000000003',
  shiftMaorTomorrow: 'c0000000-0000-4000-8000-000000000004',
  shiftDraft: 'c0000000-0000-4000-8000-000000000005',
  shiftOld: 'c0000000-0000-4000-8000-000000000006',
  shiftFar: 'c0000000-0000-4000-8000-000000000007',
}
const AUTH = { owner: 'd0000000-0000-4000-8000-000000000001', dev: 'd0000000-0000-4000-8000-000000000002', gm: 'd0000000-0000-4000-8000-000000000003', dana: 'd0000000-0000-4000-8000-000000000004', itai: 'd0000000-0000-4000-8000-000000000005', noa: 'd0000000-0000-4000-8000-000000000006' }
export const SESSIONS = Object.fromEntries(Object.entries(AUTH).map(([who, sub]) => [who, { sub, sessionId: sub.replace(/^d/, 'e') }]))

export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const weekStart = (iso) => addDays(iso, -new Date(`${iso}T00:00:00Z`).getUTCDay())

export function userFor(who) {
  const s = SESSIONS[who]
  return { id: s.sub, aud: 'authenticated', role: 'authenticated', email: `${who}@qa.sarcafe.invalid`, app_metadata: { provider: 'google' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
}
export const tokenFor = (who) => fakeJwt({ sub: SESSIONS[who].sub, session_id: SESSIONS[who].sessionId, email: `${who}@qa.sarcafe.invalid` })

export function seed() {
  const t = today()
  const staff = (id, first, extra) => ({ id, auth_user_id: null, role: 'employee', badge: null, branch_id: ID.gh, active: true, email: `${first}@qa.sarcafe.invalid`, display_name: first, first_name: first, last_name: 'בדיקה', employee_no: null, employee_code: null, push_gate_exempt: true, onboarding_done_at: '2026-01-01T00:00:00Z', ui_theme: 'glass', avatar_emoji: null, created_at: '2026-01-01T00:00:00Z', ...extra })
  const shift = (id, week, branch, date, start, end) => ({ id, week_id: week, branch_id: branch, shift_date: date, start_time: start, end_time: end, preset_id: null, station_id: null, requirements: [], note: null })
  const assign = (shift_id, staff_id, name, branch = ID.gh) => ({ id: crypto.randomUUID(), branch_id: branch, shift_id, staff_id, staff_name: name, role_id: null, status: 'assigned' })
  const tokens = {}
  for (const who of Object.keys(AUTH)) tokens[tokenFor(who)] = { ...userFor(who), __refresh: `refresh-${who}` }
  return {
    __tokens: tokens,
    branches: [
      { id: ID.gh, slug: 'givat-haviva', name: { he: 'גבעת חביבה', en: 'Givat Haviva' }, kind: 'permanent', timezone: 'Asia/Jerusalem', active: true, created_at: '2026-01-01T00:00:00Z', hours: null },
      { id: ID.maor, slug: 'maor', name: { he: 'מאור', en: 'Maor' }, kind: 'permanent', timezone: 'Asia/Jerusalem', active: true, created_at: '2026-01-02T00:00:00Z', hours: null },
    ],
    staff: [
      staff(ID.owner, 'אורית', { role: 'owner', branch_id: null, auth_user_id: AUTH.owner }),
      staff(ID.dev, 'דב', { role: 'owner', badge: 'developer', branch_id: null, auth_user_id: AUTH.dev }),
      staff(ID.gm, 'גלית', { badge: 'general_manager', auth_user_id: AUTH.gm }),
      staff(ID.dana, 'דנה', { auth_user_id: AUTH.dana }),
      staff(ID.itai, 'איתי', { auth_user_id: AUTH.itai }),
      staff(ID.noa, 'נועה', { branch_id: ID.maor, auth_user_id: AUTH.noa }),
      staff(ID.roi, 'רועי', { active: false }),
      staff(ID.shira, 'שירה', { branch_id: null }),
    ],
    schedule_members: [{ branch_id: ID.maor, staff_id: ID.shira, schedulable: false }],
    staff_push_subscriptions: [ID.owner, ID.dev, ID.gm, ID.dana, ID.noa, ID.roi, ID.shira].map((id, i) => ({ id: crypto.randomUUID(), staff_id: id, endpoint: `https://fcm.googleapis.com/fcm/send/qa-${i}`, p256dh: 'qa', auth: 'qa', created_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-01-01T00:00:00Z' })),
    schedule_weeks: [
      { id: ID.weekGh, branch_id: ID.gh, week_start: weekStart(t), status: 'published', published_snapshot: {} },
      { id: ID.weekMaor, branch_id: ID.maor, week_start: weekStart(t), status: 'published', published_snapshot: {} },
      { id: ID.weekDraft, branch_id: ID.gh, week_start: addDays(weekStart(t), 7), status: 'draft', published_snapshot: null },
    ],
    shifts: [
      shift(ID.shiftTodayAm, ID.weekGh, ID.gh, t, '00:00', '23:59'),
      shift(ID.shiftTodayPm, ID.weekGh, ID.gh, t, '14:00', '22:00'),
      shift(ID.shiftTomorrowAm, ID.weekGh, ID.gh, addDays(t, 1), '07:00', '14:00'),
      shift(ID.shiftMaorTomorrow, ID.weekMaor, ID.maor, addDays(t, 1), '08:00', '15:00'),
      shift(ID.shiftDraft, ID.weekDraft, ID.gh, addDays(t, 2), '07:00', '14:00'),
      shift(ID.shiftOld, ID.weekGh, ID.gh, addDays(t, -5), '07:00', '14:00'),
      shift(ID.shiftFar, ID.weekGh, ID.gh, addDays(t, 30), '07:00', '14:00'),
    ],
    shift_assignments: [
      assign(ID.shiftTodayAm, ID.dana, 'דנה'), assign(ID.shiftTodayAm, ID.itai, 'איתי'),
      assign(ID.shiftTodayPm, ID.dana, 'דנה'),
      assign(ID.shiftTomorrowAm, ID.dana, 'דנה'), assign(ID.shiftTomorrowAm, ID.itai, 'איתי'), assign(ID.shiftTomorrowAm, ID.roi, 'רועי'), assign(ID.shiftTomorrowAm, ID.gm, 'גלית'),
      assign(ID.shiftMaorTomorrow, ID.noa, 'נועה', ID.maor),
      assign(ID.shiftDraft, ID.itai, 'איתי'), assign(ID.shiftOld, ID.dana, 'דנה'), assign(ID.shiftFar, ID.dana, 'דנה'),
    ],
    shift_settings: [{ branch_id: ID.gh, stations: [], presets: [] }, { branch_id: ID.maor, stations: [], presets: [] }],
    shift_swaps: [{ id: crypto.randomUUID(), branch_id: ID.gh, status: 'peer_accepted' }],
    shift_requests: [{ id: crypto.randomUUID(), branch_id: ID.gh, status: 'pending' }],
    schedule_notifications: [
      { id: crypto.randomUUID(), branch_id: ID.gh, staff_id: ID.owner, kind: 'schedule.published', title: 'הסידור לשבוע הבא פורסם', body: 'גבעת חביבה, 07:00–14:00', link: {}, created_at: new Date(Date.now() - 600000).toISOString(), read_at: null, push_sent_at: new Date().toISOString() },
      { id: crypto.randomUUID(), branch_id: ID.gh, staff_id: ID.owner, kind: 'swap.declined', title: 'בקשת ההחלפה נדחתה', body: 'משמרת יום ה׳', link: {}, created_at: new Date(Date.now() - 3600000).toISOString(), read_at: null, push_sent_at: new Date().toISOString() },
      { id: crypto.randomUUID(), branch_id: ID.gh, staff_id: ID.owner, kind: 'issues.digest', title: '3 דברים לטיפול', body: 'חלב, מכונה', link: {}, created_at: new Date(Date.now() - 7200000).toISOString(), read_at: new Date().toISOString(), push_sent_at: new Date().toISOString() },
    ],
    pos_quick_sessions: [],
    staff_employee_sessions: [],
    staff_tool_usage: [],
    staff_tool_searches: [],
    staff_messages: [],
    qa_runs: [],
  }
}
