import { cookies } from 'next/headers'
import GlassSkeleton from '@/components/glass/GlassSkeleton'
import StaffPageLoading from '@/components/app/StaffPageLoading'

// The staff home's loading screen. The app sign-in (Google) gets the glass home, so its skeleton is glass; a six-digit-code
// sign-in gets the older checklist home, so it keeps the older skeleton. Told apart by the sign-in cookie alone (no database read
// while loading). The other /staff pages have their own loading.tsx. `data-staff-loading`: see StaffPageLoading.
export default async function Loading() {
  const google = (await cookies()).getAll().some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'))
  if (!google) return <StaffPageLoading />
  return <div data-staff-loading="" style={{ display: 'contents' }}><GlassSkeleton title="Sarcafe צוות" kind="employee" /></div>
}
