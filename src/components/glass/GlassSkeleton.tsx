import { cookies } from 'next/headers'
import GlassPage from './GlassPage'
import { BRANCH_COOKIE } from '@/lib/branches/current'

// The loading screen of a glass page (its route's loading.tsx), shaped like the page it stands for: the same backdrop, a top bar with
// the page's title, and shimmering blocks where the cards will be (the app's .sk convention, tinted for glass in glass.css). The dock
// is not drawn here: it belongs to the layout and stays on screen the whole time. The router has this ready before the tap (Next
// prefetches each tab's loading state), so a tab switch shows it at once and only the server's own time remains.
export type SkeletonKind = 'owner' | 'employee' | 'dev' | 'qa' | 'kiosk' | 'members'

const Line = ({ kind }: { kind?: 'title' | 'short' }) => <span className={`sk gl-sk-line${kind ? ` gl-sk-line--${kind}` : ''}`} />
const Card = ({ lines = 2, height }: { lines?: number; height?: number }) => (
  <div className="gl-surf gl-sk-card" style={height ? { minHeight: height } : undefined}>
    <Line kind="title" />
    {Array.from({ length: lines }, (_, i) => <Line key={i} kind={i === lines - 1 ? 'short' : undefined} />)}
  </div>
)
const Shortcuts = () => (
  <div className="gl-field">
    <Line kind="short" />
    <div className="gl-short">{[0, 1, 2, 3].map((i) => <span key={i} className="sk gl-sk-tile" />)}</div>
  </div>
)
const Welcome = () => <div className="gl-welcome gl-sk-card"><Line kind="title" /><Line kind="short" /></div>

function Body({ kind }: { kind: SkeletonKind }) {
  if (kind === 'members') return (
    <>
      <Card lines={2} height={150} />
      {[0, 1, 2].map((i) => <span key={i} className="sk gl-sk-tile" style={{ height: 64 }} />)}
    </>
  )
  if (kind === 'kiosk') return (
    <>
      <span className="sk gl-sk-chip" style={{ width: '100%' }} />
      <Card lines={3} height={150} />
      <div className="gl-sk-row">{[0, 1, 2].map((i) => <span key={i} className="sk gl-sk-chip" />)}</div>
      <Card lines={4} />
      <Card lines={4} />
    </>
  )
  if (kind === 'qa') return (
    <>
      <Card lines={4} height={220} />
      <div className="gl-stats">{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className="sk gl-sk-tile" />)}</div>
      <Card lines={3} />
    </>
  )
  if (kind === 'employee') return (
    <>
      <Welcome />
      <span className="sk gl-sk-tile gl-sk-tile--main" style={{ height: 76 }} />
      <Card lines={2} />
      <Card lines={3} height={150} />
      <Shortcuts />
    </>
  )
  return (
    <>
      {(kind === 'dev' || kind === 'owner') && <span className="sk gl-sk-chip" style={{ width: '100%' }} />}
      <Welcome />
      <Shortcuts />
      <div className="gl-stats">{[0, 1, 2].map((i) => <span key={i} className="sk gl-sk-tile" />)}</div>
      <Card lines={3} height={140} />
      <Card lines={2} />
    </>
  )
}

/** `branchFromCookie`: an owner's backdrop follows the branch they last chose (a cookie, no database read while loading). */
export default async function GlassSkeleton({ title, kind, branchFromCookie = false }: { title: string; kind: SkeletonKind; branchFromCookie?: boolean }) {
  const slug = branchFromCookie ? (await cookies()).get(BRANCH_COOKIE)?.value ?? null : null
  return (
    <GlassPage branchSlug={slug}>
      <header className="gl-top" aria-hidden="true">
        <div className="gl-top__bar gl-surf gl-sk-top">
          <span className="sk gl-sk-ico" />
          <span className="gl-top__title">{title}</span>
          <span className="sk gl-sk-ico" />
          <span className="sk gl-sk-ico" />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="gl-main" aria-busy="true" data-glass-skeleton="">
        <p className="sr-only" role="status">טוען…</p>
        <Body kind={kind} />
      </main>
    </GlassPage>
  )
}
