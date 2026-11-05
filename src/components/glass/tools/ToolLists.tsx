'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { SoonText } from '@/components/app/DashboardSections'
import { toolById, type ToolEntry } from '@/lib/tools'
import { suggestTools } from '@/lib/tools/search'
import { useTools } from './ToolsProvider'
import { toolIcon } from './toolIcons'

const isLink = (e: ToolEntry) => !e.action && !e.soon

/** "קיצורים שמותאמים לך": the four tools this person most likely wants now (their history, role and the time of day). */
export function ToolShortcuts() {
  const { ctx, badges, open, track } = useTools()
  const hits = useMemo(() => suggestTools(ctx, 4), [ctx])
  if (!hits.length) return null
  return (
    <section aria-labelledby="gl-shortcuts" className="gl-field">
      <h2 id="gl-shortcuts" className="gl-label">קיצורים שמותאמים לך</h2>
      <div className="gl-short">
        {hits.map(({ entry: e }) => {
          const Icon = toolIcon(e.id)
          const inner = (
            <>
              <span className="gl-ico gl-ico--sm"><Icon size={19} strokeWidth={1.8} aria-hidden="true" /></span>
              <span className="gl-short__label">{e.label}</span>
              {badges[e.id] && <span className="gl-pill gl-pill--tiny">{badges[e.id]}</span>}
            </>
          )
          return isLink(e)
            ? <Link key={e.id} href={e.href} className="gl-surf gl-short__tile" onClick={() => track(e)}>{inner}</Link>
            : <button key={e.id} type="button" className="gl-surf gl-short__tile" onClick={() => open(e)}>{inner}</button>
        })}
      </div>
    </section>
  )
}

/** The home screen's tool lists, from the tool index (src/lib/tools/index.ts → HOME_TOOL_GROUPS). */
export function ToolGroups({ groups }: { groups: { title: string; ids: string[] }[] }) {
  const { badges, open, track } = useTools()
  const resolved = useMemo(() => groups.map((g) => ({ title: g.title, entries: g.ids.map(toolById).filter((e): e is ToolEntry => !!e) })).filter((g) => g.entries.length), [groups])
  return (
    <nav aria-label="כלים ופעולות" className="gl-field" style={{ gap: 14 }}>
      {resolved.map((group) => (
        <section key={group.title} className="gl-cat" aria-label={group.title}>
          <h2 className="gl-label">{group.title}</h2>
          <div className="gl-surf gl-group">
            {group.entries.map((e) => {
              const Icon = toolIcon(e.id)
              const inner = (
                <>
                  <span className="gl-ico gl-ico--sm"><Icon size={21} strokeWidth={1.8} aria-hidden="true" /></span>
                  <span className="gl-tool__copy"><strong>{e.label}</strong><small>{e.hint}</small></span>
                  {e.soon ? <span className="gl-pill gl-pill--quiet"><SoonText text={e.soon} /></span> : badges[e.id] ? <span className="gl-pill">{badges[e.id]}</span> : e.kind === 'action' && e.action ? <span className="gl-pill gl-pill--quiet">פעולה</span> : null}
                  {!e.soon && <ChevronLeft size={17} className="gl-chev" aria-hidden="true" />}
                </>
              )
              if (e.soon) return <div key={e.id} className="gl-tool" aria-disabled="true" style={{ cursor: 'default', opacity: 0.8 }}>{inner}</div>
              return isLink(e)
                ? <Link key={e.id} href={e.href} className="gl-tool" onClick={() => track(e)}>{inner}</Link>
                : <button key={e.id} type="button" className="gl-tool" onClick={() => open(e)}>{inner}</button>
            })}
          </div>
        </section>
      ))}
    </nav>
  )
}
