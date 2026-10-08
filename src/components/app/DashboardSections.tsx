import Link from 'next/link'
import { ChevronLeft, type LucideIcon } from 'lucide-react'

export type DashboardEntry = { href: string; icon: LucideIcon; label: string; description: string; badge?: string }
export type DashboardCategory = { title: string; entries: DashboardEntry[] }

export default function DashboardSections({ categories, staff = false }: { categories: DashboardCategory[]; staff?: boolean }) {
  return (
    <nav className={`app-categories${staff ? ' app-categories--staff' : ''}`} aria-label="כלים ופעולות">
      {categories.map((category) => (
        <section className="app-section" key={category.title} aria-label={category.title}>
          <div className="app-section__heading"><h2>{category.title}</h2></div>
          <div className="app-group">
            {category.entries.map((entry) => (
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