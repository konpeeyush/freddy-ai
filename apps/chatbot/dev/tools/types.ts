import type { ToolDefinition } from "../../src/tools/registry"

/*
 * A demo tool, plus what the playground UI needs to talk about it.
 *
 * The two halves travel together because they are written together: a tool
 * whose toggle row is defined somewhere else drifts from it the first time
 * either is edited. Previously the meta came down from the server's `/tools`
 * — client-side tools have no server to ask, so it ships alongside the
 * definition instead.
 */
export type DevTool = {
  definition: ToolDefinition
  meta: DevToolMeta
}

export type DevToolMeta = {
  name: string
  /** Shown in the playground's toggle list. */
  label: string
  /** One line on what it does, for a developer rather than the model. */
  summary: string
  /** The widget it emits, when it emits one. */
  widget?: string
  /** A prompt known to trigger it — the playground offers these as chips. */
  example: string
  /** Registered unless the playground says otherwise. */
  defaultEnabled: boolean
}
