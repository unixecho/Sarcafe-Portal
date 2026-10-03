// Gesture classification for the selling-point screen. Pure — no DOM, no React — so the
// thresholds live in one place and check-pos.mjs can pin them.
//
// Two gestures exist on that screen and they must never be confused with each other, with
// scrolling, or with a tap:
//
//   1. a deliberate LEFT SWIPE on the screen BACKGROUND -> "go to the timeline?"
//   2. a LONG-PRESS-AND-DRAG on a card toward the left edge -> reveal / use the Done tray
//
// "Left" is PHYSICAL in both (like every pinned widget it does not flip with RTL): a
// tablet is held the same way in Hebrew and in English, and the tray lives on the same edge.
//
// The swipe is deliberately hard to do by accident. A staff member scrolls a long queue
// with a wet thumb; a sloppy diagonal flick that happens to drift left must NOT open a
// confirmation. So it needs real distance, a mostly-horizontal line, a brisk stroke, a
// start on empty background (never on a card or a control — card interactions can never
// trigger it) and a start that is not at the very edge, where an OS back-gesture already
// lives and would otherwise fire twice.

export type SwipeInput = {
  startX: number
  startY: number
  endX: number
  endY: number
  startedAtMs: number
  endedAtMs: number
  viewportWidth: number
  /** the press began on a card, a button, a link, an input — anything that is not bare background */
  startedOnInteractive: boolean
}

export type SwipeResult = 'swipe-left' | 'none'

/** Never fewer than this many px, however narrow the screen... */
const SWIPE_MIN_PX = 96
/** ...and on a wide tablet, at least this share of the width, so a short flick is not enough. */
const SWIPE_MIN_FRACTION = 0.22
/** |dx| must be at least this many times |dy|: a mostly-horizontal line, not a diagonal scroll. */
const SWIPE_HORIZONTAL_RATIO = 2.2
const SWIPE_MAX_MS = 800
/** A press that starts this close to the physical left edge belongs to the OS back-gesture. */
const SWIPE_EDGE_DEAD_PX = 12

export function classifySwipe(input: SwipeInput): SwipeResult {
  const { startX, startY, endX, endY, startedAtMs, endedAtMs, viewportWidth, startedOnInteractive } = input
  if (startedOnInteractive) return 'none'
  const nums = [startX, startY, endX, endY, startedAtMs, endedAtMs, viewportWidth]
  if (!nums.every((n) => Number.isFinite(n))) return 'none'
  if (startX < SWIPE_EDGE_DEAD_PX) return 'none'
  const elapsed = endedAtMs - startedAtMs
  if (elapsed < 0 || elapsed >= SWIPE_MAX_MS) return 'none'
  const dx = endX - startX
  const dy = endY - startY
  if (dx >= 0) return 'none' // only leftward
  const distance = -dx
  const needed = Math.max(SWIPE_MIN_PX, SWIPE_MIN_FRACTION * Math.max(0, viewportWidth))
  if (distance < needed) return 'none'
  if (distance < SWIPE_HORIZONTAL_RATIO * Math.abs(dy)) return 'none'
  return 'swipe-left'
}

export type DragInput = {
  /** how long the finger/pointer has been down */
  pressedForMs: number
  /** the pointer's x, in viewport coordinates from the PHYSICAL left */
  x: number
  viewportWidth: number
}

export type DragResult = {
  /** the long-press has been held long enough that moving now drags the card instead of scrolling */
  armed: boolean
  /** close enough to the physical left edge that the Done tray should slide in */
  nearLeftEdge: boolean
}

const DRAG_ARM_MS = 350
const DRAG_EDGE_PX = 88

export function classifyDrag(input: DragInput): DragResult {
  const { pressedForMs, x, viewportWidth } = input
  const armed = Number.isFinite(pressedForMs) && pressedForMs >= DRAG_ARM_MS
  // x is checked against a real, positive viewport so a bogus measurement never reads as "at the edge".
  const nearLeftEdge = Number.isFinite(x) && Number.isFinite(viewportWidth) && viewportWidth > 0 && x <= DRAG_EDGE_PX
  return { armed, nearLeftEdge }
}
