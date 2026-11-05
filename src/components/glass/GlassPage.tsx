import type { ReactNode } from 'react'
import 'glisse/styles.css'
import './glass.css'
import GlassBackdrop from './GlassBackdrop'
import GlassMotion from './GlassMotion'
import GlassToaster from './GlassToaster'

// A glass screen: the branch's backdrop, the toaster and the scroll smoothing. Server component; put <GlassTopBar>, the content
// (<main className="gl-main">) and <GlassDock> inside, or use <GlassDashboardShell>, which does it. Guide: docs/SARCAFE_GLASS_UI.md.
export default function GlassPage({ branchSlug, children }: { branchSlug?: string | null; children: ReactNode }) {
  return (
    <div className="gl-page">
      <GlassBackdrop slug={branchSlug} />
      <GlassMotion />
      {children}
      <GlassToaster />
    </div>
  )
}
