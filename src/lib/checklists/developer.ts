export function isChecklistDeveloper(email: string | null | undefined): boolean {
  if (!email) return false
  const configured = (process.env.CHECKLIST_DEVELOPER_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  return new Set(configured).has(email.trim().toLowerCase())
}

/** The developer: the "מפתח/ת" badge, or an allow-listed email. Developers keep the employee home as their
 *  landing page and get a dedicated place for the test tools (/staff/dev); owners without this go to the
 *  owner dashboard as before. Server-side only (reads an env var). */
export function isDeveloper(row: { badge?: string | null; email?: string | null } | null | undefined): boolean {
  return !!row && (row.badge === 'developer' || isChecklistDeveloper(row.email))
}
