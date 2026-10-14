// What a link into the schedule may ask for: a tab and a week. An alert opens the tab it is about
// (/staff/schedule?tab=requests&week=2026-10-18); anything else in the query is ignored, so a link can only
// choose between screens the person could open anyway.

const TABS = new Set(['schedule', 'requests', 'availability', 'week', 'problems', 'settings', 'log'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export type ScheduleEntry = { tab?: string; week?: string }

export function scheduleEntry(search: { tab?: string | string[]; week?: string | string[] }): ScheduleEntry {
  const tab = typeof search.tab === 'string' ? search.tab : undefined
  const week = typeof search.week === 'string' ? search.week : undefined
  return { ...(tab && TABS.has(tab) ? { tab } : {}), ...(week && ISO_DATE.test(week) ? { week } : {}) }
}
