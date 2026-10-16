import ThemedApp from '@/components/app/ThemedApp'
import { resolveStaffIdentity } from '@/lib/staff/session'
import { GeistSans } from 'geist/font/sans'

// The cart sign-in wears the look of whoever is signed in, or else the look this phone remembers (the cookie), or the default.
export default async function CrewLayout({ children }: { children: React.ReactNode }) {
  const me = await resolveStaffIdentity().catch(() => null)
  return <ThemedApp staffId={me?.id} className={GeistSans.variable}>{children}</ThemedApp>
}
