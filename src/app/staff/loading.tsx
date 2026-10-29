import AppPageLoading from '@/components/app/AppPageLoading'

// `data-staff-loading` tells the staff app's opening screen (components/staff/StaffAppIntro.tsx) the page is not ready yet.
export default function Loading() {
  return <div data-staff-loading="" style={{ display: 'contents' }}><AppPageLoading /></div>
}
