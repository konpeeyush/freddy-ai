import { widget } from "@workspace/api"

import type { DevTool } from "./types"

/*
 * Places to stay.
 *
 * The second demo tool with no external API, and unlike `captureLead` the
 * reason is not that the data has nowhere to go — it is that no free, keyless
 * hotel API exists. Booking, Expedia and the rest all require an account and
 * a server-side key, which is exactly what the client-tool design cannot use.
 *
 * So the options are generated rather than fetched, and this comment is the
 * honest note that they are not real inventory. What it demonstrates is still
 * real: a comparable list, a choice the visitor makes, and a widget that
 * moves to a chosen state — none of which needs live prices to exercise.
 *
 * The neighbourhoods ARE real, drawn from the city name, so a visitor sees
 * something coherent rather than "Hotel One, Hotel Two".
 */

/*
 * Shaped like inventory rather than random.
 *
 * Three tiers, because the interesting thing about a comparison list is that
 * the options differ on more than one axis — a cheap one further out, a
 * middle one, a expensive one central. Randomised prices alone would produce
 * three indistinguishable cards and prove nothing about the layout.
 */
const TIERS = [
  {
    suffix: "Central Rooms",
    area: "City centre",
    rating: 4.6,
    multiplier: 1.5,
    note: "Walkable to most of the old town.",
  },
  {
    suffix: "Riverside Hotel",
    area: "Riverside",
    rating: 4.3,
    multiplier: 1.0,
    note: "Quieter, ten minutes from the centre by tram.",
  },
  {
    suffix: "Garden Guesthouse",
    area: "Old quarter",
    rating: 4.1,
    multiplier: 0.7,
    note: "Small, family-run, breakfast included.",
  },
]

/** Currency symbols for the codes a visitor is most likely to give. */
const SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹",
  JPY: "¥",
  AUD: "A$",
  CAD: "C$",
  HUF: "Ft",
}

export const findStays: DevTool = {
  definition: {
    name: "findStays",
    description:
      "Show a few places to stay in a city, with prices and ratings, that " +
      "the visitor can pick from. Use when someone asks where to stay, about " +
      "hotels or accommodation, or is planning a trip and needs somewhere to " +
      "sleep. Ask which city if none was named.",
    inputSchema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          minLength: 1,
          description: "City name, e.g. 'Budapest'",
        },
        currency: {
          type: "string",
          description:
            "Three-letter code to price in, e.g. 'EUR', 'INR'. Use the " +
            "visitor's own currency when it is known. Defaults to EUR.",
        },
      },
      required: ["city"],
    },
    handler(input) {
      const city = typeof input.city === "string" ? input.city.trim() : ""
      if (!city) return { error: "No city was given." }

      const code =
        typeof input.currency === "string" && input.currency.trim()
          ? input.currency.trim().toUpperCase().slice(0, 3)
          : "EUR"
      const symbol = SYMBOLS[code] ?? ""

      /*
       * A stable base per city, so asking twice gives the same prices.
       * Prices that changed between two identical questions would make the
       * demo look broken in the one way a visitor would definitely notice.
       */
      const seed = [...city.toLowerCase()].reduce(
        (total, char) => total + char.charCodeAt(0),
        0
      )
      const base = 80 + (seed % 60)

      const stays = TIERS.map((tier) => ({
        name: `${city} ${tier.suffix}`,
        area: tier.area,
        price: `${symbol}${Math.round(base * tier.multiplier)}${symbol ? "" : ` ${code}`}`,
        rating: tier.rating,
        note: tier.note,
      }))

      return widget(
        "stay_options",
        { heading: `Where to stay in ${city}`, stays },
        {
          summary:
            `Showed ${stays.length} places to stay in ${city} — ` +
            `${stays.map((s) => `${s.name} at ${s.price}`).join(", ")} — each ` +
            `with a Choose button. The visitor can see these and has not ` +
            `picked one yet: do not list them again, and do not assume a ` +
            `choice until they make it.`,
        }
      )
    },
  },

  meta: {
    name: "findStays",
    label: "Places to stay",
    summary:
      "A comparable list with a choice. Generated, not live inventory — no " +
      "hotel API works without a server-side key.",
    widget: "stay_options",
    example: "where should I stay in Budapest?",
    defaultEnabled: true,
  },
}
