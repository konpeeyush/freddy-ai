/**
 * Escapes text destined for markup — a page title, a url, a model's own
 * prose — none of which is ours to trust with an unescaped `<` or `"`.
 *
 * Shared rather than redefined per dev page: this function was copied
 * byte-for-byte into `playground.ts` (twice, under two names) and `rag.ts`
 * before being pulled out here, the same reason `server-origin.ts` exists.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
