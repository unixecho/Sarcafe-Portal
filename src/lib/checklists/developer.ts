export function isChecklistDeveloper(email: string | null | undefined): boolean {
  if (!email) return false
  const configured = (process.env.CHECKLIST_DEVELOPER_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  return new Set(configured).has(email.trim().toLowerCase())
}
