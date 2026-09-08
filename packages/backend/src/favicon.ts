/**
 * Favicon proxy.
 *
 * The sources list wants a recognisable icon per cited domain, but the
 * visitor's browser must never ask a cited site for one directly — that would
 * tell every domain in a reply that someone on this page asked about it. This
 * server asks instead, through Google's favicon service, and hands back only
 * image bytes: the visitor's browser talks to us, we talk to Google, and the
 * cited site hears from neither.
 */

const FAVICON_SERVICE = "https://www.google.com/s2/favicons"

/** Loose hostname shape — enough to reject header-injection and junk, not a full RFC 1035 check. */
const DOMAIN_RE =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i

export function isValidDomain(domain: string): boolean {
  return domain.length > 0 && domain.length <= 253 && DOMAIN_RE.test(domain)
}

type CachedFavicon = { body: ArrayBuffer; contentType: string }

/*
 * One process, one cache. The same handful of domains repeat across every
 * visitor's citations, so the second request for a given domain should not
 * cost another round trip to Google. Capped and evicted oldest-first — a
 * plain Map iterates in insertion order — so a flood of distinct domains
 * cannot grow this without bound.
 */
const cache = new Map<string, CachedFavicon>()
const MAX_CACHE_ENTRIES = 500

export async function fetchFavicon(
  domain: string
): Promise<CachedFavicon | null> {
  const cached = cache.get(domain)
  if (cached) return cached

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(
      `${FAVICON_SERVICE}?sz=64&domain=${encodeURIComponent(domain)}`,
      { signal: controller.signal }
    )
    if (!response.ok) return null

    const entry: CachedFavicon = {
      body: await response.arrayBuffer(),
      contentType: response.headers.get("content-type") ?? "image/png",
    }

    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(domain, entry)
    return entry
  } catch {
    // Timed out, offline, or Google itself failed — same outcome either way:
    // the widget falls back to the drawn initial for this domain.
    return null
  } finally {
    clearTimeout(timeout)
  }
}
