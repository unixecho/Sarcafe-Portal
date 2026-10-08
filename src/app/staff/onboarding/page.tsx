import type { Metadata } from 'next'
import StaffOnboarding from '@/components/staff/StaffOnboarding'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'החשבון שלך | Sarcafe', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default function StaffOnboardingPage() { return <StaffOnboarding /> }
