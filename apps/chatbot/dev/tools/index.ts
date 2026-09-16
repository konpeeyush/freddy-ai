import { getWeather } from "./weather"
import { convertCurrency } from "./currency"
import { getCryptoPrice } from "./crypto"
import { lookupArticle } from "./article"
import { captureLead } from "./lead"
import { findPlaces } from "./places"
import { findStays } from "./stays"

export type { DevTool, DevToolMeta } from "./types"

/*
 * The demo tools, as the playground toggles them.
 *
 * One place naming every tool, so the playground's toggle list and the set
 * actually registered cannot drift apart — both are derived from this array.
 * Order is display order.
 *
 * These are client-side: the definition goes up with each request and the
 * handler runs here, which is the whole point of the demo — nothing about
 * them needs a deploy to change.
 *
 * `getWeather`, `convertCurrency`, `getCryptoPrice`, `lookupArticle` and
 * `findPlaces` are re-exports of `src/tools/stock`, which every install
 * registers by default — this file only adds the playground's toggle row
 * and example prompt on top. `captureLead` and `findStays` exist only here:
 * a lead has no public endpoint to post to, and no hotel API works without a
 * server-side key, so one stores locally and the other generates its
 * options. Neither pretends to be an integration, and shipping fabricated
 * data by default in production would be a worse surprise than shipping
 * nothing.
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
