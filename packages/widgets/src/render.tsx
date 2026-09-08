import { useCallback, useMemo, useState } from "react"

import { runAction, visitorMessageFromRejection } from "./actions"
import { WidgetRuntimeContext, type ActionRun } from "./context"
import { PRIMITIVES } from "./primitives"
import {
  asText,
  resolveProps,
  resolvePath,
  resolveValue,
  testCondition,
  type Scope,
} from "./resolve"
import {
  isBind,
  type Action,
  type WidgetDefinition,
  type WidgetNode,
} from "./tree"

/*
 * The renderer.
 *
 * Walks a node tree, resolving bindings against data as it goes. It never
 * evaluates anything: `repeat` maps, `when` tests, and every prop is either a
 * literal or a path lookup. That is the whole reason this is safe to run on a
 * customer's page.
 */

/**
 * One repeating node, as a flat list of rendered siblings.
 *
 * Shared by both callers, and that sharing is the point. A parent expands a
 * repeating child here so that a primitive laying out its own children — a
 * `Carousel` sizing each into a snap slot — receives the items rather than
 * one fragment holding all of them. `RenderNode` calls it too, for a root
 * node that has no parent to do the expanding.
 *
 * Written once because the two paths had drifted: they keyed differently, and
 * only one was covered by tests, so a fix to either would silently not apply
 * to the other.
 *
 * `keyPrefix` disambiguates items across sibling repeats — two repeating
 * children of the same parent can produce the same key from their own data.
 */
function expandRepeat(
  node: WidgetNode,
  scope: Scope,
  keyPrefix: string
): React.ReactElement[] {
  const repeat = node.repeat
  if (!repeat) return []

  const source = resolvePath(repeat.over, scope)
  // Not an array: a tool that failed, or data written against another
  // version. Rendering nothing beats rendering a broken row.
  if (!Array.isArray(source)) return []

  const items = repeat.limit ? source.slice(0, repeat.limit) : source

  // Dropped before recursing, or each item would repeat again forever.
  const bare: WidgetNode = { ...node }
  delete bare.repeat

  return items.map((item, index) => {
    const itemScope: Scope = { ...scope, item, index }
    const key = repeat.key
      ? asText(resolvePath(repeat.key, itemScope)) || String(index)
      : String(index)
    return (
      <RenderNode key={`${keyPrefix}${key}`} node={bare} scope={itemScope} />
    )
  })
}

function RenderNode({ node, scope }: { node: WidgetNode; scope: Scope }) {
  // `when` gates before anything else — a hidden node must not resolve its
  // props or mount its children.
  if (node.when && !testCondition(node.when, scope)) return null

  const Primitive = PRIMITIVES[node.type]
  if (!Primitive) {
    // An unknown type means data written by a newer widget version. Rendering
    // nothing beats throwing: the rest of the widget still works.
    console.warn(`[widgets] unknown node type: ${node.type}`)
    return null
  }

  /*
   * A repeat reached here rather than through its parent — a root node with
   * `repeat`, which nothing renders a parent for. The fragment is fine in
   * that position: no primitive is laying these out as siblings.
   */
  if (node.repeat) {
    return <>{expandRepeat(node, scope, "")}</>
  }

  const props = resolveProps(node.props, scope)

  /*
   * `onClickAction` is handed over unresolved except for its inputs: the
   * Button needs the action's own shape intact to know what kind it is, but
   * `additionalInputs` and a bound `url` must already be plain values by the
   * time it runs.
   */
  if (node.props?.onClickAction) {
    const action = node.props.onClickAction as Record<string, unknown>
    props.onClickAction = {
      ...action,
      additionalInputs: action.additionalInputs
        ? (resolveValue(action.additionalInputs, scope) as Record<
            string,
            unknown
          >)
        : undefined,
      url: isBind(action.url) ? asText(resolveValue(action.url, scope)) : action.url,
    }
  }

  /*
   * Children are built as a flat array of siblings, with a repeating child
   * expanded here rather than left to render a fragment.
   *
   * The difference matters to any parent that sizes or positions its own
   * children. A `Carousel` wraps each child in a snap-scrolled slot, and a
   * repeat that rendered one fragment gave it a single child holding twelve
   * cards — so every card landed in one slot and the row rendered as a
   * vertical stack. `Children.toArray` does not help: it treats a fragment as
   * one child, not as its contents.
   *
   * Expanding here keeps that knowledge in one place. A primitive can rely on
   * `children` being the items it is meant to lay out, whether the author
   * wrote them individually or produced them from an array.
   */
  const children = node.children?.length
    ? node.children.flatMap((child, index) =>
        child.repeat
          ? expandRepeat(child, scope, `${index}-`)
          : [<RenderNode key={index} node={child} scope={scope} />]
      )
    : undefined

  return <Primitive props={props}>{children}</Primitive>
}

// ── The widget ────────────────────────────────────────────────────────────

export type WidgetProps = {
  definition: WidgetDefinition
  data: unknown
  /** Fallback text, shown when the widget is disabled or fails to render. */
  summary?: string
  locale?: string
  /**
   * Called when an action settles with new data for this widget — a booking
   * confirming, a form submitting. Persisting it is what makes the widget's
   * state survive the panel closing: `stateBy` reads from data, so replaying
   * the tree lands on the same state.
   */
  onDataChange?: (data: unknown) => void
  onClose?: () => void
}

export function Widget({
  definition,
  data,
  summary,
  locale,
  onDataChange,
  onClose,
}: WidgetProps) {
  const [widgetBusy, setWidgetBusy] = useState(false)
  const [disabled, setDisabled] = useState(false)

  const scope: Scope = useMemo(
    () => ({ root: data, locale }),
    [data, locale]
  )

  const run = useCallback<ActionRun["run"]>(
    async ({ action, label, payload, context }) => {
      const behavior =
        action.kind === "emit" || action.kind === "submit"
          ? action.loadingBehavior
          : "none"

      if (behavior === "widget") setWidgetBusy(true)

      try {
        const { acked, done } = runAction({
          action: action as Action,
          widgetId: definition.id,
          label,
          payload,
          context,
          onClose,
        })

        const result = await done

        /*
         * A host listener may resolve with replacement data — that is how a
         * booking moves from Booking to Booked. Persisting it (rather than
         * flipping a local flag) is what makes the new state survive the
         * panel closing: `stateBy` reads from data, so replaying the tree
         * later lands on the same state.
         */
        if (result !== undefined && onDataChange) onDataChange(result)

        /*
         * Only an acknowledged action locks the widget. Without an ack we do
         * not know the flow completed — the chat fallback in particular hands
         * off to the AI, which may well come back with a new widget.
         */
        if (acked && (action.kind === "emit" || action.kind === "submit")) {
          setDisabled(true)
        }
      } catch (cause) {
        // Only a deliberate host message reaches the visitor; anything else
        // is a bug or a timeout and gets a generic line.
        const message = visitorMessageFromRejection(cause)
        console.warn("[widgets] action failed:", cause)
        // `cause` is kept for the console/devtools; only `message` is ever
        // rendered, so a host's internals cannot leak into the conversation.
        throw new Error(message ?? "That didn't work. Please try again.", {
          cause,
        })
      } finally {
        if (behavior === "widget") setWidgetBusy(false)
      }
    },
    [definition.id, onClose, onDataChange]
  )

  const runtime = useMemo<ActionRun>(
    () => ({ run, widgetBusy, disabled }),
    [run, widgetBusy, disabled]
  )

  // The dashboard toggle is enforced here as well as at tool registration:
  // a disabled widget already in stored history degrades to its summary.
  if (!definition.enabled) {
    return summary ? <FallbackText text={summary} /> : null
  }

  // ── state selection ─────────────────────────────────────────────────────
  const stateNames = Object.keys(definition.states)
  let stateName = stateNames[0]

  if (definition.stateBy) {
    const value = resolvePath(definition.stateBy.$bind, scope)
    const key = value === null || value === undefined ? "" : String(value)
    stateName =
      definition.stateBy.map[key] ??
      definition.stateBy.map.default ??
      stateNames[0]
  }

  const tree = definition.states[stateName]
  if (!tree) {
    console.warn(`[widgets] no state named "${stateName}" in ${definition.id}`)
    return summary ? <FallbackText text={summary} /> : null
  }

  return (
    <WidgetRuntimeContext.Provider value={runtime}>
      <div
        className="w-full min-w-0"
        data-widget={definition.id}
        data-state={stateName}
      >
        <RenderNode node={tree} scope={scope} />
      </div>
    </WidgetRuntimeContext.Provider>
  )
}

/** What a surface shows when it cannot render the widget itself. */
function FallbackText({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>
}
