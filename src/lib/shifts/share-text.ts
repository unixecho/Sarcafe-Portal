// The words that travel with a shared schedule, and the page they point to.
// Pure — the share sheet puts the text next to the picture or the PDF.

export const PORTAL_ORIGIN = 'https://sarcafe-portal.vercel.app'

/**
 * The staff schedule page for one branch. The branch is a path segment, not a query,
 * because a signed-out recipient is sent through /login?next=… and that value may only
 * carry plain path characters — a query would be lost and they would land on the wrong branch.
 */
export function scheduleLink(branchSlug: string): string {
  return `${PORTAL_ORIGIN}/staff/schedule/${encodeURIComponent(branchSlug)}`
}

/** "לוח משמרות · מאור · 12.10 – 18.10", then the link alone on the last line. */
export function shareMessage(args: { title: string; branchName: string; rangeLabel: string; branchSlug: string }): string {
  return `${args.title} · ${args.branchName} · ${args.rangeLabel}\n${scheduleLink(args.branchSlug)}`
}

/** A file-name-safe tail for the saved picture or PDF. */
export function fileStem(args: { scope: 'mine' | 'everyone'; branchSlug: string; weekStart: string }): string {
  return `sarcafe-${args.scope === 'mine' ? 'my-shifts' : 'schedule'}-${args.branchSlug}-${args.weekStart}`
}
