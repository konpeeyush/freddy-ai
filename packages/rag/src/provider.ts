/**
 * Which provider backs both the chat model and the embedding model.
 *
 * One variable, `MODEL_PROVIDER`, decides both — a chat model from one
 * provider and embeddings from another is not a supported configuration, so
 * resolving it in one place is what keeps them from drifting apart. This used
 * to be resolved independently in the server's `model.ts` and this package's
 * `embed.ts`; the duplicate in `embed.ts` skipped the validation below; an
 * unrecognised value there silently fell through to the default with no
 * warning, while the server's copy logged an error. One resolver, used by
 * both, means there is only one place that can disagree with itself.
 *
 * Deliberately *not* inferred from which keys happen to be present. An
 * earlier version switched providers whenever a second provider's key was
 * set, which meant adding a key in order to try one thing silently rerouted
 * chat and embeddings as well — a setting nobody asked for, visible only as a
 * new error from an unrelated endpoint. Opt in by name instead.
 *
 *   google   (default) calls Google with our own key.
 *   ollama             a local model over Ollama's OpenAI-compatible API.
 */
export const PROVIDERS = ["google", "ollama"] as const
export type ModelProvider = (typeof PROVIDERS)[number]

/**
 * Resolved per call rather than cached at module load, so a script or a test
 * can set the variable after importing this.
 */
export function resolveProvider(): ModelProvider {
  const value = process.env.MODEL_PROVIDER?.trim().toLowerCase()
  if (!value) return "google"
  if ((PROVIDERS as readonly string[]).includes(value)) {
    return value as ModelProvider
  }
  // Named rather than silently falling back: a typo here would otherwise look
  // like the default working, and the reason for setting it would be lost.
  console.error(
    `MODEL_PROVIDER="${value}" is not one of ${PROVIDERS.join(", ")} — using google.`
  )
  return "google"
}
