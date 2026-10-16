import Link from 'next/link'
import { ChevronLeft, type LucideIcon } from 'lucide-react'

/** `soon` turns the tile into a plain, unclickable one that says why it is not open yet ("בקרוב · בפיתוח"); it needs no href. */
export type DashboardEntry = { href?: string; icon: LucideIcon; label: string; description: string; badge?: string; soon?: string }
export type DashboardCategory = { title: string; entries: DashboardEntry[] }

/** A text-face smiley is mirrored by right-to-left text (":)" reads "(:"); it is set apart as left-to-right so it keeps its shape. */
export function SoonText({ text }: { text: string }) {
  return <>{text.split(/(:\))/).map((part, index) => (part === ':)' ? <bdi key={index} dir="ltr">{part}</bdi> : part))}</>
}

export default function DashboardSections({ categories, staff = false }: { categories: DashboardCategory[]; staff?: boolean }) {
  return (
    <nav className={`app-categories${staff ? ' app-categories--staff' : ''}`} aria-label="כלים ופעולות">
      {categories.map((category) => (
        <section className="app-section" key={category.title} aria-label={category.title}>
          <div className="app-section__heading"><h2>{category.title}</h2></div>
          <div className="app-group">
            {category.entries.map((entry) => entry.soon || !entry.href ? (
              <div key={entry.label} className="app-row app-row--soon">
                <span className="app-row__icon"><entry.icon size={22} strokeWidth={1.8} aria-hidden="true" /></span>
                <span className="app-row__copy"><strong>{entry.label}</strong><small>{entry.description}</small></span>
                <span className="app-row__soon"><SoonText text={entry.soon ?? ''} /></span>
              </div>
            ) : (
              <Link key={entry.href} href={entry.href} className="app-row">
                <span className="app-row__icon"><entry.icon size={22} strokeWidth={1.8} aria-hidden="true" /></span>
                <span className="app-row__copy"><strong>{entry.label}</strong><small>{entry.description}</small>{entry.badge && <span className="app-row__badge">{entry.badge}</span>}</span>
                <ChevronLeft size={17} aria-hidden="true" className="app-row__chevron" />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </nav>
  )
}
