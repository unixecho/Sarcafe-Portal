import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { personLabel, ensureChecklistTemplates } from '@/lib/checklists/server'
import { loadShortageReport } from '@/lib/checklists/issues-server'
import { shortageCount } from '@/lib/checklists/gaps'
import { KIND_LABELS, type ChecklistKind } from '@/lib/checklists/types'
import { limitsOf, type Limits } from '@/lib/shifts/constraints'
import type { Branch } from '@/lib/branches'

type Service = SupabaseClient

// The data behind a branch's manager page (/owner/branches/<slug>): one read that says what the branch is, who works
// there, which checklists are on, how the schedule is set up and whether the branch is READY for a first day. The
// readiness list is the part meant for a new branch: every line says what is missing and where to fix it.

export const CHECKLIST_KINDS: readonly ChecklistKind[] = ['opening', 'handover', 'closing']

export const CHECKLIST_EXPLAIN: Record<ChecklistKind, string> = {
  opening: 'מי שפותח את הסניף עובר על הטופס בתחילת המשמרת הראשונה של היום.',
  handover: 'כשיש יותר ממשמרת אחת ביום: כל משמרת מעבירה לבאה אחריה, ובוחנת את מה שקיבלה.',
  closing: 'מי שסוגר את הסניף עובר על הטופס בסוף המשמרת האחרונה של היום.',
}

export type BranchChecklistState = {
  kind: ChecklistKind
  /** What this branch calls the form (the name its builder gave it), or the standard name until it has one. */
  label: string
  explain: string
  enabled: boolean
  hasTemplate: boolean
  version: number | null
  publishedAt: string | null
  /** When it was switched off (only while off) */
  disabledFrom: string | null
}

export type BranchPerson = { id: string; name: string; badge: string | null; schedulable: boolean }

export type ReadinessItem = { id: string; label: string; ok: boolean; hint: string; tab: 'overview' | 'checklists' | 'schedule' | 'details' | 'team' | 'pos' }

/** An event: a stall the POS trades at. It belongs to a truck (branches.parent_branch_id); the POS is a subsystem of a branch. */
export type PosEvent = { id: string; slug: string; name: string; parentId: string | null; /** the register is switched on for it (null = could not be read) */ posEnabled: boolean | null }
export type TruckLite = { id: string; slug: string; name: string }

/** Every truck and every event, with who each event belongs to. Read with the service role: the parent link is an owner matter and is
 *  never part of what the public portal selects. */
export async function loadEventTree(service: Service): Promise<{ trucks: TruckLite[]; events: PosEvent[] }> {
  const [{ data: rows }, { data: pos }] = await Promise.all([
    service.from('branches').select('id, slug, name, kind, parent_branch_id, created_at').eq('active', true).order('created_at', { ascending: true }),
    service.from('pos_branch_settings').select('branch_id, enabled'),
  ])
  const enabledOf = new Map((pos ?? []).map((row) => [row.branch_id as string, row.enabled === true]))
  const nameOf = (row: { name: unknown; slug: unknown }) => (row.name as { he?: string } | null)?.he || String(row.slug)
  const trucks: TruckLite[] = []
  const events: PosEvent[] = []
  for (const row of rows ?? []) {
    if (row.kind === 'event') events.push({ id: row.id as string, slug: row.slug as string, name: nameOf(row), parentId: (row.parent_branch_id as string | null) ?? null, posEnabled: pos ? (enabledOf.get(row.id as string) ?? false) : null })
    else trucks.push({ id: row.id as string, slug: row.slug as string, name: nameOf(row) })
  }
  return { trucks, events }
}

export type BranchOverview = {
  id: string
  slug: string
  name: string
  kind: 'permanent' | 'event'
  openNow: boolean
  hoursConfigured: boolean
  hoursToday: { open: string; close: string } | null
  people: BranchPerson[]
  checklists: BranchChecklistState[]
  /** open חוסרים ופערים (null when it could not be read) */
  shortages: number | null
  schedule: { presets: number; roles: number; stations: number; limits: Limits; availability: boolean; swaps: boolean }
  linksSet: number
  readiness: ReadinessItem[]
  /** this truck's events (its POS subsystem) and the events nobody has claimed yet */
  events: PosEvent[]
  unassignedEvents: PosEvent[]
  /** every coffee truck, for the slider at the top (events are not in it: the POS lives inside its branch) */
  trucks: TruckLite[]
}

export async function loadBranchOverview(service: Service, branch: Branch): Promise<BranchOverview> {
  await ensureChecklistTemplates(service, { id: branch.id, slug: branch.slug, name: { he: branch.name.he } }).catch(() => undefined)
  const [tree, templates, switches, settings, staffRows, members, shortages] = await Promise.all([
    loadEventTree(service).catch(() => ({ trucks: [] as TruckLite[], events: [] as PosEvent[] })),
    service.from('checklist_templates').select('kind, name, version, published_at').eq('branch_id', branch.id).eq('active', true),
    service.from('checklist_branch_settings').select('kind, enabled, disabled_from').eq('branch_id', branch.id),
    service.from('shift_settings').select('presets, roles, stations, features').eq('branch_id', branch.id).maybeSingle(),
    service.from('staff').select('id, display_name, first_name, last_name, handle, badge, role, branch_id').eq('active', true),
    service.from('schedule_members').select('staff_id, schedulable').eq('branch_id', branch.id),
    loadShortageReport(service, branch.id).then((report) => shortageCount(report)).catch(() => null),
  ])

  const templateOf = new Map((templates.data ?? []).map((row) => [row.kind as ChecklistKind, row]))
  const switchOf = new Map((switches.data ?? []).map((row) => [row.kind as ChecklistKind, row]))
  const checklists = CHECKLIST_KINDS.map((kind): BranchChecklistState => {
    const template = templateOf.get(kind)
    const sw = switchOf.get(kind)
    const enabled = sw ? sw.enabled === true : true
    return {
      kind, label: (template?.name as string | undefined)?.trim() || KIND_LABELS[kind], explain: CHECKLIST_EXPLAIN[kind], enabled,
      hasTemplate: Boolean(template), version: (template?.version as number | undefined) ?? null, publishedAt: (template?.published_at as string | undefined) ?? null,
      disabledFrom: !enabled ? ((sw?.disabled_from as string | undefined) ?? null) : null,
    }
  })

  const memberOf = new Map((members.data ?? []).map((row) => [row.staff_id as string, row.schedulable !== false]))
  const people = (staffRows.data ?? [])
    .filter((row) => row.branch_id === null || row.branch_id === branch.id)
    .map((row): BranchPerson => ({ id: row.id as string, name: personLabel(row), badge: (row.badge as string | null) ?? null, schedulable: memberOf.get(row.id as string) ?? true }))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'))

  const cfg = settings.data
  const schedule = {
    presets: Array.isArray(cfg?.presets) ? (cfg!.presets as unknown[]).length : 0,
    roles: Array.isArray(cfg?.roles) ? (cfg!.roles as unknown[]).length : 0,
    stations: Array.isArray(cfg?.stations) ? (cfg!.stations as unknown[]).length : 0,
    limits: limitsOf(cfg?.features as { maxDaysOff?: unknown; maxShiftBlocks?: unknown } | null),
    availability: (cfg?.features as { availability?: boolean } | null)?.availability !== false,
    swaps: (cfg?.features as { swaps?: boolean } | null)?.swaps !== false,
  }
  const linksSet = Object.values(branch.links).filter(Boolean).length
  const schedulable = people.filter((p) => p.schedulable).length
  const anyChecklist = checklists.some((c) => c.enabled && c.hasTemplate)

  const readiness: ReadinessItem[] = [
    { id: 'hours', label: 'שעות פעילות', ok: branch.hoursConfigured === true, hint: 'בלי שעות הלקוחות לא רואים אם הסניף פתוח.', tab: 'schedule' },
    { id: 'templates', label: 'משמרות קבועות (בוקר / ערב)', ok: schedule.presets > 0, hint: 'השעות שמוצעות כשיוצרים משמרת בסידור.', tab: 'schedule' },
    { id: 'team', label: 'צוות משויך לסניף', ok: schedulable > 0, hint: 'אפשר לשבץ רק מי שמסומן כזמין לשיבוץ בסניף.', tab: 'team' },
    { id: 'checklists', label: 'צ׳קליסטים פעילים', ok: anyChecklist, hint: 'לפחות צ׳קליסט אחד פעיל, כדי שהצוות יקבל את הטפסים.', tab: 'checklists' },
    { id: 'links', label: 'קישורי ניווט ושיתוף', ok: linksSet > 0, hint: 'Waze, Google Maps ואינסטגרם שמופיעים בדף הסניף.', tab: 'details' },
  ]

  return {
    id: branch.id, slug: branch.slug, name: branch.name.he, kind: branch.kind === 'event' ? 'event' : 'permanent',
    openNow: branch.openNow, hoursConfigured: branch.hoursConfigured === true, hoursToday: branch.hoursToday,
    people, checklists, shortages: shortages as number | null, schedule, linksSet, readiness,
    events: tree.events.filter((event) => event.parentId === branch.id),
    unassignedEvents: tree.events.filter((event) => event.parentId === null),
    trucks: tree.trucks,
  }
}

/** The state of one checklist switch after a change, for the client to show without a reload. */
export function checklistState(rows: { kind: ChecklistKind; enabled: boolean; disabled_from: string | null }[], kind: ChecklistKind): { enabled: boolean; disabledFrom: string | null } {
  const row = rows.find((r) => r.kind === kind)
  return { enabled: row ? row.enabled : true, disabledFrom: row && !row.enabled ? row.disabled_from : null }
}
