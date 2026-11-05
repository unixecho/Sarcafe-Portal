// Said by PageTransitions the moment it starts a navigation, before the view transition takes its snapshot: anything that should
// react to the tap itself (the dock lights the tapped tab) listens for it. detail: { path } (pathname + search + hash).
export const NAV_START_EVENT = 'sarcafe:nav-start'
export type NavStartDetail = { path: string }
