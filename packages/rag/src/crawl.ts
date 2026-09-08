/**
 * Finding pages, and fetching them.
 *
 * Sitemap first, link-crawl second. That order matters more than it looks: a
 * sitemap is the site telling you what it considers a page, so it excludes the
 * tag archives, paginated indexes and print views that a breadth-first crawl
 * happily embeds by the hundred. Crawling is the fallback, not the default.
 *
 * Nothing here renders JavaScript. A docs site that ships an empty <div id=app>
 * will produce empty pages, and `extract` reports that as a skipped page rather
 * than storing whitespace — see the note there. Adding Playwright is the fix,
 * and it is deliberately not in this dev-grade slice.
 */
import { XMLParser } from "fast-xml-parser"

const USER_AGENT =
  "FreddyAI-RAG/0.1 (docs ingestion for a customer's own site)"

export type CrawlOptions = {
  /** Hard stop on pages. A docs site with 40k URLs would otherwise run for
   *  hours and spend real money on embeddings before anyone noticed. */
  maxPages: number
  /** Politeness gap between requests to one host. */
  delayMs: number
  signal?: AbortSignal
}

export const DEFAULT_CRAWL: CrawlOptions = { maxPages: 100, delayMs: 150 }

const MAX_BODY_BYTES = 5_000_000

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
])

/**
 * Whether a hostname is a loopback, private, or link-local address — the
 * literal-IP shapes SSRF against internal services and cloud metadata
 * endpoints (`169.254.169.254`) actually uses.
 *
 * This is a literal check, not a DNS one: it does not resolve a public
 * hostname to see where it points, so a name that resolves to a private
 * address at request time (DNS rebinding) is not caught. Closing that needs a
 * fetch dispatcher that validates the resolved IP per-connection, which is
 * more than this dev-grade crawler takes on — see the file header.
 */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (BLOCKED_HOSTNAMES.has(host)) return true

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = v4.slice(1, 3).map(Number)
    if (a === 127 || a === 10 || a === 0) return true // loopback, RFC1918, "this host"
    if (a === 172 && b! >= 16 && b! <= 31) return true // RFC1918
    if (a === 192 && b === 168) return true // RFC1918
    if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
    return false
  }

  if (host === "::1" || host === "::") return true
  if (host.startsWith("fe80:")) return true // link-local
  if (host.startsWith("fc") || host.startsWith("fd")) return true // unique-local, fc00::/7

  return false
}

/** Refuses anything that isn't a public http(s) URL, before it is ever fetched. */
export function assertPublicUrl(url: string): void {
  const parsed = new URL(url)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("only http:// and https:// urls can be ingested")
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error("that host cannot be ingested")
  }
}

async function get(
  url: string,
  signal?: AbortSignal
): Promise<{ body: string; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,text/xml,*/*" },
      signal,
      redirect: "follow",
    })
    if (!res.ok) return null
    const contentType = res.headers.get("content-type") ?? ""
    // Guard before reading: a docs site linking a 40MB PDF should cost one
    // HEAD-shaped round trip, not a download into memory. `content-length` is
    // absent on chunked/compressed responses, so the read below is also
    // capped directly rather than trusting the header alone.
    const declared = Number(res.headers.get("content-length") ?? 0)
    if (declared > MAX_BODY_BYTES) return null

    const reader = res.body?.getReader()
    if (!reader) return { body: await res.text(), contentType }

    const decoder = new TextDecoder()
    let body = ""
    let bytes = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {})
        return null
      }
      body += decoder.decode(value, { stream: true })
    }
    body += decoder.decode()
    return { body, contentType }
  } catch {
    // A dead link mid-crawl is ordinary, not fatal. The caller counts it.
    return null
  }
}

/** Robots rules, reduced to the only question this asks: may I fetch that? */
function disallowedPaths(robotsBody: string): string[] {
  const out: string[] = []
  // Only the `*` group. Honouring a site's rules for our own named agent would
  // mean publishing the name first, which we have not.
  let inStar = false
  for (const line of robotsBody.split("\n")) {
    const [rawKey, ...rest] = line.split("#")[0]!.split(":")
    const key = (rawKey ?? "").trim().toLowerCase()
    const value = rest.join(":").trim()
    if (key === "user-agent") inStar = value === "*"
    else if (inStar && key === "disallow" && value) out.push(value)
  }
  return out
}

/** The `Sitemap:` lines robots.txt declares, in order. */
function declaredSitemaps(robotsBody: string): string[] {
  return robotsBody
    .split("\n")
    .map((l) => l.split("#")[0]!.trim())
    .filter((l) => l.toLowerCase().startsWith("sitemap:"))
    .map((l) => l.slice(l.indexOf(":") + 1).trim())
}

function allowed(url: string, disallowed: string[]): boolean {
  const path = new URL(url).pathname
  return !disallowed.some((rule) => path.startsWith(rule))
}

/**
 * Whether `url` sits inside the path the developer pointed the crawl at.
 *
 * Boundary-aware rather than a raw string prefix: `startsWith(origin + scope)`
 * would treat `/docs-legacy/foo` as inside a `/docs` scope, since one string
 * literally starts with the other. Requiring the next character be `/` (or an
 * exact match) is what a "path" actually means here.
 */
function inScope(url: string, origin: string, scopePath: string): boolean {
  let path: string
  try {
    const parsed = new URL(url)
    if (parsed.origin !== origin) return false
    path = parsed.pathname
  } catch {
    return false
  }
  if (scopePath === "" || scopePath === "/") return true
  return path === scopePath || path.startsWith(`${scopePath}/`)
}

async function sitemapUrls(
  origin: string,
  robotsBody: string,
  signal?: AbortSignal
): Promise<string[]> {
  const parser = new XMLParser({ ignoreAttributes: false })
  const seen = new Set<string>()

  const read = async (url: string, depth: number): Promise<void> => {
    if (depth > 2 || seen.size > 50_000) return
    const res = await get(url, signal)
    if (!res) return
    let doc: unknown
    try {
      doc = parser.parse(res.body)
    } catch {
      return
    }
    const root = doc as Record<string, { url?: unknown; sitemap?: unknown }>

    const entries = (value: unknown): { loc?: string }[] =>
      Array.isArray(value) ? value : value ? [value as { loc?: string }] : []

    // Sibling sitemap-index children have no dependency on one another, so
    // they are fetched together rather than one at a time.
    await Promise.all(
      entries(root.sitemapindex?.sitemap).map((entry) =>
        entry.loc ? read(entry.loc, depth + 1) : Promise.resolve()
      )
    )
    for (const entry of entries(root.urlset?.url)) {
      if (entry.loc) seen.add(entry.loc)
    }
  }

  // The three conventional locations, all tried: a site can declare more than
  // one sitemap in robots.txt (e.g. one per section), and stopping at the
  // first that resolves would silently drop the rest.
  const candidates = [
    ...declaredSitemaps(robotsBody),
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
  ]
  await Promise.all(candidates.map((url) => read(url, 0)))
  return [...seen]
}

/**
 * Every URL in a sitemap, following sitemap indexes one level down.
 *
 * Returns an empty array rather than throwing when there is no sitemap — the
 * caller treats that as "fall back to crawling", which is a normal outcome for
 * a hand-built help page.
 */
export async function fromSitemap(
  origin: string,
  signal?: AbortSignal
): Promise<string[]> {
  // robots.txt is authoritative for where the sitemap sits when it is not at
  // the root, which is common on hosted help centres.
  const robots = await get(`${origin}/robots.txt`, signal)
  return sitemapUrls(origin, robots?.body ?? "", signal)
}

/** Same-origin links from one HTML document, normalised and de-fragmented. */
function linksIn(html: string, base: string, origin: string): string[] {
  const out = new Set<string>()
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1]!, base)
      if (url.origin !== origin) continue
      // A fragment is the same page. Keeping them turns one docs page into
      // twenty near-identical entries, all embedding to nearly the same vector.
      url.hash = ""
      if (/\.(pdf|zip|png|jpe?g|svg|gif|webp|mp4|css|js)$/i.test(url.pathname))
        continue
      out.add(url.toString())
    } catch {
      // A malformed href is the page's problem, not ours.
    }
  }
  return [...out]
}

export type Fetched = { url: string; html: string }

export type CrawlProgress = (event: {
  kind: "discovered" | "fetched" | "skipped"
  url?: string
  total?: number
  done?: number
}) => void

/**
 * Walks a site and yields raw HTML, sitemap-first.
 *
 * An async generator rather than an array so the caller can extract, chunk and
 * embed as pages arrive. Buffering 100 pages of HTML before doing any work is
 * both slower to first result and the reason a long ingest looks hung.
 */
export async function* crawl(
  startUrl: string,
  options: CrawlOptions = DEFAULT_CRAWL,
  onProgress?: CrawlProgress
): AsyncGenerator<Fetched> {
  assertPublicUrl(startUrl)
  const start = new URL(startUrl)
  const origin = start.origin
  const scopePath = start.pathname.replace(/\/$/, "")

  // Fetched once and shared: robots.txt answers both "what may I fetch" and
  // "where is the sitemap", and fetching it twice cost every ingest an extra
  // round trip for no reason.
  const robots = await get(`${origin}/robots.txt`, options.signal)
  const disallowed = disallowedPaths(robots?.body ?? "")

  const sitemap = (
    await sitemapUrls(origin, robots?.body ?? "", options.signal)
  ).filter(
    (url) =>
      // Scoped to the path the developer pointed at: someone who typed
      // `/docs` wants the docs, not the marketing site and the blog.
      inScope(url, origin, scopePath) && allowed(url, disallowed)
  )

  const queue = sitemap.length ? [...sitemap] : [start.toString()]
  const crawling = sitemap.length === 0
  const seen = new Set(queue)
  let done = 0

  onProgress?.({ kind: "discovered", total: queue.length })

  while (queue.length && done < options.maxPages) {
    if (options.signal?.aborted) return
    const url = queue.shift()!
    const res = await get(url, options.signal)
    if (options.delayMs)
      await new Promise((resolve) => setTimeout(resolve, options.delayMs))

    if (!res || !res.contentType.includes("html")) {
      onProgress?.({ kind: "skipped", url })
      continue
    }

    done++
    onProgress?.({ kind: "fetched", url, done, total: seen.size })
    yield { url, html: res.body }

    // Only widen the frontier when there was no sitemap to trust.
    if (crawling) {
      for (const link of linksIn(res.body, url, origin)) {
        if (seen.has(link) || !allowed(link, disallowed)) continue
        if (!inScope(link, origin, scopePath)) continue
        seen.add(link)
        queue.push(link)
      }
    }
  }
}
