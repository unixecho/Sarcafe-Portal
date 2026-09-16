import { redirect } from 'next/navigation'

// Only real staff destination today — grows into a tile grid the same way
// /owner/dashboard did if/when more staff-facing (non-owner) features land.
export default function StaffIndexPage() {
  redirect('/staff/schedule')
}
