// One rule for "what do we call this person", used by the roster, the staff
// list, audit rows and notifications — and mirrored in SQL by sched_name()
// (migration 024). KEEP THE TWO IN SYNC: a name that reads one way on the
// schedule and another in the audit log is exactly the confusion this exists
// to remove.
//
// Order: the display name the owner chose -> first + last name -> the POS
// nickname (every person has one; it is required) -> email -> a last-resort
// label. Email is the LAST thing we show, never the thing we depend on: a person
// without an email is a first-class employee.

export type NameParts = {
  display_name?: string | null
  first_name?: string | null
  last_name?: string | null
  handle?: string | null
  email?: string | null
}

export const UNNAMED = 'ללא שם'

const clean = (v: string | null | undefined) => (typeof v === 'string' ? v.trim() : '')

export function staffDisplayName(row: NameParts | null | undefined): string {
  if (!row) return UNNAMED
  const display = clean(row.display_name)
  if (display) return display
  const full = [clean(row.first_name), clean(row.last_name)].filter(Boolean).join(' ')
  if (full) return full
  return clean(row.handle) || clean(row.email) || UNNAMED
}

/** One or two letters for an avatar circle. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = Array.from(parts[0]!)[0] ?? '?'
  const second = parts.length > 1 ? (Array.from(parts[parts.length - 1]!)[0] ?? '') : ''
  return (first + second).toUpperCase()
}
