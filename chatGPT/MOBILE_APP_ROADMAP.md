# Future native mobile track — Android and iOS

The current first step is a staff PWA with a dedicated manifest and Add to Home Screen onboarding. Preserve this web flow while validating daily use; do not start native packaging until the Givat Haviva checklist pilot proves the workflow.

## Current home-screen implementation (local, 2026-10-08)

- The staff manifest has a stable `/staff-app` identity, starts at `/staff`, and covers `/` so owner pages and event `/pos` stay in the installed app. The existing customer manifest is unchanged.
- `/staff` is a dependable Home: full Google owners reach `/owner/dashboard`; employees get grouped shift/service/account tools. Live events no longer force Home into a station. Number/code access offers checklists/events and a Google entry for scheduling; full Google also offers quick orders.
- Both dashboards render an actor-scoped notification inbox from the server, then refresh every 30 seconds and when visible. Notification delivery currently means the in-app inbox only.
- Every shared owner/staff header has Home, an explicit parent Back when applicable, and 44px controls. The event POS top bar has Home as well. Root viewport uses `viewport-fit=cover`; app chrome accounts for iOS safe areas.
- Installation help uses the existing accessible sheet (focus trap/restore, Escape and scroll lock), safely handles unavailable local storage, and can be reopened from Home. Staff and owner layouts use the staff manifest and Apple standalone metadata. Existing `/sw.js` is registered; it supports the existing order push behavior without adding staff/customer data caching or offline writes.
- Opaque number/code event sessions read live tickets/configuration/history through guarded APIs and refresh configuration every eight seconds. They do not open an unauthenticated Realtime subscription. Existing Google and linked quick JWT sessions retain their browser read and Realtime path.

This is a local implementation record. Production deployment and authenticated device verification are reported separately in root `handoff.md`.

## Next assignments

1. Measure pilot friction: completion time, abandoned runs, offline/reconnect behavior, reason-entry errors and home-screen installation success.
2. Harden the PWA: offline draft queue, background retry with idempotency, install analytics and authenticated iOS/Android device testing. The current service worker does not queue staff writes.
3. Decide the native route with an ADR: Capacitor wrapper versus React Native/Expo. Compare camera/media needs, push notifications, offline storage, background sync, App Store/Play review requirements and code sharing with the Next.js app.
4. Add native-ready auth: secure device storage, session revocation, account linking and recovery. Six-digit PIN remains floor-level assurance and never grants owner actions.
5. Prepare store compliance: privacy disclosures, account deletion/support path, permissions copy, accessibility, screenshots, app icons, signing, TestFlight and Play internal testing.
6. Pilot Android and iOS builds with staff before public store submission.

The native app should continue using the same staff UUIDs, shift assignments, checklist template versions and submission records so historical evidence remains one system.

# 2026-10-08 local PWA polish

The staff/owner workspace now has native-style grouped navigation, system fonts on iOS, Geist elsewhere with Hebrew fallback, safe-area spacing, 44px Home/Back controls, reduced-motion-aware short GSAP reveals, and a dedicated staff manifest starting at `/staff`. Installation remains Safari/OS Add to Home Screen. No native App Store package or offline staff data cache has been added. The standalone manifest, login return, opaque PIN transport, private payslip access and scheduling notification flows require a real iPhone pilot after the four new migrations and app release. Fresh Chrome fixture rendering passed at phone/tablet/desktop sizes; it is not an iOS/WebKit certification. Preserve the separate Claude intro preview; its port remains pending user review as recorded in handoff.
