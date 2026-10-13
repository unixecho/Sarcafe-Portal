'use client'

import { useEffect } from 'react'
import { launchRedirect } from '@/lib/staff/launch'

// A home-screen app must open the staff HOME, not whatever page its icon happened to be saved from.
//
// On iPhone, "Add to Home Screen" remembers the address of the page you were looking at, not the manifest's
// start_url. An employee who scanned the till's QR code and added the app from that sign-in page (or from the
// register itself) ended up with an icon that opened the register's code sign-in every time. We cannot change what
// the phone saved, so the app corrects itself: the FIRST page of a launch, when running as an installed app, is
// sent to /staff if it is the bare register or a sign-in that was heading to the register / a checklist QR.
//
// What is deliberately left alone: a station link (/pos?v=station&p=…, saved on purpose for a station tablet),
// everything after the first page of a launch (so a person can still open the register from the home page and
// reload it), a push notification that opens a specific page, and the customer's installed order tracker.

const LAUNCHED = 'sarcafe:launched:v1'
export default function StandaloneLaunchGuard() {
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
    if (!standalone) return
    let first = true
    try {
      first = sessionStorage.getItem(LAUNCHED) !== '1'
      sessionStorage.setItem(LAUNCHED, '1')
    } catch { /* Without storage every page counts as a launch; the rules above only touch two entry pages. */ }
    if (!first) return
    const target = launchRedirect(window.location)
    if (target) window.location.replace(target)
  }, [])
  return null
}
