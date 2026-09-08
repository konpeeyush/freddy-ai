/*
 * The placeholder's geometry and pacing.
 *
 * Split from the component because it is pure arithmetic with no React in it,
 * which is what lets it be tested at all — the drawing itself is a canvas
 * loop this package cannot exercise without a DOM.
 */

/** Leaves in the subdivision. Enough to read as detail, few enough to be cheap. */
export const CELLS = 90

/** Cells already apart on the first frame, so it never starts as one blank rect. */
const OPENING_CELLS = 4

/*
 * Where an unresolved run holds.
 *
 * Short of the end on purpose: the grid must never look finished while the
 * tool is still running, or the visitor reads a settled frame as the answer
 * and waits for something that has already "arrived".
 */
export const WAIT_CAP = 0.72

/** How far the last split sits, leaving room for the settle after it. */
export const LAST_SPLIT = 0.92

/** How long one cell takes to separate, in progress units. */
export const MORPH = 0.055

/** Sampling square for image colours. Small — these are per-cell averages. */
export const SAMPLE = 96

/** Fade from grey to the image's own colours. */
export const COLOR_MS = 420

/*
 * Gutters open early and close as the grid resolves, so the cells read as
 * separating rather than as a static mosaic.
 */
export const GUTTER_FROM = 0.35
export const GUTTER_TO = 0.75

/** The photo only starts showing once the grid is essentially done. */
export const PHOTO_FROM = 0.93

export type Cell = {
  x: number
  y: number
  w: number
  h: number
  r: number
  g: number
  b: number
  tone: number
  detail: number
  splitAt: number
  parent: Cell | null
  kids: [Cell, Cell] | null
}

// Written as comparisons so NaN falls through to 0 rather than propagating.
export const clamp01 = (n: number) => (n > 0 ? (n < 1 ? n : 1) : 0)
export const mix = (a: number, b: number, t: number) => a + (b - a) * t
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

export function smoothstep(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/**
 * Progress with no number behind it.
 *
 * Never reaches its ceiling, so a tool that outruns the estimate keeps
 * creeping rather than stalling at a full-looking bar — which is the one
 * thing a fake progress indicator must not do.
 */
export function selfPaced(elapsedMs: number, durationMs: number) {
  const span = durationMs > 0 ? durationMs : 1
  return WAIT_CAP * (1 - Math.exp(-elapsedMs / span))
}

export function hash(x: number, y: number, z: number) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return n - Math.floor(n)
}

export function makeCell(
  x: number,
  y: number,
  w: number,
  h: number,
  parent: Cell | null
): Cell {
  return {
    x,
    y,
    w,
    h,
    r: 0,
    g: 0,
    b: 0,
    tone: hash(x + 3.1, y + 1.7, w * 31.7),
    detail: 0,
    splitAt: 0,
    parent,
    kids: null,
  }
}

/*
 * Splitting the largest cell each time keeps cells roughly square and the
 * count rising one at a time, which is what makes the subdivision read as
 * deliberate rather than as random noise appearing.
 */
export function buildTree(aspect: number) {
  const root = makeCell(0, 0, 1, 1, null)
  const leaves: Cell[] = [root]
  const branches: Cell[] = []

  while (leaves.length < CELLS) {
    let pick = 0
    let widest = -1
    for (let i = 0; i < leaves.length; i += 1) {
      const cell = leaves[i]
      // The jitter only breaks ties between cells of equal size.
      const area = cell.w * aspect * cell.h * (1 + 0.12 * hash(cell.x, cell.y, 7.3))
      if (area > widest) {
        widest = area
        pick = i
      }
    }

    const parent = leaves.splice(pick, 1)[0]
    const wide = parent.w * aspect >= parent.h
    const half = wide ? parent.w / 2 : parent.h / 2
    const a = wide
      ? makeCell(parent.x, parent.y, half, parent.h, parent)
      : makeCell(parent.x, parent.y, parent.w, half, parent)
    const b = wide
      ? makeCell(parent.x + half, parent.y, half, parent.h, parent)
      : makeCell(parent.x, parent.y + half, parent.w, half, parent)

    parent.kids = [a, b]
    branches.push(parent)
    leaves.push(a, b)
  }

  const opening = OPENING_CELLS - 1
  const rest = Math.max(1, branches.length - opening)
  // The opening splits sit before zero, so those cells are already apart on
  // the first frame and the grid never appears as one blank rectangle.
  branches.forEach((cell, i) => {
    cell.splitAt = i < opening ? -MORPH : (LAST_SPLIT * (i - opening + 1)) / rest
  })

  return { root, branches }
}

export type Sums = { n: number; r: number; g: number; b: number; l: number; l2: number }

/** Average colour per cell, plus the luminance spread that orders the splits. */
export function measureTree(root: Cell, pixels: Uint8ClampedArray, size: number) {
  const gather = (cell: Cell): Sums => {
    let s: Sums

    if (cell.kids) {
      const a = gather(cell.kids[0])
      const b = gather(cell.kids[1])
      s = {
        n: a.n + b.n,
        r: a.r + b.r,
        g: a.g + b.g,
        b: a.b + b.b,
        l: a.l + b.l,
        l2: a.l2 + b.l2,
      }
    } else {
      s = { n: 0, r: 0, g: 0, b: 0, l: 0, l2: 0 }
      const x0 = Math.round(cell.x * size)
      const y0 = Math.round(cell.y * size)
      const x1 = Math.max(x0 + 1, Math.round((cell.x + cell.w) * size))
      const y1 = Math.max(y0 + 1, Math.round((cell.y + cell.h) * size))

      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * size + x) * 4
          const r = pixels[i]
          const g = pixels[i + 1]
          const b = pixels[i + 2]
          const l = 0.299 * r + 0.587 * g + 0.114 * b
          s.n += 1
          s.r += r
          s.g += g
          s.b += b
          s.l += l
          s.l2 += l * l
        }
      }
    }

    const n = s.n || 1
    cell.r = s.r / n
    cell.g = s.g / n
    cell.b = s.b / n
    cell.detail = Math.max(0, s.l2 / n - (s.l / n) * (s.l / n))
    return s
  }

  gather(root)
}

/*
 * Reorder so the busiest regions split first, reusing the same time slots —
 * only the order changes, so the pacing is identical and the detail arrives
 * where the eye is already looking.
 */
export function orderByDetail(branches: Cell[], openedBefore: number) {
  const pending = branches.filter((c) => c.splitAt > openedBefore)
  if (pending.length < 2) return

  const slots = pending.map((c) => c.splitAt).sort((a, b) => a - b)
  const queue = pending.filter((c) => !c.parent || c.parent.splitAt <= openedBefore)

  let next = 0
  while (queue.length && next < slots.length) {
    let pick = 0
    for (let i = 1; i < queue.length; i += 1) {
      if (queue[i].detail > queue[pick].detail) pick = i
    }
    const cell = queue.splice(pick, 1)[0]
    cell.splitAt = slots[next]
    next += 1
    for (const kid of cell.kids ?? []) {
      if (kid.kids) queue.push(kid)
    }
  }
}

export function coverRect(iw: number, ih: number, w: number, h: number) {
  const s = Math.max(w / iw, h / ih)
  return { dx: (w - iw * s) / 2, dy: (h - ih * s) / 2, dw: iw * s, dh: ih * s }
}
