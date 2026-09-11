import type { DashboardStats } from '@/lib/owner/dashboard-stats'

function Cell({ label, display }: { label: string; display: string }) {
  return (
    <div
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 10px',
        textAlign: 'center',
      }}
    >
      <div className="ltr-isolate" style={{ fontSize: '1.35rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
        {display}
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

/**
 * Always-present KPI cells. A stat whose backing read failed shows "—",
 * never "0" — `known` travels with every value specifically so a failure
 * is never misreported as "nothing's happening" (mirrors AyekaBar's
 * StatStrip exactly).
 */
export default function StatStrip({ stats }: { stats: DashboardStats }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      <Cell
        label="קטגוריות בתפריט"
        display={stats.categoryCount.known ? String(stats.categoryCount.value) : '—'}
      />
      <Cell
        label="פריטים אזלו"
        display={stats.outOfStockCount.known ? String(stats.outOfStockCount.value) : '—'}
      />
      <Cell
        label="סטטוס פרסום"
        display={
          !stats.hasUnpublishedChanges.known
            ? '—'
            : stats.hasUnpublishedChanges.value
              ? 'טיוטה'
              : 'עדכני'
        }
      />
    </div>
  )
}
