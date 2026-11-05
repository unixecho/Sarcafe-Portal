import AppPageLoading from '@/components/app/AppPageLoading'

// The loading screen of the older staff pages. `data-staff-loading` tells the staff app's opening screen
// (components/staff/StaffAppIntro.tsx) the page is not ready yet.
export default function StaffPageLoading() {
  return <div data-staff-loading="" style={{ display: 'contents' }}><AppPageLoading /></div>
}
