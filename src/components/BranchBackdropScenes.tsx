'use client'

import { useEffect, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'

type Scene = { portrait: string; wide: string }

const SCENES: Record<string, readonly Scene[]> = {
  maor: [1, 2, 3].map((index) => ({
    portrait: `/backdrops/maor-${index}-portrait.webp`,
    wide: `/backdrops/maor-${index}-wide.webp`,
  })),
  'givat-haviva': [1, 2, 3].map((index) => ({
    portrait: `/backdrops/givat-haviva-${index}-portrait.webp`,
    wide: `/backdrops/givat-haviva-${index}-wide.webp`,
  })),
}

const SCENE_CURSOR_KEY = 'sarcafe:public-scene:v1:'
const SCENE_INTERVAL_MS = 60_000
const EMPTY_SCENES: readonly Scene[] = []

function readNextScene(branchSlug: string, count: number): number {
  try {
    const previous = Number.parseInt(localStorage.getItem(`${SCENE_CURSOR_KEY}${branchSlug}`) ?? '-1', 10)
    return (Number.isFinite(previous) ? previous + 1 : 0) % count
  } catch {
    return 0
  }
}

function rememberScene(branchSlug: string, index: number) {
  try {
    localStorage.setItem(`${SCENE_CURSOR_KEY}${branchSlug}`, String(index))
  } catch {
    // Storage can be disabled; the scenes still rotate for this visit.
  }
}

function preloadScene(scene: Scene): Promise<void> {
  const image = new Image()
  image.src = window.matchMedia('(min-width: 900px)').matches ? scene.wide : scene.portrait
  return image.decode?.().catch(() => undefined) ?? Promise.resolve()
}

export default function BranchBackdropScenes({ branchSlug }: { branchSlug: string }) {
  const scenes = SCENES[branchSlug] ?? EMPTY_SCENES
  const rootRef = useRef<HTMLDivElement>(null)
  const initializedBranch = useRef<string | null>(null)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [outgoingIndex, setOutgoingIndex] = useState<number | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (scenes.length === 0 || initializedBranch.current === branchSlug) return
    initializedBranch.current = branchSlug
    const next = readNextScene(branchSlug, scenes.length)
    setActiveIndex(next)
    setOutgoingIndex(null)
    rememberScene(branchSlug, next)
  }, [branchSlug, scenes])

  useEffect(() => {
    if (activeIndex === null || scenes.length < 2 || reducedMotion) return
    let cancelled = false
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      const next = (activeIndex + 1) % scenes.length
      await preloadScene(scenes[next]!)
      if (cancelled) return
      setOutgoingIndex(activeIndex)
      setActiveIndex(next)
      rememberScene(branchSlug, next)
    }, SCENE_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeIndex, branchSlug, reducedMotion, scenes])

  useGSAP(
    () => {
      const active = rootRef.current?.querySelector<HTMLElement>('[data-scene-state="active"]')
      const outgoing = rootRef.current?.querySelector<HTMLElement>('[data-scene-state="outgoing"]')
      if (!active) return
      if (!outgoing || reducedMotion) {
        gsap.set(active, { autoAlpha: 1 })
        if (outgoing) {
          gsap.set(outgoing, { autoAlpha: 0 })
          setOutgoingIndex(null)
        }
        return
      }
      const timeline = gsap.timeline({ defaults: { duration: 4, ease: 'power2.inOut' }, onComplete: () => setOutgoingIndex(null) })
      timeline.to(active, { autoAlpha: 1 }, 0)
    },
    { scope: rootRef, dependencies: [activeIndex, outgoingIndex, reducedMotion], revertOnUpdate: true }
  )

  const visibleScenes = scenes.length && activeIndex !== null
    ? [
        ...(outgoingIndex === null ? [] : [{ index: outgoingIndex, state: 'outgoing' as const }]),
        { index: activeIndex, state: 'active' as const },
      ]
    : []

  if (visibleScenes.length === 0) return null
  return (
    <div ref={rootRef} className="public-backdrop__scenes" aria-hidden="true">
      {visibleScenes.map(({ index, state }) => {
        const scene = scenes[index]!
        return (
          <picture
            key={`${branchSlug}-${index}`}
            data-scene-state={state}
            className="public-backdrop__scene"
            style={{ opacity: state === 'active' && outgoingIndex !== null ? 0 : 1 }}
          >
            <source media="(min-width: 900px)" srcSet={scene.wide} />
            <img src={scene.portrait} alt="" decoding="async" />
          </picture>
        )
      })}
      <div className="public-backdrop__shade" />
    </div>
  )
}
