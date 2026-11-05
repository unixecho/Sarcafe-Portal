import GlassSkeleton from '@/components/glass/GlassSkeleton'

// The owner dashboard is glass: its loading screen is the glass skeleton (the dock stays on screen, it belongs to the layout).
export default function DashboardLoading() {
  return <GlassSkeleton title="לוח הבקרה" kind="owner" branchFromCookie />
}
