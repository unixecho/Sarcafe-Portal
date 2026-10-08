'use client'

import { ChevronLeft, Smartphone } from 'lucide-react'
import { STAFF_INSTALL_EVENT } from '@/components/staff/StaffInstallIntro'

export default function InstallAppButton() {
  return <button type="button" className="app-row app-row--quiet app-install-trigger" onClick={() => window.dispatchEvent(new Event(STAFF_INSTALL_EVENT))}><span className="app-row__icon"><Smartphone size={22} aria-hidden="true" /></span><span className="app-row__copy"><strong>הוספה למסך הבית</strong><small>גישה נוחה לאפליקציה מהטלפון שלך</small></span><ChevronLeft size={18} className="app-row__chevron" aria-hidden="true" /></button>
}