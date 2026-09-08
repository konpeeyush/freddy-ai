import {
  WidgetDefinitionSchema,
  type WidgetDefinition,
} from "./tree"

/*
 * Widget definition registry.
 *
 * Definitions are per-customer, so they cannot ship inside widget.js — they
 * arrive with the widget's config and are registered here. Lookup is by id
 * and version, because stored conversation history outlives any single
 * definition: a message written six months ago must still render against the
 * definition it was authored with, not whatever the dashboard says today.
 */

const registry = new Map<string, Map<number, WidgetDefinition>>()

/** Registers one definition. Returns false (and warns) on a malformed one. */
export function registerWidget(definition: unknown): boolean {
  const parsed = WidgetDefinitionSchema.safeParse(definition)
  if (!parsed.success) {
    console.warn(
      "[widgets] invalid widget definition:",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    )
    return false
  }

  const byVersion = registry.get(parsed.data.id) ?? new Map()
  byVersion.set(parsed.data.version, parsed.data)
  registry.set(parsed.data.id, byVersion)
  return true
}

export function registerWidgets(definitions: unknown[]): number {
  return definitions.filter(registerWidget).length
}

/**
 * Looks a definition up.
 *
 * Falls back to the newest registered version when the requested one is gone
 * — a definition edited in the dashboard should not blank out the widgets
 * already sitting in someone's transcript. The shapes may differ, but an
 * unresolved binding renders as empty rather than as an error, so a partial
 * render beats nothing.
 */
export function getWidget(
  id: string,
  version?: number
): WidgetDefinition | null {
  const byVersion = registry.get(id)
  if (!byVersion || byVersion.size === 0) return null

  if (version !== undefined) {
    const exact = byVersion.get(version)
    if (exact) return exact
  }

  const latest = Math.max(...byVersion.keys())
  return byVersion.get(latest) ?? null
}

export function hasWidget(id: string): boolean {
  return registry.has(id)
}

/** Every registered definition at its newest version — for tool registration. */
export function listWidgets(): WidgetDefinition[] {
  return [...registry.values()]
    .map((byVersion) => byVersion.get(Math.max(...byVersion.keys())))
    .filter((definition): definition is WidgetDefinition => Boolean(definition))
}

/** Test/dev seam. Clears everything registered so far. */
export function clearWidgets(): void {
  registry.clear()
}
