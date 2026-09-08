/**
 * Which provider actually receives the request.
 *
 * Resolved by `resolveProvider()` from `@workspace/rag` — the same resolver
 * `embed.ts` uses for the embedding model, so chat and embeddings cannot end
 * up silently pointed at different providers. See that module for why
 * `MODEL_PROVIDER` is opt-in by name rather than inferred from which keys are
 * present.
 *
 *   google   (default) `@ai-sdk/google` calls Google with our own key.
 *   ollama             a local model over Ollama's OpenAI-compatible API.
 *
 * `ollama` is the fallback when Google is unreachable: its generative
 * endpoints reject some networks with `FAILED_PRECONDITION: User location is
 * not supported for the API use`, decided on the caller's IP. It can strike an
 * ordinary connection in a supported country, follows the network rather than
 * the key, and nothing here can route around it — the request never reaches a
 * model. A local model sidesteps the network question entirely.
 */
import { google } from "@ai-sdk/google"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import { resolveProvider, type ModelProvider } from "@workspace/rag"

export type { ModelProvider }
export const provider: ModelProvider = resolveProvider()

const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1"
const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL ?? "llama3.2:3b"

/** Resolves a bare Gemini model id to whatever the SDK should be handed. */
export function chatModel(id: string): LanguageModel {
  switch (provider) {
    case "ollama":
      return createOpenAICompatible({
        name: "ollama",
        baseURL: OLLAMA_BASE_URL,
      }).chatModel(OLLAMA_CHAT_MODEL)
    default:
      return google(id)
  }
}

/** What the startup line and `/health` report. */
export function modelLabel(id: string): string {
  switch (provider) {
    case "ollama":
      return `${OLLAMA_CHAT_MODEL} via Ollama`
    default:
      return id
  }
}

/**
 * Whether a request can be served at all.
 *
 * Ollama needs no key — it is a local process — so requiring one would reject
 * a perfectly working setup.
 */
export function isConfigured(): boolean {
  switch (provider) {
    case "ollama":
      return true
    default:
      return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY)
  }
}
