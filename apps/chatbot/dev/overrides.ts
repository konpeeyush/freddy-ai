import type { DevTool } from "./tools/types"

/*
 * Edited definitions for the shipped tools.
 *
 * The two fields worth editing are the description and the schema: the first
 * decides whether the model reaches for a tool at all, the second decides what
 * it passes. Both are guesswork until tried against real prompts, and editing
 * a file and reloading is a slow way to find out.
 *
 * The handler is deliberately not editable. `getWeather` really does fetch
 * Open-Meteo and `getOrderStatus` really does look up its mock orders — that
 * is what makes an edit here a test of prompt-engineering against real
 * behaviour rather than against a canned reply.
 *
 * Stored as overrides rather than written back to `dev/tools/*.ts`, so the
 * shipped definitions stay the reference and reverting is instant. A tool with
 * no override registers exactly as authored.
 */

const STORAGE_KEY = "widget-playground-overrides"

/** The editable half of a tool definition. */
export type ToolOverride = {
  description: string
  inputSchema?: Record<string, unknown>
}

export type Overrides = Record<string, ToolOverride>

export function loadOverrides(): Overrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}

    const out: Overrides = {}
    for (const [name, value] of Object.entries(parsed as Overrides)) {
      // A stored override whose shape has drifted is dropped rather than
      // registered, which would produce a tool the model cannot call.
      if (value && typeof value.description === "string") {
        out[name] = {
          description: value.description,
          inputSchema:
            value.inputSchema && typeof value.inputSchema === "object"
              ? value.inputSchema
              : undefined,
        }
      }
    }
    return out
  } catch {
    // Corrupt entry. The shipped definitions are a fine fallback.
    return {}
  }
}

export function saveOverrides(overrides: Overrides): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // Private browsing. Edits still apply for this session.
  }
}

/**
 * Applies an override to a tool, keeping its handler and metadata.
 *
 * Returns the tool unchanged when nothing is stored for it, so the shipped
 * definition is what registers by default.
 */
export function withOverride(tool: DevTool, overrides: Overrides): DevTool {
  const override = overrides[tool.meta.name]
  if (!override) return tool

  return {
    ...tool,
    definition: {
      ...tool.definition,
      description: override.description,
      inputSchema: override.inputSchema ?? tool.definition.inputSchema,
    },
    meta: {
      ...tool.meta,
      // The row's blurb is the description, so an edit shows up in the list.
      summary: override.description,
    },
  }
}

/** True when a tool is running with something other than what it ships with. */
export function isOverridden(name: string, overrides: Overrides): boolean {
  return Object.prototype.hasOwnProperty.call(overrides, name)
}
