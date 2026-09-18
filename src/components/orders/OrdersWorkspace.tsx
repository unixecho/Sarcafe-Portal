'use client'

import { useState, type CSSProperties } from 'react'
import { Plus } from 'lucide-react'
import BranchSwitcher from '@/components/BranchSwitcher'
import { haptic } from '@/lib/haptics'
import OrdersProvider, { useOrders } from './OrdersProvider'
import NewOrderSheet from './NewOrderSheet'
import OrderBoard from './OrderBoard'
import ReceiptSheet, { type ReceiptData } from './ReceiptSheet'
import type { Branch, BranchSlug } from '@/lib/branches'

export default function OrdersWorkspace({ branches, initialBranch }: { branches: Branch[]; initialBranch: BranchSlug }) {
  const [branch, setBranch] = useState<BranchSlug>(initialBranch)

  return (
    <OrdersProvider branchSlug={branch}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {branches.length > 1 && <BranchSwitcher branches={branches} value={branch} onChange={setBranch} />}
        <PosControls />
      </div>
    </OrdersProvider>
  )
}

function PosControls() {
  const { error } = useOrders()
  const [sheetOpen, setSheetOpen] = useState(false)
  // Lifted above both NewOrderSheet (fresh order) and OrderBoard (staff
  // reprint) — both need to open the SAME receipt sheet, and a reprint
  // must work with the builder closed.
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)

  return (
    <>
      <button
        type="button"
        className="press rise"
        onClick={() => {
          haptic('select')
          setSheetOpen(true)
        }}
        style={newOrderBtnStyle}
      >
        <Plus size={20} strokeWidth={2.5} aria-hidden="true" />
        הזמנה חדשה
      </button>

      {error && (
        <p role="alert" style={{ margin: 0, color: '#ff6b6b', fontSize: '0.85rem' }}>
          {error}
        </p>
      )}

      <OrderBoard onReceipt={setReceipt} />

      <NewOrderSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onReceipt={setReceipt} />

      <ReceiptSheet
        open={!!receipt}
        onClose={() => setReceipt(null)}
        orderNumber={receipt?.orderNumber ?? null}
        access={receipt?.access ?? null}
        lines={receipt?.lines ?? []}
        total={receipt?.total ?? 0}
      />
    </>
  )
}

const newOrderBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  minHeight: 'var(--tap-min)',
  borderRadius: 16,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontWeight: 800,
  fontSize: '1rem',
  cursor: 'pointer',
}
