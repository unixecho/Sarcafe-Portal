// Where a person is sent to act on ONE specific checklist. Pure (no server-only, no '@/' imports) so the push
// writer, the home screen, the sign-in redirect and the check scripts all use the same shape.
//
// The checklist id travels in the PATH, not in a query: a signed-out visitor is sent through
// /login?next=…, and that value is limited to plain path characters (see login/page.tsx), so only a path
// survives sign-in. A phone with an expired session therefore still lands on the checklist it was told about.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isChecklistId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

/** The employee's page for one checklist: opens the form straight away (or says why it cannot be opened). */
export const staffChecklistPath = (assignmentId: string) => `/staff/checklists/${assignmentId}`

/** The owner's tracker, scrolled to that row (with the dismiss button on it). */
export const ownerChecklistPath = (assignmentId: string) => `/owner/checklists/${assignmentId}`

/** A destination the number + code sign-in may send a person to after they type their code. */
export const isStaffChecklistPath = (value: unknown): value is `/staff/checklists/${string}` => {
  if (typeof value !== 'string' || !value.startsWith('/staff/checklists/')) return false
  return isChecklistId(value.slice('/staff/checklists/'.length))
}

/** The owner's equivalent, which only the Google sign-in can return to (owners never use a code). */
export const isOwnerChecklistPath = (value: unknown): value is `/owner/checklists/${string}` => {
  if (typeof value !== 'string' || !value.startsWith('/owner/checklists/')) return false
  return isChecklistId(value.slice('/owner/checklists/'.length))
}
