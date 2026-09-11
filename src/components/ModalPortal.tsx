'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Portals children to document.body. Every overlay (sheets, dialogs,
 * wizards, the a11y widget) renders through this, never in-tree — a
 * `position: fixed` element only anchors to the viewport when NO ancestor
 * has an active transform/filter/perspective, and the page-transition
 * system applies transforms to page containers. Fixed *page chrome* (a
 * save bar, a language switch) deliberately stays in-tree instead, since it
 * should travel with the page during transitions rather than float free of
 * it. Ported from AyekaBar.
 */
export default function ModalPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null
  return createPortal(children, document.body)
}
