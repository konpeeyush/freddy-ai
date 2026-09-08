/**
 * Shared motion tokens.
 *
 * One place so every animation across the chatbot and dashboard shares a
 * feel — springs that differ by a few points read as inconsistency rather
 * than variety.
 */

/** Decelerating curve for entrances. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const

/** Tap feedback: stiff and heavily damped, so it settles without wobble. */
export const SPRING_PRESS = {
  type: "spring",
  stiffness: 520,
  damping: 32,
  mass: 0.6,
} as const

/** Swapping one element for another — icon changes, rotations. */
export const SPRING_SWAP = {
  type: "spring",
  stiffness: 380,
  damping: 30,
  mass: 0.8,
} as const

/** Reflowing siblings around an item entering, leaving, or reordering. */
export const SPRING_LAYOUT = {
  type: "spring",
  stiffness: 420,
  damping: 38,
  mass: 0.7,
} as const

/**
 * Growing or collapsing a box everything below has to move around.
 *
 * `bounce: 0` deliberately, unlike the springs above. Overshoot on a *height*
 * is not read as spring: every element underneath overshoots with it and then
 * comes back, which looks like the layout settling from a mistake rather than
 * like the panel opening.
 */
export const SPRING_DISCLOSURE = {
  type: "spring",
  duration: 0.42,
  bounce: 0,
} as const
