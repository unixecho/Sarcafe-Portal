'use client'

import { useCallback, useEffect, useState } from 'react'
import { Package, HelpCircle, Save, Send, Sparkles, ChevronDown } from 'lucide-react'
import MenuVersionBar from '@/components/MenuVersionBar'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import CategoryAccordion from '@/components/CategoryAccordion'
import MenuOnboardingWizard from '@/components/MenuOnboardingWizard'
import { ensureUids } from '@/lib/menu/variants'
import { randomId } from '@/lib/menu/id'
import type { MenuCategory, MenuDoc, MenuItem, MenuVariant } from '@/lib/menu/types'

type LoadedMenu = { menuId: string; activeVariantId: string | null; draft: MenuDoc; variants: MenuVariant[] }

const ONBOARDING_SEEN_PREFIX = 'sarcafe:onboarding-seen:'

function normalizePrice(value: unknown): number | string {
  const text = String(value ?? '').trim()
  if (text === '') return 0
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text)
  return text // e.g. "20/24" range — kept as a literal string
}

export default function MenuEditor({ branchSlug, branchLabel }: { branchSlug: string; branchLabel: string }) {
  const [loaded, setLoaded] = useState<LoadedMenu | null>(null)
  const [draft, setDraft] = useState<MenuDoc | null>(null)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [confirmRequest, setConfirmRequest] = useState<(ConfirmRequest & { onYes: () => void }) | null>(null)
  const [showOutOfStock, setShowOutOfStock] = useState(false)
  const [openCategoryIds, setOpenCategoryIds] = useState<Set<string>>(new Set())
  const [onboardingOpen, setOnboardingOpen] = useState(false)

  const onboardingKey = ONBOARDING_SEEN_PREFIX + branchSlug

  const load = useCallback(async () => {
    const res = await fetch(`/api/owner/menu-variants?branch=${branchSlug}`)
    if (!res.ok) return
    const payload = (await res.json()) as LoadedMenu
    const withUids = ensureUids(payload.draft)
    setLoaded({ ...payload, draft: withUids })
    setDraft(withUids)
    setDirty(false)
    setOpenCategoryIds(new Set(withUids.categories[0] ? [withUids.categories[0].id] : []))

    if (withUids.categories.length === 0 && !window.localStorage.getItem(onboardingKey)) {
      setOnboardingOpen(true)
    }
    // onboardingKey is derived from branchSlug, stable for the component's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchSlug])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  function edit(mutate: (doc: MenuDoc) => void) {
    setDraft((prev) => {
      if (!prev) return prev
      const next: MenuDoc = structuredClone(prev)
      mutate(next)
      return next
    })
    setDirty(true)
  }

  function flash(message: string, isError = false) {
    setStatus(isError ? 'error' : 'saved')
    setStatusMessage(message)
    window.setTimeout(() => setStatus('idle'), 1800)
  }

  // Normalizes free-typed prices ("30" -> 30, "30/34" kept as a literal
  // range string) into a fresh copy — never mutates the live draft, so
  // editing can continue with the raw typed values still in the inputs.
  function buildPayload(source: MenuDoc): MenuDoc {
    return {
      categories: source.categories.map((category) => ({
        ...category,
        items: category.items.map((item) => ({ ...item, price: normalizePrice(item.price) })),
      })),
    }
  }

  // Both Save and Publish now go through this one server route (instead of
  // writing to Supabase directly from the browser) so each explicit click
  // can be logged to menu_audit — service-role only, unreachable from a
  // direct browser write. The actual RLS/auth semantics are unchanged: the
  // route runs the mutation as the caller's own session, just adds the
  // audit insert alongside it.
  async function saveDoc(doc: MenuDoc, action: 'save' | 'publish'): Promise<boolean> {
    if (!loaded) return false
    setStatus('saving')
    const res = await fetch('/api/owner/menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: branchSlug, action, draft: doc }),
    })
    if (!res.ok) {
      const payload = await res.json().catch(() => null)
      const message = payload?.error?.message ?? 'שגיאה לא צפויה'
      flash((action === 'publish' ? 'שגיאה בפרסום: ' : 'שגיאה בשמירה: ') + message, true)
      return false
    }
    setDirty(false)
    return true
  }

  async function save() {
    if (!draft) return
    const ok = await saveDoc(buildPayload(draft), 'save')
    if (ok) flash('נשמר ✓')
  }

  async function publish() {
    if (!loaded || !draft) return
    const payload = buildPayload(draft)
    const ok = await saveDoc(payload, 'publish')
    if (!ok) return
    setDraft(payload)
    flash('פורסם ללקוחות ✓')
  }

  function toggleCategory(id: string) {
    setOpenCategoryIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function addCategory() {
    const id = randomId('c')
    edit((doc) => {
      doc.categories.push({ id, icon: 'utensils', title: { he: '', en: '', ar: '' }, items: [] })
    })
    setOpenCategoryIds((prev) => new Set(prev).add(id))
  }

  function deleteCategory(index: number) {
    const category = draft?.categories[index]
    setConfirmRequest({
      title: 'מחיקת קטגוריה?',
      body: category?.title.he ? `"${category.title.he}" וכל הפריטים בתוכה יימחקו.` : 'כל הפריטים בקטגוריה יימחקו יחד איתה.',
      confirmLabel: 'מחיקה',
      danger: true,
      onYes: () => edit((doc) => void doc.categories.splice(index, 1)),
    })
  }

  function moveCategory(index: number, direction: -1 | 1) {
    edit((doc) => {
      const target = index + direction
      if (target < 0 || target >= doc.categories.length) return
      const list = doc.categories
      const tmp = list[index]!
      list[index] = list[target]!
      list[target] = tmp
    })
  }

  function addItem(categoryIndex: number) {
    edit((doc) => {
      doc.categories[categoryIndex]?.items.push({ uid: randomId('i'), he: '', en: '', ar: '', price: '' })
    })
  }

  function requestDeleteItem(categoryIndex: number, itemIndex: number, itemLabel: string) {
    setConfirmRequest({
      title: 'מחיקת פריט?',
      body: `"${itemLabel}" יימחק מהתפריט.`,
      confirmLabel: 'מחיקה',
      danger: true,
      onYes: () => edit((doc) => void doc.categories[categoryIndex]?.items.splice(itemIndex, 1)),
    })
  }

  function moveItem(categoryIndex: number, index: number, direction: -1 | 1) {
    edit((doc) => {
      const items = doc.categories[categoryIndex]?.items
      if (!items) return
      const target = index + direction
      if (target < 0 || target >= items.length) return
      const tmp = items[index]!
      items[index] = items[target]!
      items[target] = tmp
    })
  }

  function returnToStock(itemUid: string, typeUid?: string) {
    edit((doc) => {
      for (const category of doc.categories) {
        const item = category.items.find((i) => i.uid === itemUid)
        if (!item) continue
        if (typeUid) {
          const type = item.types?.find((t) => t.uid === typeUid)
          if (type) type.available = true
        } else {
          item.available = true
        }
      }
    })
  }

  function closeOnboarding() {
    window.localStorage.setItem(onboardingKey, '1')
    setOnboardingOpen(false)
  }

  function completeOnboarding(category: MenuCategory) {
    edit((doc) => {
      doc.categories.push(category)
    })
    setOpenCategoryIds((prev) => new Set(prev).add(category.id))
    closeOnboarding()
  }

  if (!loaded || !draft) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="sk" style={{ height: 120 }} />
        ))}
      </div>
    )
  }

  // Item-level AND type-level out-of-stock rows, flattened into one rollup —
  // a type row's label includes its parent item's name since "שוקולד" alone
  // means nothing out of context.
  const outOfStock = draft.categories.flatMap((c) =>
    c.items.flatMap((item) => {
      const rows: { key: string; label: string; itemUid: string; typeUid?: string }[] = []
      if (item.available === false && item.uid) {
        rows.push({ key: item.uid, label: item.he || 'פריט', itemUid: item.uid })
      }
      for (const type of item.types ?? []) {
        if (type.available === false && item.uid) {
          rows.push({
            key: `${item.uid}-${type.uid}`,
            label: `${item.he || 'פריט'} — ${type.he || 'סוג'}`,
            itemUid: item.uid,
            typeUid: type.uid,
          })
        }
      }
      return rows
    })
  )

  return (
    <div style={{ paddingBottom: 88 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -4 }}>
        <button
          type="button"
          className="press"
          onClick={() => setOnboardingOpen(true)}
          aria-label="איך זה עובד"
          title="איך זה עובד"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: 'none',
            border: 'none',
            color: 'var(--text-faint)',
            fontSize: '0.78rem',
            cursor: 'pointer',
            padding: '6px 2px',
          }}
        >
          <HelpCircle size={15} aria-hidden="true" /> איך זה עובד
        </button>
      </div>

      <MenuVersionBar
        branchSlug={branchSlug}
        draft={draft}
        variants={loaded.variants}
        activeVariantId={loaded.activeVariantId}
        onChanged={load}
      />

      <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', margin: '0 0 16px' }}>
        עריכת התפריט של {branchLabel}. השינויים נשמרים כטיוטה — לחיצה על &quot;פרסום&quot; היא מה שהלקוחות רואים בפועל.
      </p>

      {outOfStock.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <button
            type="button"
            className="press"
            onClick={() => setShowOutOfStock((v) => !v)}
            aria-expanded={showOutOfStock}
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              background: 'var(--bg-elev)',
              border: '1px solid var(--line-strong)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Package size={17} aria-hidden="true" /> {outOfStock.length} פריטים אזלו מהמלאי
            </span>
            <ChevronDown
              size={16}
              aria-hidden="true"
              style={{ transform: showOutOfStock ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s var(--ease)' }}
            />
          </button>
          {showOutOfStock && (
            <div className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {outOfStock.map((row) => (
                <div
                  key={row.key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: 'var(--bg-elev)',
                  }}
                >
                  <span style={{ fontSize: '0.85rem' }}>{row.label}</span>
                  <button
                    type="button"
                    className="press"
                    onClick={() => returnToStock(row.itemUid, row.typeUid)}
                    style={{
                      minHeight: 36,
                      padding: '0 12px',
                      borderRadius: 999,
                      border: 'none',
                      background: 'var(--neon)',
                      color: 'var(--bg)',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    החזרה למלאי
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {draft.categories.length === 0 ? (
        <div
          className="rise"
          style={{
            textAlign: 'center',
            padding: '40px 20px',
            borderRadius: 'var(--radius-lg)',
            border: '1px dashed var(--line-strong)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: 'rgba(255,122,69,0.14)',
              color: 'var(--neon)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Sparkles size={22} strokeWidth={2} />
          </span>
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>התפריט עדיין ריק</h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-dim)', maxWidth: 260 }}>
            נבנה יחד את הקטגוריה והפריט הראשונים — זה לוקח פחות מדקה.
          </p>
          <button type="button" className="press" onClick={() => setOnboardingOpen(true)} style={primaryButtonStyle}>
            יצירת קטגוריה ראשונה
          </button>
        </div>
      ) : (
        draft.categories.map((category, categoryIndex) => (
          <CategoryAccordion
            key={category.id}
            category={category}
            index={categoryIndex}
            total={draft.categories.length}
            open={openCategoryIds.has(category.id)}
            onToggle={() => toggleCategory(category.id)}
            onMoveCategory={(dir) => moveCategory(categoryIndex, dir)}
            onDeleteCategory={() => deleteCategory(categoryIndex)}
            onEditCategoryField={(field, value) =>
              edit((doc) => {
                const cat = doc.categories[categoryIndex]
                if (!cat) return
                if (field === 'icon') cat.icon = value
                else cat.title[field] = value
              })
            }
            onToggleLiveOnTablet={() =>
              edit((doc) => {
                const cat = doc.categories[categoryIndex]
                if (cat) cat.liveOnTablet = cat.liveOnTablet !== true
              })
            }
            onAddItem={() => addItem(categoryIndex)}
            onMoveItem={(itemIndex, dir) => moveItem(categoryIndex, itemIndex, dir)}
            onRequestDeleteItem={(itemIndex, itemLabel) => requestDeleteItem(categoryIndex, itemIndex, itemLabel)}
            onEditItem={(itemIndex, patch) =>
              edit((doc) => {
                const target = doc.categories[categoryIndex]?.items[itemIndex]
                if (target) Object.assign(target, patch)
              })
            }
          />
        ))
      )}

      {draft.categories.length > 0 && (
        <button type="button" className="press" onClick={addCategory} style={dashedAddCategoryStyle}>
          + הוספת קטגוריה
        </button>
      )}

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 0',
          background: 'linear-gradient(0deg, var(--bg) 60%, transparent)',
        }}
      >
        <span
          role="status"
          style={{
            fontSize: '0.8rem',
            color: status === 'error' ? '#ff6b6b' : dirty ? 'var(--neon-soft)' : 'var(--text-faint)',
          }}
        >
          {status === 'saving' ? 'שומר…' : status !== 'idle' ? statusMessage : dirty ? 'יש שינויים שלא נשמרו' : 'נשמר'}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="press" onClick={save} style={saveButtonStyle}>
          <Save size={16} aria-hidden="true" /> שמירת טיוטה
        </button>
        <button type="button" className="press" onClick={publish} style={publishButtonStyle}>
          <Send size={16} aria-hidden="true" /> פרסום
        </button>
      </div>

      <ConfirmSheet
        request={confirmRequest}
        onCancel={() => setConfirmRequest(null)}
        onConfirm={() => {
          confirmRequest?.onYes()
          setConfirmRequest(null)
        }}
      />

      <MenuOnboardingWizard
        open={onboardingOpen}
        branchLabel={branchLabel}
        onSkip={closeOnboarding}
        onComplete={completeOnboarding}
      />
    </div>
  )
}

const primaryButtonStyle: React.CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '0 20px',
  borderRadius: 999,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontWeight: 700,
  fontSize: '0.9rem',
  cursor: 'pointer',
}

const dashedAddCategoryStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 'var(--tap-min)',
  borderRadius: 'var(--radius-md)',
  border: '1px dashed var(--line-strong)',
  background: 'transparent',
  color: 'var(--text-dim)',
  fontWeight: 600,
  cursor: 'pointer',
  marginBottom: 24,
}

const saveButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 'var(--tap-min)',
  padding: '0 16px',
  borderRadius: 999,
  border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  fontWeight: 600,
  fontSize: '0.85rem',
  cursor: 'pointer',
}

const publishButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 'var(--tap-min)',
  padding: '0 18px',
  borderRadius: 999,
  border: 'none',
  background: 'var(--neon)',
  color: 'var(--bg)',
  fontWeight: 700,
  fontSize: '0.85rem',
  cursor: 'pointer',
}
