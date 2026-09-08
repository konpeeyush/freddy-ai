import { getWeather } from "./weather"
import { convertCurrency } from "./currency"
import { getCryptoPrice } from "./crypto"
import { lookupArticle } from "./article"
import { captureLead } from "./lead"
import { findPlaces } from "./places"
import { findStays } from "./stays"

export type { DevTool, DevToolMeta } from "./types"

/*
 * The demo tools, as the host page defines them.
 *
 * One place naming every tool, so the playground's toggle list and the set
 * actually registered cannot drift apart — both are derived from this array.
 * Order is display order.
 *
 * These are client-side: the definition goes up with each request and the
 * handler runs here, which is the whole point of the demo — nothing about
 * them needs a deploy to change.
 *
 * All but `captureLead` call a real API — no key, no quota, CORS open, so
 * they work unchanged from a customer's page. That matters more than it
 * sounds: a tool returning fixed data cannot show you that a card re-rendered
 * rather than being restored from history, and a chart cannot be judged
 * against numbers that never move.
 *
 * `captureLead` and `findStays` are the exceptions. A lead has no public
 * endpoint to post to, and no hotel API works without a server-side key — so
 * one stores locally and the other generates its options. Both are marked as
 * such where they are defined; neither pretends to be an integration.
 */
export const DEV_TOOLS = [
  getWeather,
  convertCurrency,
  getCryptoPrice,
  lookupArticle,
  findPlaces,
  findStays,
  captureLead,
]

export {
  getWeather,
  convertCurrency,
  getCryptoPrice,
  lookupArticle,
  findPlaces,
  findStays,
  captureLead,
}
