export type Payslip = { id: string; pay_month: string; file_name: string; byte_size: number; uploaded_at: string }
export type StaffRecords = {
  employee: { id: string; first_name: string | null; last_name: string | null; display_name: string | null; employee_no: number | null; email: string | null; active: boolean }
  shifts: { id: string; date: string; start: string; end: string; label: string; branch: string }[]
  checklists: { id: string; kind: string; status: string; issue_count: number; submitted_at: string | null; created_at: string; issues: { label?: string; reason?: string }[] }[]
  orders: { id: string; ticket_no: number; total_agorot: number; status: string; created_at: string }[]
  payslips: Payslip[]
  canReadPayslips: boolean
}
