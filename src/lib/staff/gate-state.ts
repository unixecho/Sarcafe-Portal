import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/server'

// What the staff pages need to know about a person beyond who they are: may they use the pages without notifications (the owner
// exempted their phone), and did they set their code but never finish the onboarding walk (then they are sent back to it).
//
// TOLERANT ON PURPOSE. These are extra columns (migration 20261016140000); if the database does not have them yet, or the read
// fails, the answer is "no exemption, nothing pending": the pages still open and nobody is sent anywhere. A failed read must
// never be the reason someone cannot work, and it must never be the reason the whole session fails (the identity itself is read
// separately, from columns that have always existed).

export type GateState = { exempt: boolean; onboardingPending: boolean }

export async function loadGateState(staffId: string): Promise<GateState> {
  const quiet: GateState = { exempt: false, onboardingPending: false }
  try {
    const service = createServiceRoleClient()
    const { data, error } = await service.from('staff').select('push_gate_exempt, onboarding_done_at').eq('id', staffId).maybeSingle()
    if (error || !data) return quiet
    const row = data as { push_gate_exempt?: boolean | null; onboarding_done_at?: string | null }
    let onboardingPending = false
    if (row.onboarding_done_at === null) {
      // Only someone who actually started (their invitation was used) has a walk to resume; a person who never had a link has none.
      const { data: used } = await service.from('staff_invitations').select('id').eq('staff_id', staffId).not('consumed_at', 'is', null).limit(1)
      onboardingPending = (used ?? []).length > 0
    }
    return { exempt: row.push_gate_exempt === true, onboardingPending }
  } catch {
    return quiet
  }
}
