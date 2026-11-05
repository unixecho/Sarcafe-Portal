import {
  Accessibility, Beaker, Bell, Building2, CalendarClock, ClipboardCheck, ClipboardList, Clock, Coffee, Download, FileEdit, FileText, History, KeyRound, Link2,
  ListChecks, LogOut, Megaphone, MessageCircle, MonitorSmartphone, PackageX, Palette, QrCode, Receipt, Repeat, ShoppingBag, Sparkles, Star, Tablet,
  TriangleAlert, UserPlus, UserRound, Users, UsersRound, Wrench, type LucideIcon,
} from 'lucide-react'

// The icon of each tool (kept apart from src/lib/tools/index.ts, which stays pure for the checks).
export const TOOL_ICONS: Record<string, LucideIcon> = {
  'staff-list': Users, 'add-staff': UserPlus, 'schedule-manage': CalendarClock, 'approve-swap': Repeat, 'checklists-track': ClipboardCheck, compose: Megaphone,
  'on-shift': UsersRound, issues: TriangleAlert, 'pos-quick': ShoppingBag, 'pos-events': Receipt, 'tablet-avail': Tablet, 'mark-soldout': PackageX,
  'pos-soon': ShoppingBag, 'my-pos': Receipt, 'menu-editor': ClipboardList, 'publish-menu': FileEdit, reviews: Star, feedback: MessageCircle, waitlist: UserPlus,
  'export-waitlist': Download, kiosk: MonitorSmartphone, 'kiosk-poll': QrCode, links: Link2, audit: History, intro: Sparkles, a11y: Accessibility,
  branches: Building2, 'my-schedule': CalendarClock, constraints: Clock, swap: Repeat, 'checklist-open': ListChecks, 'checklist-close': ClipboardCheck,
  'report-issue': Wrench, workshop: Coffee, profile: UserRound, payslip: FileText, 'login-code': KeyRound, look: Palette, push: Bell, signout: LogOut,
  'dev-mode': Beaker, 'qa-review': ClipboardCheck, 'dev-alerts': Bell,
}
export const toolIcon = (id: string): LucideIcon => TOOL_ICONS[id] ?? ClipboardList
