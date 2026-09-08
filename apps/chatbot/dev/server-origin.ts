/**
 * The chat endpoint's origin, for the dev-only routes that sit beside it.
 *
 * `apiUrl` points at `/chat`; `/draft-tool`, `/compile-sequence` and the
 * `/rag/*` routes live on the same server. Shared rather than duplicated
 * because the fallback matters: a harness pointed at a malformed URL should
 * still talk to localhost rather than throwing during render.
 */
export function serverOrigin(apiUrl: string): string {
  try {
    return new URL(apiUrl).origin
  } catch {
    return "http://localhost:8788"
  }
}
