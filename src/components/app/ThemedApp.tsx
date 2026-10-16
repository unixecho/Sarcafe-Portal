import AppMotion from '@/components/app/AppMotion'
import ThemeScope from '@/components/staff/ThemeScope'
import { loadStaffTheme } from '@/lib/staff/theme-server'
import '@/components/app/staff-themes.css'

// The one wrapper that carries a person's look through the whole panel (owner, 2026-10-17: "throughout the panel"): the staff app,
// the owner / manager dashboards and the cart sign-in (/crew) all render inside it. It reads the look on the server (the account's
// choice, else this device's cookie, else the default) and draws it on the wrapper, so there is no flash; ThemeScope mirrors it onto
// <html> for sheets and menus that portal to <body>. Someone who is not signed in (the cart sign-in) gets the device's look.
export default async function ThemedApp({ staffId, className, children }: { staffId: string | null | undefined; className?: string; children: React.ReactNode }) {
  const { theme } = await loadStaffTheme(staffId)
  return (
    <AppMotion className={className} theme={theme}>
      <ThemeScope theme={theme} />
      {theme === 'pass' && <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap" precedence="default" />}
      {children}
    </AppMotion>
  )
}
