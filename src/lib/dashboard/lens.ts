// The developer's single dashboard has three views — "lenses" (2026-10-16), the same idea as the Ayeka Bar dashboard.
// Pure: the page, the switcher and the checks all read this one list.
//
// Owner: "make the dev panel for me just like Ayeka Bar's" — one perspective with all three views: manager (exactly what
// an owner sees), employee (exactly what staff see) and developer (the tools).

export type Lens = 'manager' | 'employee' | 'dev' | 'alerts'

/** In the order the owner named them; the developer's own notification centre (2026-10-16: three containers, one per kind of
 *  alert the account receives) is the fourth, after the three views it sorts alerts for. */
export const LENSES: readonly { id: Lens; icon: string; he: string }[] = [
  { id: 'manager', icon: '⚙️', he: 'מנהל' },
  { id: 'employee', icon: '🧑‍🍳', he: 'עובד' },
  { id: 'dev', icon: '🛠️', he: 'מפתח' },
  { id: 'alerts', icon: '🔔', he: 'התראות' },
]

/** Which view opens when the URL does not say: the developer's own tools, which is what the page is opened for. */
export const DEFAULT_LENS: Lens = 'dev'

/** `?view=` from the URL, made safe. Anything that is not one of the views is the default. */
export function parseLens(v: unknown): Lens {
  const s = Array.isArray(v) ? v[0] : v
  return LENSES.some((l) => l.id === s) ? (s as Lens) : DEFAULT_LENS
}

/** The views one developer actually has. A developer whose account is not an owner has no manager view (it would lead to walls). */
export function lensesFor(canManage: boolean): readonly { id: Lens; icon: string; he: string }[] {
  return canManage ? LENSES : LENSES.filter((l) => l.id !== 'manager')
}
