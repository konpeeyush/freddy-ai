import { createContext, useContext } from "react"

import type { Action } from "./tree"

/*
 * Ambient state a primitive needs but should not have to thread through the
 * tree: which widget it belongs to, how to run an action, and how to reach
 * the enclosing Form.
 */

export type ActionRun = {
  /**
   * Runs an action on behalf of a control. Resolves when the ack settles, and
   * rejects with a visitor-safe message when the host reports a failure — the
   * control renders that inline.
   */
  run: (options: {
    action: Action
    label?: string
    /** Already resolved by the caller — bindings do not reach this. */
    payload?: Record<string, unknown>
    context?: Record<string, unknown>
  }) => Promise<void>
  /** True while a `loadingBehavior: "widget"` action is in flight. */
  widgetBusy: boolean
  /** Set once any action has settled, so one-shot widgets can lock. */
  disabled: boolean
}

export const WidgetRuntimeContext = createContext<ActionRun | null>(null)

export function useWidgetRuntime(): ActionRun {
  const runtime = useContext(WidgetRuntimeContext)
  if (!runtime) {
    // Rendering a primitive outside a widget is a programming error, but it
    // should not take the whole panel down.
    return {
      run: async () => {},
      widgetBusy: false,
      disabled: false,
    }
  }
  return runtime
}

/*
 * Form context.
 *
 * Inputs register by `name` and write into one shared record; the submit
 * button reads it. Keeping values here rather than on each input is what
 * lets a single `submit` action gather the whole form without the tree
 * having to know its own shape.
 */

export type FormState = {
  values: Record<string, unknown>
  errors: Record<string, string>
  setValue: (name: string, value: unknown) => void
  register: (name: string, required: boolean, label?: string) => void
  /** Validates every registered field; returns values only when all pass. */
  validate: () => { ok: boolean; values: Record<string, unknown> }
  submitted: boolean
}

export const FormContext = createContext<FormState | null>(null)

export function useFormContext(): FormState | null {
  return useContext(FormContext)
}
