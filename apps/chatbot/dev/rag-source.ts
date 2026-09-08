/**
 * The knowledge base the harness is pointed at.
 *
 * Lifted out of `dev/rag.ts` because the namespace is not that page's
 * property: it decides what *every* route's widget retrieves. Left there,
 * ingesting into a namespace on `/rag` and then opening `/floating` searched
 * an index nobody had written to — retrieval quietly returning nothing, which
 * reads as "the model ignored the docs" rather than "it was asked the wrong
 * question".
 *
 * Dev-only. A real embed never names a namespace — see `tenantId` on
 * `WidgetConfig` for why letting a page do so would be a hole.
 */

import { DEFAULT_TENANT } from "@workspace/api"

const STORAGE_KEY = "widget-rag-source"

export type RagSourceSettings = {
  url: string
  tenantId: string
  maxPages: number
}

/** Matches the server's `DEFAULT_TENANT`, so an untouched harness agrees with
 *  a request that names no namespace at all. */
export const RAG_SOURCE_DEFAULTS: RagSourceSettings = {
  url: "",
  tenantId: DEFAULT_TENANT,
  maxPages: 40,
}

export function loadRagSource(): RagSourceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw)
      return {
        ...RAG_SOURCE_DEFAULTS,
        ...(JSON.parse(raw) as Partial<RagSourceSettings>),
      }
  } catch {
    // A corrupt entry is not worth failing the page over.
  }
  return RAG_SOURCE_DEFAULTS
}

export function saveRagSource(value: RagSourceSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Private browsing. The form still works for this session.
  }
}

/**
 * The namespace a widget on any route should read.
 *
 * Falls back to the server's default rather than to `undefined`, so a blank
 * stored value cannot send a request with no namespace on it.
 */
export function activeTenantId(): string {
  return loadRagSource().tenantId || RAG_SOURCE_DEFAULTS.tenantId
}
