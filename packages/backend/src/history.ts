import type { ModelMessage } from "ai"

import {
  WIDGET_ENVELOPE_KEY,
  type ChatMessage,
  type MessagePart,
} from "@workspace/api/schema"

/*
 * Transcript → model messages.
 *
 * A turn that used a page-defined tool is three messages to the model, not
 * one: the assistant's call, the tool's result, then the assistant's reply.
 * Flattening that to prose would erase the call, and a resumed request whose
 * call has no matching result is malformed — Gemini rejects the sequence
 * outright rather than ignoring it.
 *
 * So messages carrying tool parts are expanded, and everything else keeps the
 * old cheap path of sending `text`.
 */

/** A call still waiting on its result. */
function isUnanswered(parts: MessagePart[], toolCallId: string): boolean {
  return !parts.some(
    (part) => part.kind === "tool-result" && part.toolCallId === toolCallId
  )
}

/**
 * Model-facing form of a tool result.
 *
 * A widget envelope is data the visitor can already see, so the model is given
 * the summary rather than the payload — otherwise it narrates a card the
 * visitor is looking at. Anything else goes through as JSON.
 */
function outputForModel(output: unknown): unknown {
  if (
    output &&
    typeof output === "object" &&
    WIDGET_ENVELOPE_KEY in (output as Record<string, unknown>)
  ) {
    const envelope = output as { summary?: string; widgetId?: string }
    return {
      shown: true,
      summary:
        envelope.summary ??
        `Displayed the ${envelope.widgetId ?? "widget"} to the visitor.`,
    }
  }
  return output
}

/** Expands one transcript message into the messages the model should see. */
function expand(message: ChatMessage): ModelMessage[] {
  const role = message.role === "agent" ? "assistant" : "user"
  const parts = message.parts

  const calls = parts?.filter((part) => part.kind === "tool-call") ?? []
  if (!parts || calls.length === 0) {
    // The common case: no tools involved, prose is the whole message.
    return [{ role, content: message.text } as ModelMessage]
  }

  const out: ModelMessage[] = []

  /*
   * A call with no result would leave a dangling function call, which the
   * provider rejects. Dropping the pair is the safe repair: the turn reads as
   * though the tool was never called.
   */
  const answered = calls.filter(
    (call) => call.kind === "tool-call" && !isUnanswered(parts, call.toolCallId)
  )

  const leading = parts
    .filter((part) => part.kind === "text")
    .map((part) => (part as { text: string }).text)
    .join("")
    .trim()

  if (answered.length > 0) {
    out.push({
      role: "assistant",
      content: [
        ...(leading ? [{ type: "text" as const, text: leading }] : []),
        ...answered.map((call) => {
          const provider = (
            call as { providerOptions?: Record<string, unknown> }
          ).providerOptions
          return {
            type: "tool-call" as const,
            toolCallId: (call as { toolCallId: string }).toolCallId,
            toolName: (call as { toolName: string }).toolName,
            input: (call as { input: unknown }).input,
            /*
             * Replayed verbatim. Gemini 3 signs its tool calls and rejects a
             * replay whose `thoughtSignature` was dropped somewhere in
             * persistence — the SDK papers over it with a sentinel, but the
             * real fix is not losing it in the first place.
             */
            ...(provider ? { providerOptions: provider } : {}),
          }
        }),
      ],
    } as ModelMessage)

    out.push({
      role: "tool",
      content: answered.map((call) => {
        const id = (call as { toolCallId: string }).toolCallId
        const result = parts.find(
          (part) => part.kind === "tool-result" && part.toolCallId === id
        ) as
          | { toolName: string; output: unknown; errorText?: string }
          | undefined

        return {
          type: "tool-result" as const,
          toolCallId: id,
          toolName: (call as { toolName: string }).toolName,
          output: result?.errorText
            ? { type: "error-text" as const, value: result.errorText }
            : {
                type: "json" as const,
                value: outputForModel(result?.output) as never,
              },
        }
      }),
    } as ModelMessage)
  } else if (leading) {
    out.push({ role, content: leading } as ModelMessage)
  }

  return out
}

/** Flattens the transcript into what the model receives. */
export function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.flatMap(expand)
}
