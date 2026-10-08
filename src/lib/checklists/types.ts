export type ChecklistKind = 'opening' | 'handover' | 'closing'
export type ChecklistItemKind = 'status' | 'action' | 'number'
export type ChecklistIssueType = 'inventory' | 'cleanliness' | 'equipment' | 'cash' | 'other'

export type ChecklistItem = {
  id: string
  label: string
  help?: string
  kind: ChecklistItemKind
  issueType: ChecklistIssueType
  required?: boolean
  target?: number
  unit?: string
}

export type ChecklistCategory = {
  id: string
  title: string
  items: ChecklistItem[]
}

export type ChecklistDefinition = {
  categories: ChecklistCategory[]
}

export type ChecklistAnswer = {
  result: 'ok' | 'issue'
  reason?: string
  value?: number
  answeredAt: string
}

export type ChecklistAssignment = {
  id: string
  branchId: string
  branchName: string
  shiftId: string
  shiftAssignmentId: string
  shiftDate: string
  startTime: string
  endTime: string
  kind: ChecklistKind
  kindLabel: string
  templateVersion: number
  template: ChecklistDefinition
  status: 'pending' | 'in_progress' | 'submitted'
  answers: Record<string, ChecklistAnswer>
  issueCount: number
  submittedAt: string | null
  testMode?: boolean
}

export type ChecklistPreviewTemplate = {
  id: string
  kind: ChecklistKind
  kindLabel: string
  name: string
  version: number
  definition: ChecklistDefinition
}

export const KIND_LABELS: Record<ChecklistKind, string> = {
  opening: 'פתיחת משמרת',
  handover: 'החלפת משמרת',
  closing: 'סגירת משמרת',
}

export function flattenChecklistDefinition(definition: ChecklistDefinition) {
  return definition.categories.flatMap((category) => category.items.map((item) => ({ ...item, categoryId: category.id, categoryTitle: category.title })))
}
