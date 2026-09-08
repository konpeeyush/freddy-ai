import type { VisitorMeta } from "@workspace/api"

/**
 * What the operator's contact panel shows about a visitor — read passively
 * from the browser, never asked for. Sent once, alongside the first message
 * of a conversation.
 */
export function getVisitorMeta(): VisitorMeta {
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    referrer: document.referrer || undefined,
    currentUrl: location.href,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  }
}
