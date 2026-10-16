'use client'

import ShiftsProvider, { useShifts } from '@/components/shifts/ShiftsProvider'
import ManagerPanel from '@/components/shifts/ManagerPanel'
import { SettingsDraftProvider, SettingsSaveBar } from '@/components/shifts/SettingsDraft'

// The scheduler's own settings (hours, shift templates, safety rules, what employees may ask for, roles, stations, the
// roster) inside the branch manager. They are the SAME panel and the SAME draft the schedule screen uses, so there is
// one set of settings and one Save. The draft needs the branch's schedule loaded first (it starts from it), so the
// provider mounts only once that has arrived — exactly what the schedule screen does.
function Body() {
  const { db, loading, error, refresh } = useShifts()
  if (!db) {
    if (error) return <div className="sch-error" role="alert">{error}<button type="button" className="sch-btn sch-btn--sm press" onClick={() => void refresh()}>ניסיון נוסף</button></div>
    return <div className="sk" style={{ height: 220 }} aria-busy={loading} aria-label="טוען את ההגדרות" />
  }
  return (
    <SettingsDraftProvider>
      <ManagerPanel />
      <SettingsSaveBar />
    </SettingsDraftProvider>
  )
}

export default function ScheduleSettings({ branchSlug }: { branchSlug: string }) {
  return (
    <ShiftsProvider branchSlug={branchSlug}>
      <Body />
    </ShiftsProvider>
  )
}
