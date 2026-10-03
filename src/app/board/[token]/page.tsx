import type { Metadata, Viewport } from 'next'
import BoardView from '@/components/pos/board/BoardView'

// The PUBLIC Ready board. No sign-in: the link is the credential, so this page is kept
// out of every index and out of every Referer header (the token is in the URL, and a
// click out of the page must not hand it to another site).
export const metadata: Metadata = {
  title: 'Sarcafe — הזמנות מוכנות',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
  referrer: 'no-referrer',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#150f0c',
}

export const dynamic = 'force-dynamic'

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ point?: string | string[] }>
}) {
  const { token } = await params
  const sp = await searchParams
  // ?point= is only a display filter; anything that is not a plain id is ignored rather than trusted.
  const raw = typeof sp.point === 'string' ? sp.point.trim() : ''
  const point = /^[0-9a-f-]{36}$/i.test(raw) ? raw : null
  return <BoardView token={token} pointFilter={point} />
}
