import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "motion/react"

import { cn } from "@workspace/ui/lib/utils"

import {
  buildTree,
  clamp01,
  coverRect,
  easeOut,
  measureTree,
  mix,
  orderByDetail,
  selfPaced,
  smoothstep,
  COLOR_MS,
  GUTTER_FROM,
  GUTTER_TO,
  PHOTO_FROM,
  MORPH,
  SAMPLE,
  WAIT_CAP,
  type Cell,
} from "./grid-reveal-geometry"

/*
 * The placeholder shown where a widget is about to land.
 *
 * A tool that renders a card takes a second or two, and until now that second
 * was a line of text followed by the card appearing all at once. This fills it
 * with something the same shape as the answer: a grid that keeps subdividing
 * while the work is outstanding, so the wait reads as the picture being built
 * rather than as nothing happening.
 *
 * Adapted from a reveal written for images, and the adaptation is the point.
 * The original resolves *into* a photograph — it samples the image's pixels,
 * colours each cell from them, and fades the real thing in over the top. Most
 * widgets have no image at all: a weather card is a number and an icon, a
 * chart is a line. Run without one, the original animation reveals nothing and
 * settles to flat grey, which looks like a failure rather than a wait.
 *
 * So `src` is optional here. With one, the grid takes the image's own colours
 * and resolves into it. Without one, it settles into a neutral card and stops
 * short of finishing — the widget replacing it is the resolution.
 */

type Scene = {
  ctx: CanvasRenderingContext2D
  root: Cell
  width: number
  height: number
  scale: number
  /** Resolved from the panel's tokens each frame, so a theme toggle lands. */
  surface: Rgb
  gutter: Rgb
  clock: number
  split: number
  fade: number
  hasColors: boolean
  image: HTMLImageElement | null
}

type Rgb = { r: number; g: number; b: number }

/*
 * The panel's own surface colour, resolved by the browser.
 *
 * Read from a CSS token rather than picked as a number. The widget renders in
 * a closed shadow root with its tokens declared on `:host`, and the host page
 * can restyle them — so any grey chosen here is a guess about someone else's
 * design, and in dark mode it was the wrong guess: a pale rectangle sitting on
 * a dark panel.
 *
 * `getComputedStyle` also does the colour-space work. The tokens are authored
 * in `oklch`, which a canvas cannot take directly; the browser hands back a
 * resolved value, so nothing here has to know how to convert one.
 */
/*
 * A one-pixel canvas used to convert a CSS colour into numbers.
 *
 * The tokens are authored in `oklch`, and nothing in the DOM will hand those
 * back as sRGB: `getPropertyValue("--card")` returns the authored text, and
 * even resolving it through a real `color` property returns `oklch(...)`
 * again — Chrome preserves the colour space. Parsing that as three numbers
 * reads 0.205 as a red channel and paints near-black under every theme.
 *
 * A canvas, though, *does* convert: assigning `oklch(0.205 0 0)` to
 * `fillStyle` and reading the pixel back gives 23,23,23. So the conversion is
 * handed to the one thing here that already knows how to do it — which also
 * means `color-mix`, `lab`, or whatever a host page redefines a token with
 * all work without this file knowing about any of them.
 */
/** Improbable enough that a real token will never collide with it. */
const SENTINEL = "rgb(255, 0, 254)"

function makeColourReader() {
  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext("2d", { willReadFrequently: true })

  return (probe: HTMLElement, name: string, fallback: Rgb): Rgb => {
    if (!ctx) return fallback

    /*
     * The sentinel is what detects a token that is not defined.
     *
     * `color: var(--nope)` is not an error — the declaration is simply
     * invalid at computed-value time and `color` falls back to whatever is
     * inherited, which on a fresh element is black. Without a way to tell
     * that apart, a host page that had renamed a token would get a black
     * placeholder rather than the fallback grey.
     *
     * A magenta nobody would author means "the token resolved to nothing".
     */
    probe.style.color = SENTINEL
    probe.style.color = `var(${name}, ${SENTINEL})`
    const value = getComputedStyle(probe).color
    if (!value || value === SENTINEL) return fallback

    try {
      // Cleared first: an unparseable value leaves `fillStyle` at whatever it
      // was, and the old colour would read as a successful parse.
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = "#000"
      ctx.fillStyle = value
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      // A fully transparent token tells us nothing about the surface.
      return a === 0 ? fallback : { r, g, b }
    } catch {
      return fallback
    }
  }
}

/**
 * The resting colour of one cell, before any image tints it.
 *
 * Two tokens rather than one: cells sit on `--card` and the gutters behind
 * them on `--muted`, so the grid reads as separated tiles on a surface rather
 * than as a flat block with lines scored through it. `tone` varies each cell
 * a little and `clock` breathes, which is what keeps a waiting grid alive
 * without it looking like it is making progress.
 */
function cellColour(surface: Rgb, tone: number, clock: number): Rgb {
  // Toward the panel's foreground in light themes, away from it in dark ones,
  // so the variation reads the same either way.
  const dark = surface.r + surface.g + surface.b < 383
  const lift = (dark ? 1 : -1) * (tone * 12 + Math.sin(clock * 1.5 + tone * 6.28) * 3)
  return {
    r: clampByte(surface.r + lift),
    g: clampByte(surface.g + lift),
    b: clampByte(surface.b + lift),
  }
}

const clampByte = (n: number) => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n))

type Patch = {
  x: number
  y: number
  w: number
  h: number
  r: number
  g: number
  b: number
  tone: number
}

function drawScene(s: Scene) {
  const { ctx, root, width, height, split } = s
  // Without pixel access the grid stays neutral; the photo still fades in.
  const tint = s.hasColors ? s.fade : 0
  const shade = (grey: number, target: number) => Math.round(mix(grey, target, tint))
  /*
   * The ground the cells sit on. Its own token rather than a darkened copy of
   * the cell colour: multiplying works in a light theme and inverts in a dark
   * one, where "darker" means the gutters vanish into black instead of
   * reading as the surface behind the tiles.
   */
  ctx.fillStyle = `rgb(${shade(s.gutter.r, root.r)},${shade(
    s.gutter.g,
    root.g
  )},${shade(s.gutter.b, root.b)})`
  ctx.fillRect(0, 0, width, height)

  const soft = 1 - smoothstep(GUTTER_FROM, GUTTER_TO, split)
  const gutter = s.scale * soft
  const rounded = soft > 0.01 && typeof ctx.roundRect === "function"

  const paint = (p: Patch) => {
    // Snapped to whole pixels so neighbouring cells stay flush with no seam.
    const x = Math.round(p.x)
    const y = Math.round(p.y)
    const w = Math.round(p.x + p.w) - x
    const h = Math.round(p.y + p.h) - y

    const onLeft = x <= 0
    const onTop = y <= 0
    const onRight = x + w >= width
    const onBottom = y + h >= height

    // Only interior edges get a gutter, so the outer silhouette stays square.
    const left = onLeft ? 0 : gutter
    const top = onTop ? 0 : gutter
    const innerW = w - left - (onRight ? 0 : gutter)
    const innerH = h - top - (onBottom ? 0 : gutter)
    if (innerW <= 0 || innerH <= 0) return

    const cell = cellColour(s.surface, p.tone, s.clock)
    ctx.fillStyle = `rgb(${shade(cell.r, p.r)},${shade(cell.g, p.g)},${shade(
      cell.b,
      p.b
    )})`

    if (rounded) {
      const radius = Math.min(innerW, innerH) * 0.12 * soft
      ctx.beginPath()
      ctx.roundRect(x + left, y + top, innerW, innerH, [
        !onLeft && !onTop ? radius : 0,
        !onRight && !onTop ? radius : 0,
        !onRight && !onBottom ? radius : 0,
        !onLeft && !onBottom ? radius : 0,
      ])
      ctx.fill()
    } else {
      ctx.fillRect(x + left, y + top, innerW, innerH)
    }
  }

  const walk = (cell: Cell, p: Patch) => {
    if (!cell.kids || split < cell.splitAt) {
      paint(p)
      return
    }
    // Children start on the parent's rect and separate into their own.
    const t = easeOut(clamp01((split - cell.splitAt) / MORPH))
    for (const kid of cell.kids) {
      walk(kid, {
        x: mix(p.x, kid.x * width, t),
        y: mix(p.y, kid.y * height, t),
        w: mix(p.w, kid.w * width, t),
        h: mix(p.h, kid.h * height, t),
        r: mix(p.r, kid.r, t),
        g: mix(p.g, kid.g, t),
        b: mix(p.b, kid.b, t),
        tone: mix(p.tone, kid.tone, t),
      })
    }
  }

  walk(root, {
    x: 0,
    y: 0,
    w: width,
    h: height,
    r: root.r,
    g: root.g,
    b: root.b,
    tone: root.tone,
  })

  if (!s.image) return
  const photo = s.hasColors ? smoothstep(PHOTO_FROM, 1, split) * s.fade : s.fade
  if (photo <= 0.002) return

  const fit = coverRect(s.image.naturalWidth, s.image.naturalHeight, width, height)
  ctx.globalAlpha = photo
  ctx.drawImage(s.image, fit.dx, fit.dy, fit.dw, fit.dh)
  ctx.globalAlpha = 1
}

function readAverages(
  el: HTMLImageElement,
  root: Cell,
  branches: Cell[],
  at: number
) {
  const buffer = document.createElement("canvas")
  buffer.width = SAMPLE
  buffer.height = SAMPLE
  const ctx = buffer.getContext("2d", { willReadFrequently: true })
  if (!ctx) return false

  const fit = coverRect(el.naturalWidth, el.naturalHeight, SAMPLE, SAMPLE)
  ctx.drawImage(el, fit.dx, fit.dy, fit.dw, fit.dh)

  try {
    measureTree(root, ctx.getImageData(0, 0, SAMPLE, SAMPLE).data, SAMPLE)
    orderByDetail(branches, at)
    return true
  } catch {
    // A cross-origin image taints the canvas. The grid still runs; it just
    // stays neutral rather than taking the image's colours.
    return false
  }
}

export type GridRevealProps = {
  /**
   * Resolve into this image, when there is one.
   *
   * Optional, and that is the adaptation: most widgets have no image, and
   * without one the grid settles into a neutral card instead — the widget
   * replacing it is the resolution.
   */
  src?: string | null
  /** Describes what is loading, for assistive technology. */
  label?: string
  /** Width over height. The placeholder must not resize when the widget lands. */
  aspect?: number
  /** Roughly how long the work takes, for pacing when there is no progress. */
  estimatedDuration?: number
  /** True once the real content is ready — the grid then resolves and stops. */
  done?: boolean
  className?: string
  /**
   * Drops the ARIA role/label, for an instance that is one of several drawn
   * together by `WidgetSkeleton`. Without this, a four-row list skeleton
   * announces "Loading" four times over — one `role="status"` per box.
   */
  decorative?: boolean
}

export function GridReveal({
  src,
  label = "Loading",
  aspect = 16 / 9,
  estimatedDuration = 5000,
  done = false,
  className,
  decorative = false,
}: GridRevealProps) {
  const reduce = useReducedMotion()
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  /*
   * Read inside the loop rather than closed over, so finishing does not
   * rebuild the tree — which would restart the animation at the moment it is
   * supposed to be settling.
   */
  const doneRef = useRef(done)
  const durationRef = useRef(estimatedDuration)
  useEffect(() => {
    doneRef.current = done
    durationRef.current = estimatedDuration
  })

  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const frame = frameRef.current
    if (!canvas || !frame) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    /*
     * One hidden element the colours are resolved through, rather than one
     * per frame. Parented to the frame so it inherits the panel's tokens, and
     * zero-sized so it cannot affect layout.
     */
    const probe = frame.ownerDocument.createElement("span")
    probe.setAttribute("aria-hidden", "true")
    probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden"
    frame.appendChild(probe)

    const readColour = makeColourReader()

    const { root, branches } = buildTree(ratio)

    const scene: Scene = {
      ctx,
      root,
      width: 0,
      height: 0,
      scale: 1,
      surface: { r: 232, g: 232, b: 232 },
      gutter: { r: 220, g: 220, b: 220 },
      clock: 0,
      split: 0,
      fade: 0,
      hasColors: false,
      image: null,
    }

    let loadedAt = -1
    let cancelled = false

    const render = (split: number, now: number) => {
      /*
       * Re-read each frame, and from the frame element rather than from
       * `document.documentElement`.
       *
       * The widget lives in a closed shadow root with its tokens on `:host`,
       * so the document's `dark` class says nothing about what this panel
       * looks like — reading it there left the placeholder painting a light
       * grid on a dark panel. Reading the element's own computed style is
       * also what makes the theme toggle land mid-animation.
       */
      scene.surface = readColour(probe, "--card", scene.surface)
      scene.gutter = readColour(probe, "--muted", scene.gutter)
      scene.split = split
      scene.fade = loadedAt < 0 ? 0 : smoothstep(0, COLOR_MS, now - loadedAt)
      drawScene(scene)
    }

    const repaint = () => {
      if (!reduce) {
        render(scene.split, performance.now())
        return
      }
      // Reduced motion runs no loop, so paint the settled frame directly.
      const settled = loadedAt < 0 ? performance.now() : loadedAt + COLOR_MS
      render(scene.image || doneRef.current ? 1 : WAIT_CAP, settled)
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = frame.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width * dpr))
      const h = Math.max(1, Math.round(rect.height * dpr))
      scene.scale = dpr
      if (w === scene.width && h === scene.height) return
      scene.width = w
      scene.height = h
      canvas.width = w
      canvas.height = h
      // Resizing a canvas clears it, so always paint again.
      repaint()
    }

    resize()
    // Absent in jsdom and older browsers, so this degrades rather than throws.
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null
    observer?.observe(frame)

    const load = (url: string, withCors: boolean) => {
      const el = new Image()
      if (withCors) el.crossOrigin = "anonymous"
      el.decoding = "async"
      el.onload = () => {
        if (cancelled) return
        if (!el.naturalWidth || !el.naturalHeight) {
          setFailed(true)
          return
        }
        scene.image = el
        loadedAt = performance.now()
        scene.hasColors = readAverages(el, root, branches, scene.split)
        if (reduce) repaint()
      }
      // A host without CORS headers rejects the request, so retry plainly —
      // the image still renders, it just cannot be sampled for colours.
      el.onerror = () => {
        if (cancelled) return
        if (withCors) load(url, false)
        else setFailed(true)
      }
      el.src = url
    }

    if (src) load(src, true)

    if (reduce) {
      repaint()
      return () => {
        cancelled = true
        observer?.disconnect()
        probe.remove()
      }
    }

    let frameId = 0
    let last = 0
    let elapsed = 0
    let eased = 0
    let split = 0
    let stopped = false
    let visible = true

    const tick = (now: number) => {
      frameId = requestAnimationFrame(tick)
      if (!last) last = now
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      elapsed += dt
      scene.clock = elapsed

      /*
       * The work finishing is what completes the run, not the clock. An image
       * that has landed counts too, since the reveal has something to resolve
       * into; otherwise the grid holds below the cap however long it waits.
       */
      const ready = doneRef.current || scene.image !== null
      const target = ready
        ? 1
        : selfPaced(elapsed * 1000, durationRef.current)

      eased += (target - eased) * (1 - Math.exp(-dt * 5.5))
      const wanted = Math.min(eased, ready ? 1 : WAIT_CAP)
      split += (wanted - split) * (1 - Math.exp(-dt * 4))
      render(split, now)

      // Nothing moves after this, so stop burning frames on other people's
      // pages — this renders inside a customer's site, not ours.
      if (ready && split > 0.9995) {
        render(1, now)
        stopped = true
        cancelAnimationFrame(frameId)
      }
    }

    const start = () => {
      if (stopped) return
      last = 0
      cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(tick)
    }

    // No reason to animate a placeholder scrolled out of view.
    const visibility =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            ([entry]) => {
              if (entry.isIntersecting === visible) return
              visible = entry.isIntersecting
              if (visible) start()
              else cancelAnimationFrame(frameId)
            },
            { rootMargin: "150px" }
          )
        : null
    visibility?.observe(frame)

    start()

    return () => {
      cancelled = true
      cancelAnimationFrame(frameId)
      observer?.disconnect()
      visibility?.disconnect()
      probe.remove()
    }
  }, [reduce, src, ratio])

  // An image that will not load is not worth a frame reserved for it.
  if (failed && src) return null

  return (
    <div
      ref={frameRef}
      data-slot="grid-reveal"
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : label}
      aria-live={decorative ? undefined : "polite"}
      aria-hidden={decorative || undefined}
      className={cn(
        "relative w-full overflow-hidden rounded-xl border border-border bg-muted",
        className
      )}
      style={{ aspectRatio: ratio }}
    >
      <canvas ref={canvasRef} aria-hidden className="block h-full w-full" />
    </div>
  )
}
