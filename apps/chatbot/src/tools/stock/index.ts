import { lookupArticle } from "./article"
import { getCryptoPrice } from "./crypto"
import { convertCurrency } from "./currency"
import { findPlaces } from "./places"
import { getWeather } from "./weather"

/*
 * Stock tools.
 *
 * The counterpart to `STOCK_WIDGETS` (`@workspace/widgets`): each of these
 * backs one of the stock widgets with a real, keyless, CORS-open API, so a
 * fresh install can show live data without the host page writing a line of
 * tool code.
 *
 * Registered by default in `mount()`, same as `STOCK_WIDGETS` — a host page
 * can still override any of these by calling `FreddyChat.registerTool` with
 * the same name, which replaces the entry in the registry's map.
 *
 * `lead_capture` and `stay_options` are deliberately not here: a lead has no
 * public endpoint to post to, and no hotel API works without a server-side
 * key, so both are synthetic. Shipping fabricated data as a default,
 * unannounced behaviour is a different thing from shipping a live read —
 * those stay opt-in, for a host page that wants the widget shape and is
 * ready to wire its own backend behind it.
 */
export const STOCK_TOOLS = [
  getWeather,
  convertCurrency,
  getCryptoPrice,
  lookupArticle,
  findPlaces,
]

export { getWeather, convertCurrency, getCryptoPrice, lookupArticle, findPlaces }
