import { redirect } from 'next/navigation'

// The bookmarked bare /owner URL — always bounces to /login, which routes
// onward by role once signed in. Mirrors AyekaBar (kept only because a URL
// like this tends to get bookmarked/typed from memory).
export default function OwnerRootPage() {
  redirect('/login')
}
