// Changing the look of the app, with some ceremony (owner, 2026-10-17: "professional, colour changes and everything changes, with animations
// and great effects", then "a bit smoother and nicer"). Browser-only. The change is one soft-edged bloom that reveals the new look from where
// the person tapped (a view transition: the old look is a still picture that sinks back a little, the new one is live under a growing,
// feathered mask and settles from a hair too big), two rings that ride the edge of the bloom, a burst of shapes that belongs to the look
// being chosen (sparks, bokeh, ticket confetti, coffee beans, hearts), and the cards settling in one after another. Browsers without
// view transitions get the same idea as a colour cross-fade (class `theme-anim`). A person who asked their phone for less motion gets
// an instant change, nothing else.
//
// All the keyframes live in staff-themes.css inside `prefers-reduced-motion: no-preference`; the timing here (REVEAL_MS, EASE) and there
// must be the same number, so the rings stay on the edge of the bloom. Nothing here decides WHICH look: the caller does, and saves it.

import { isStaffTheme, type StaffTheme } from '@/lib/staff/theme'

export type Origin = { x: number; y: number }

/** Puts the look on <html> (sheets and menus portal to <body>) and on the staff wrapper (which the server also draws, so no flash). */
export function applyTheme(theme: string) {
  if (!isStaffTheme(theme)) return
  document.documentElement.dataset.staffTheme = theme
  document.querySelector('.native-app[data-staff-theme]')?.setAttribute('data-staff-theme', theme)
}

/** The bloom, in milliseconds, and its curve: slow to start (so it is seen starting), quick through the middle, long and soft at the end. */
export const REVEAL_MS = 980
export const EASE = 'cubic-bezier(0.55, 0.05, 0.2, 1)'

const prefersLess = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
/** @property (animatable custom properties) is what makes the feathered edge possible; without it the bloom has a hard edge. */
const canFeather = () => typeof CSS !== 'undefined' && typeof (CSS as unknown as { registerProperty?: unknown }).registerProperty === 'function'

type ViewTransitionLike = { ready: Promise<void>; finished: Promise<void> }
type StartViewTransition = (update: () => void) => ViewTransitionLike

// ---- the burst: one small drawing per look ---------------------------------------------------------------------------------------

const SHAPES = {
  spark: (c: string) => `<svg viewBox="0 0 24 24"><path fill="${c}" d="M12 1.5 14.7 9.3 22.5 12 14.7 14.7 12 22.5 9.3 14.7 1.5 12 9.3 9.3Z"/></svg>`,
  heart: (c: string) => `<svg viewBox="0 0 24 24"><path fill="${c}" d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`,
  bean: (c: string) => `<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="6.5" ry="9.5" fill="${c}" transform="rotate(28 12 12)"/><path d="M10 4.5c5 4-5 11 0 15" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.6" stroke-linecap="round" transform="rotate(28 12 12)"/></svg>`,
  ticket: (c: string) => `<svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="1.5" fill="${c}"/></svg>`,
  bokeh: (c: string) => `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="${c}"/></svg>`,
} as const

type Recipe = { shape: keyof typeof SHAPES; count: number; size: [number, number]; reach: [number, number]; rise: number; spin: number; ms: [number, number]; ring: { width: number; style: 'solid' | 'dashed' } }
const RECIPES: Record<StaffTheme, Recipe> = {
  neon: { shape: 'spark', count: 16, size: [10, 26], reach: [70, 190], rise: 0, spin: 90, ms: [1000, 1500], ring: { width: 3, style: 'solid' } },
  glass: { shape: 'bokeh', count: 12, size: [18, 44], reach: [50, 150], rise: -40, spin: 0, ms: [1300, 1900], ring: { width: 2, style: 'solid' } },
  pass: { shape: 'ticket', count: 18, size: [8, 14], reach: [90, 220], rise: 0, spin: 540, ms: [1000, 1400], ring: { width: 2, style: 'dashed' } },
  crema: { shape: 'bean', count: 13, size: [16, 28], reach: [70, 190], rise: 30, spin: 240, ms: [1050, 1500], ring: { width: 4, style: 'solid' } },
  latte: { shape: 'heart', count: 15, size: [14, 30], reach: [50, 160], rise: -110, spin: 28, ms: [1300, 2000], ring: { width: 3, style: 'solid' } },
}

const between = (a: number, b: number) => a + Math.random() * (b - a)

/** Two rings that ride the edge of the bloom, and the look's own burst. Everything is removed when it is over. */
function playEffects(theme: StaffTheme, origin: Origin, ringRadius: number) {
  const recipe = RECIPES[theme]
  const css = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  const palette = [token('--neon', '#ff7a45'), token('--neon-soft', '#ffab7a'), token('--neon-2', '#57d9c0'), theme === 'crema' ? '#26150d' : token('--text', '#fff')]
  const layer = document.createElement('div')
  layer.setAttribute('aria-hidden', 'true')
  layer.id = 'theme-fx'
  Object.assign(layer.style, { position: 'fixed', inset: '0', zIndex: '2147483000', pointerEvents: 'none', overflow: 'hidden', viewTransitionName: 'theme-fx' })
  document.body.appendChild(layer)

  const diameter = ringRadius * 2
  const rings: { width: number; delay: number; peak: number }[] = [{ width: recipe.ring.width, delay: 0, peak: 0.9 }, { width: Math.max(1, recipe.ring.width - 1), delay: 140, peak: 0.4 }]
  for (const spec of rings) {
    const ring = document.createElement('div')
    Object.assign(ring.style, {
      position: 'absolute', left: `${origin.x - ringRadius}px`, top: `${origin.y - ringRadius}px`, width: `${diameter}px`, height: `${diameter}px`, borderRadius: '50%',
      border: `${spec.width}px ${recipe.ring.style} ${palette[0]}`, boxShadow: `0 0 40px ${palette[0]}, inset 0 0 40px ${palette[0]}`, opacity: '0', willChange: 'transform, opacity',
    })
    layer.appendChild(ring)
    ring.animate(
      [{ transform: 'scale(0.02)', opacity: 0 }, { transform: 'scale(0.12)', opacity: spec.peak, offset: 0.1 }, { transform: 'scale(0.94)', opacity: spec.peak * 0.5, offset: 0.82 }, { transform: 'scale(1)', opacity: 0 }],
      { duration: REVEAL_MS, delay: spec.delay, easing: EASE, fill: 'both' },
    )
  }

  for (let i = 0; i < recipe.count; i += 1) {
    const size = between(recipe.size[0], recipe.size[1])
    const angle = (Math.PI * 2 * i) / recipe.count + between(-0.35, 0.35)
    const reach = between(recipe.reach[0], recipe.reach[1])
    const dx = Math.cos(angle) * reach
    const dy = Math.sin(angle) * reach + recipe.rise
    const spin = between(-recipe.spin, recipe.spin)
    const el = document.createElement('div')
    el.innerHTML = SHAPES[recipe.shape](palette[i % palette.length]!)
    Object.assign(el.style, { position: 'absolute', left: `${origin.x - size / 2}px`, top: `${origin.y - size / 2}px`, width: `${size}px`, height: `${size}px`, opacity: '0', willChange: 'transform, opacity' })
    if (theme === 'glass') el.style.filter = 'blur(1.5px)'
    layer.appendChild(el)
    const sway = theme === 'latte' ? between(-26, 26) : 0
    el.animate(
      [
        { transform: 'translate(0, 0) scale(0.2) rotate(0deg)', opacity: 0 },
        { transform: `translate(${dx * 0.5 + sway}px, ${dy * 0.5}px) scale(1) rotate(${spin * 0.5}deg)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${dx + sway * 0.4}px, ${dy}px) scale(0.7) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: between(recipe.ms[0], recipe.ms[1]), delay: between(0, 220), easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' },
    )
  }
  window.setTimeout(() => layer.remove(), 2600)
}

/** The cards of the page settle in one after another, so the new look arrives as a whole screen and not as a recolour. */
function settleContent() {
  const items = Array.from(document.querySelectorAll<HTMLElement>('.app-page > *')).filter((el) => !el.classList.contains('app-header') && !el.classList.contains('app-header__spacer') && el.tagName !== 'STYLE').slice(0, 12)
  items.forEach((el, index) => {
    el.animate([{ opacity: 0.2, transform: 'translateY(26px) scale(0.985)' }, { opacity: 1, transform: 'none' }], { duration: 760, delay: 200 + index * 60, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' })
  })
}

/** Changes the look with the full ceremony. `origin` is where the person tapped (the viewport centre when unknown). `onApply` runs at the
 *  moment the new look is applied (inside the transition, after the old picture was taken), so the caller's own state changes with it. */
export function transitionTheme(next: StaffTheme, origin?: Origin | null, onApply?: () => void): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (root.dataset.staffTheme === next) { onApply?.(); return }
  if (prefersLess()) { applyTheme(next); onApply?.(); return }

  const w = window.innerWidth
  const h = window.innerHeight
  const o = origin ?? { x: w / 2, y: h / 2 }
  const radius = Math.hypot(Math.max(o.x, w - o.x), Math.max(o.y, h - o.y))
  const feather = Math.round(Math.min(280, Math.max(96, radius * 0.24)))
  const update = () => { applyTheme(next); onApply?.(); playEffects(next, o, radius + feather * 0.5); settleContent() }
  const start = (document as unknown as { startViewTransition?: StartViewTransition }).startViewTransition

  if (typeof start === 'function') {
    root.style.setProperty('--vt-x', `${o.x}px`)
    root.style.setProperty('--vt-y', `${o.y}px`)
    root.style.setProperty('--vt-r', `${radius}px`)
    root.style.setProperty('--vt-feather', `${feather}px`)
    root.style.setProperty('--vt-reach', `${radius + feather}px`)
    root.dataset.themeVt = canFeather() ? 'soft' : 'hard'
    const clear = () => {
      delete root.dataset.themeVt
      for (const name of ['--vt-x', '--vt-y', '--vt-r', '--vt-feather', '--vt-reach']) root.style.removeProperty(name)
    }
    try {
      const transition = start.call(document, update)
      transition.finished.then(clear, clear)
    } catch {
      clear()
      applyTheme(next)
      onApply?.()
    }
    return
  }

  // No view transitions: every colour glides to its new value, while the rings and the burst play on top.
  root.classList.add('theme-anim')
  update()
  window.setTimeout(() => root.classList.remove('theme-anim'), 1000)
}
