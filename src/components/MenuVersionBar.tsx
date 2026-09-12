'use client'

import { useState } from 'react'
import { Pencil, Timer, Trash2, Plus } from 'lucide-react'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import PromptSheet, { type PromptRequest } from '@/components/PromptSheet'
import TempMenuSheet from '@/components/TempMenuSheet'
import VariantWizard from '@/components/VariantWizard'
import { localized } from '@/lib/menu/types'
import type { MenuDoc, MenuVariant } from '@/lib/menu/types'

type MenuVersionBarProps = {
  branchSlug: string
  draft: MenuDoc
  variants: MenuVariant[]
  activeVariantId: string | null
  onChanged: () => void
}

/**
 * Pick/create/rename/schedule/time-limit a named menu variant. Critically:
 * SELECTING a chip below is purely local UI state (previewing) — nothing
 * is sent, customers see nothing. ACTIVATING it (the separate "show to
 * customers" button, only shown while previewing something other than the
 * live variant) is the one action that actually goes live. This lets the
 * owner build/edit a variant quietly before committing to it. Ported
 * interaction design from AyekaBar's MenuVersionBar.
 */
export default function MenuVersionBar({ branchSlug, draft, variants, activeVariantId, onChanged }: MenuVersionBarProps) {
  const [selectedId, setSelectedId] = useState<string | null>(activeVariantId)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [tempSheetFor, setTempSheetFor] = useState<MenuVariant | null>(null)
  const [promptRequest, setPromptRequest] = useState<(PromptRequest & { variantId: string }) | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<(ConfirmRequest & { variantId: string }) | null>(null)
  const [busy, setBusy] = useState(false)

  const selected = variants.find((v) => v.id === selectedId) ?? null
  const isPreviewingNonLive = selectedId !== null && selectedId !== activeVariantId

  async function patchVariant(variantId: string, body: Record<string, unknown>) {
    setBusy(true)
    try {
      await fetch('/api/owner/menu-variants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branchSlug, variantId, ...body }),
      })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function deleteVariant(variantId: string) {
    setBusy(true)
    try {
      await fetch('/api/owner/menu-variants', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branchSlug, variantId }),
      })
      setSelectedId(activeVariantId)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6 }}>
        {variants.map((variant) => {
          const isSelected = variant.id === selectedId
          const isLive = variant.id === activeVariantId
          return (
            <button
              key={variant.id}
              type="button"
              className="press"
              onClick={() => setSelectedId(variant.id)}
              aria-pressed={isSelected}
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                minHeight: 40,
                padding: '0 14px',
                borderRadius: 999,
                border: `1px solid ${isSelected ? 'var(--neon)' : 'var(--line-strong)'}`,
                background: isSelected ? 'rgba(255,122,69,0.14)' : 'var(--bg-elev)',
                color: 'var(--text)',
                fontSize: '0.82rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              {isLive && (
                <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--neon-2)' }} />
              )}
              {localized(variant.name, 'he')}
            </button>
          )
        })}
        <button
          type="button"
          className="press"
          onClick={() => setWizardOpen(true)}
          aria-label="גרסת תפריט חדשה"
          style={{
            flexShrink: 0,
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: '1px dashed var(--line-strong)',
            background: 'transparent',
            color: 'var(--text-dim)',
            display: 'grid',
            placeItems: 'center',
            cursor: 'pointer',
          }}
        >
          <Plus size={17} aria-hidden="true" />
        </button>
      </div>

      {isPreviewingNonLive && selected && (
        <button
          type="button"
          className="press"
          disabled={busy}
          onClick={() => patchVariant(selected.id, { activate: true })}
          style={{
            marginTop: 8,
            width: '100%',
            minHeight: 'var(--tap-min)',
            borderRadius: 14,
            border: 'none',
            background: 'var(--neon)',
            color: 'var(--bg)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          הצגה ללקוחות
        </button>
      )}

      {selected && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button
            type="button"
            className="press"
            onClick={() =>
              setPromptRequest({
                variantId: selected.id,
                title: 'שינוי שם הגרסה',
                initialValue: localized(selected.name, 'he'),
                submitLabel: 'שמירה',
              })
            }
            style={iconButtonStyle}
          >
            <Pencil size={14} aria-hidden="true" /> שינוי שם
          </button>
          {!selected.is_default && (
            <>
              <button type="button" className="press" onClick={() => setTempSheetFor(selected)} style={iconButtonStyle}>
                <Timer size={14} aria-hidden="true" /> טיימר
              </button>
              <button
                type="button"
                className="press"
                onClick={() =>
                  setConfirmRequest({
                    variantId: selected.id,
                    title: 'מחיקת הגרסה?',
                    body: `למחוק את "${localized(selected.name, 'he')}"?`,
                    confirmLabel: 'מחיקה',
                    danger: true,
                  })
                }
                style={{ ...iconButtonStyle, color: '#ff6b6b' }}
              >
                <Trash2 size={14} aria-hidden="true" /> מחיקה
              </button>
            </>
          )}
        </div>
      )}

      <VariantWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        branchSlug={branchSlug}
        draft={draft}
        onCreated={(variant) => {
          setSelectedId(variant.id)
          onChanged()
        }}
      />

      <TempMenuSheet
        open={!!tempSheetFor}
        onClose={() => setTempSheetFor(null)}
        initialUntil={tempSheetFor?.active_until ?? null}
        initialExpireAction={tempSheetFor?.expire_action}
        onSave={(untilIso, expireAction) => {
          if (tempSheetFor) patchVariant(tempSheetFor.id, { tempUntil: untilIso, expireAction })
        }}
      />

      <PromptSheet
        request={promptRequest}
        onCancel={() => setPromptRequest(null)}
        onSubmit={(value) => {
          if (promptRequest) patchVariant(promptRequest.variantId, { name: { he: value } })
          setPromptRequest(null)
        }}
      />

      <ConfirmSheet
        request={confirmRequest}
        onCancel={() => setConfirmRequest(null)}
        onConfirm={() => {
          if (confirmRequest) deleteVariant(confirmRequest.variantId)
          setConfirmRequest(null)
        }}
      />
    </div>
  )
}

const iconButtonStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  minHeight: 40,
  borderRadius: 12,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  fontSize: '0.8rem',
  cursor: 'pointer',
}
