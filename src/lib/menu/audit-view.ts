// Turns a menu_audit row's `detail` jsonb into field-level rows the audit
// UI can render collapsed-by-default — the same "summary answers it 95% of
// the time, the diff is one tap away" split AyekaBar's own AuditTrail uses.
// Sarcafe's detail already snapshots item names at write time (see
// summarizeMenuDiff in lib/menu/audit.ts), so — unlike AyekaBar's version,
// which resolves staff/role/station ids through a live lookup table — no
// id-to-name resolution is needed here at render time.

export type AuditRow = { label: string; before?: string; after?: string }

type MenuAuditEntry = {
  action: string
  detail: Record<string, unknown> | null
}

function isNamedList(value: unknown): value is { name: string }[] {
  return Array.isArray(value) && value.every((v) => v && typeof v === 'object' && 'name' in v)
}

export function auditRows(entry: MenuAuditEntry): AuditRow[] {
  const d = entry.detail ?? {}
  const rows: AuditRow[] = []

  if (isNamedList(d.availabilityFlips)) {
    for (const flip of d.availabilityFlips as { name: string; from: boolean; to: boolean }[]) {
      rows.push({ label: flip.name, before: flip.from ? 'במלאי' : 'אזל', after: flip.to ? 'במלאי' : 'אזל' })
    }
  }

  if (isNamedList(d.added)) {
    for (const item of d.added) rows.push({ label: item.name, after: 'נוסף' })
  }

  if (isNamedList(d.removed)) {
    for (const item of d.removed) rows.push({ label: item.name, before: 'הוסר' })
  }

  if (
    typeof d.categoryCountBefore === 'number' &&
    typeof d.categoryCountAfter === 'number' &&
    d.categoryCountBefore !== d.categoryCountAfter
  ) {
    rows.push({ label: 'מספר קטגוריות', before: String(d.categoryCountBefore), after: String(d.categoryCountAfter) })
  }

  if (Array.isArray(d.fields) && d.fields.length) {
    rows.push({ label: 'שדות שעודכנו', after: (d.fields as unknown[]).join(', ') })
  }

  if (typeof d.excludedCount === 'number') {
    rows.push({ label: 'פריטים מוסתרים בגרסה', after: String(d.excludedCount) })
  }

  return rows
}
