import OnShiftRefresher from '@/components/shifts/OnShiftRefresher'
import ShiftScroller from '@/components/shifts/ShiftScroller'
import type { OnShiftBranch } from '@/lib/staff/on-shift'
import './on-shift.css'

// "מי במשמרת עכשיו": the top of the staff schedule page. One card per branch, and in it a strip to swipe through three slides:
// the previous shift, NOW (the people whose published shift is running, with hours and station) and the next shift. The viewer's
// own row is marked. The data is lib/staff/on-shift.ts; <OnShiftRefresher> asks the page to re-read it every minute while open.
export default function OnShiftNow({ branches, viewerId, clock }: { branches: OnShiftBranch[]; viewerId: string; clock: string }) {
  if (!branches.length) return null
  const total = branches.reduce((n, b) => n + b.people.length, 0)
  return (
    <section className="osn" id="on-shift" aria-labelledby="osn-title">
      <OnShiftRefresher />
      <header className="osn__head">
        <span className={`osn__dot${total > 0 ? ' osn__dot--live' : ''}`} aria-hidden="true" />
        <h2 id="osn-title" className="osn__title">מי במשמרת עכשיו</h2>
        <span className="osn__clock ltr-isolate" aria-label={`נכון ל־${clock}`}>{clock}</span>
      </header>
      <div className="osn__grid">
        {branches.map((branch) => (
          <article key={branch.id} className="osn__branch" aria-label={`סניף ${branch.name}`}>
            <div className="osn__branch-head">
              <strong>{branch.name}</strong>
              <span className={`osn__count${branch.people.length > 0 ? ' osn__count--on' : ''}`}>{branch.people.length > 0 ? `${branch.people.length} במשמרת` : 'אין משמרת פעילה'}</span>
            </div>
            <ShiftScroller slots={branch.slots} viewerId={viewerId} branchName={branch.name} />
          </article>
        ))}
      </div>
    </section>
  )
}
