import '@/components/pos/pos.css'
import { SkPointChips, SkShellBody } from '@/components/pos/shell/Skeletons'

// The shell's silhouette (top bar, switcher, a card grid) while the server resolves
// who is signed in and which event they work. Same classes as the real thing, so the
// real shell lands on top of it without anything moving. A server component: there is
// no language to read yet, so the one screen-reader label is Hebrew (the product language).
export default function PosLoading() {
  return (
    <div className="pos-app" aria-busy="true">
      <div className="pos-topbar" dir="ltr">
        <div className="pos-tb-left">
          <span className="sk sk-late pos-sk-bar" style={{ inlineSize: 44, blockSize: 44, borderRadius: 14 }} />
          <span className="sk sk-late pos-sk-bar" style={{ inlineSize: 44, blockSize: 44, borderRadius: 14 }} />
        </div>
        <div className="pos-tb-right">
          <span className="sk sk-late pos-sk-bar" style={{ inlineSize: 120, blockSize: 44, borderRadius: 999 }} />
        </div>
      </div>
      <main className="pos-main">
        <SkShellBody label="טוען את הקופה…" />
      </main>
      <div className="pos-dock">
        <div className="pos-dock-points">
          <SkPointChips count={4} />
        </div>
      </div>
    </div>
  )
}
