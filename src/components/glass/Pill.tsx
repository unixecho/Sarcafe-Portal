import type { ReactNode } from 'react'

/** The one badge style for counts and states (the "2 בקשות" pill). `ok` green, `bad` red, `quiet` neutral, default the look's accent. */
export default function Pill({ children, tone, tiny = false }: { children: ReactNode; tone?: 'ok' | 'bad' | 'quiet'; tiny?: boolean }) {
  return <span className={`gl-pill${tone ? ` gl-pill--${tone}` : ''}${tiny ? ' gl-pill--tiny' : ''}`}>{children}</span>
}
