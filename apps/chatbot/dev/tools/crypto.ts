import { widget } from "@workspace/api"

import type { DevTool } from "./types"

/*
 * Crypto prices.
 *
 * Live from CoinGecko's public endpoint — no key, CORS open. Included because
 * it is the one tool here whose data visibly changes between two calls a
 * minute apart, which makes it the honest way to check that a card is being
 * re-rendered rather than restored from a cached message.
 *
 * It also exercises a conditional: the change badge is green or red depending
 * on a sign, and the widget runtime has no expressions, so that is two nodes
 * gated by `when` rather than one node with a computed colour.
 */

const API = "https://api.coingecko.com/api/v3/simple/price"

/*
 * Names the model is likely to produce, mapped to CoinGecko's ids. Sending
 * "bitcoin" works; sending "BTC" silently returns nothing, which would read
 * as "the tool is broken" rather than "that is not an id".
 */
const IDS: Record<string, string> = {
  btc: "bitcoin",
  bitcoin: "bitcoin",
  eth: "ethereum",
  ethereum: "ethereum",
  sol: "solana",
  solana: "solana",
  ada: "cardano",
  cardano: "cardano",
  xrp: "ripple",
  ripple: "ripple",
  doge: "dogecoin",
  dogecoin: "dogecoin",
}

/** Tickers, which the card shows beside the name. */
const SYMBOLS: Record<string, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
  cardano: "ADA",
  ripple: "XRP",
  dogecoin: "DOGE",
}

/** `1566315501987` → `$1.57T`. A full market cap is unreadable in a row. */
function abbreviate(value: number): string {
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
  ]
  for (const [size, suffix] of units) {
    if (value >= size) return `$${(value / size).toFixed(2)}${suffix}`
  }
  return `$${Math.round(value).toLocaleString("en-US")}`
}

type PriceResponse = Record<
  string,
  { usd?: number; usd_24h_change?: number; usd_market_cap?: number }
>

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

/** "Bitcoin" from "bitcoin"; good enough for ids that are plain words. */
function titleCase(id: string): string {
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export const getCryptoPrice: DevTool = {
  definition: {
    name: "getCryptoPrice",
    description:
      "Get the current price of one or more cryptocurrencies in US dollars, " +
      "with how much each has moved in the last 24 hours. Use when someone " +
      "asks what a coin is worth, how it is doing, or whether it is up or " +
      "down. Ask which coin if none was named.",
    inputSchema: {
      type: "object",
      properties: {
        coins: {
          type: "array",
          items: { type: "string" },
          description:
            "Coin names or symbols, e.g. ['bitcoin', 'eth']. At most five.",
        },
      },
      required: ["coins"],
    },

    async handler(input) {
      const asked = Array.isArray(input.coins) ? input.coins : []
      const ids = [
        ...new Set(
          asked
            .filter((c): c is string => typeof c === "string")
            .map((c) => IDS[c.trim().toLowerCase()] ?? c.trim().toLowerCase())
            .filter(Boolean)
        ),
        // Five is a card, twenty is a spreadsheet — and the row list has no
        // scroll of its own.
      ].slice(0, 5)

      if (ids.length === 0) {
        return { error: "Ask which coin they mean — none was recognised." }
      }

      try {
        const raw = (await fetch(
          `${API}?ids=${ids.join(",")}&vs_currencies=usd` +
            `&include_24hr_change=true&include_market_cap=true`
        ).then((r) => r.json())) as PriceResponse

        const coins = ids
          .map((id) => {
            const entry = raw[id]
            if (!entry || !isNumber(entry.usd)) return null
            const change = isNumber(entry.usd_24h_change)
              ? Number(entry.usd_24h_change.toFixed(2))
              : 0
            return {
              id,
              name: titleCase(id),
              symbol: SYMBOLS[id] ?? id.slice(0, 4).toUpperCase(),
              // An object, so the card can format the amount for its currency
              // rather than being handed a pre-formatted string it cannot align.
              price: { amount: entry.usd, currency: "USD" },
              /*
               * Signed here, and the direction lifted into its own field:
               * `when` cannot compare a number to zero, so a template can
               * only colour by sign if the sign is stated.
               */
              changePercent: `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`,
              changeDirection: change >= 0 ? ("up" as const) : ("down" as const),
              marketCap: isNumber(entry.usd_market_cap)
                ? abbreviate(entry.usd_market_cap)
                : undefined,
            }
          })
          .filter((coin): coin is NonNullable<typeof coin> => coin !== null)

        if (coins.length === 0) {
          return {
            error:
              `I couldn't find prices for ${ids.join(", ")}. Ask them to ` +
              `check the name — full names like "bitcoin" work best.`,
          }
        }

        return widget(
          "crypto_price",
          { coins },
          {
            summary:
              `Showed a price card for ${coins
                .map(
                  (c) =>
                    `${c.name} at ` +
                    `$${c.price.amount.toLocaleString("en-US")} ` +
                    `(${c.changePercent} in 24h)`
                )
                .join(", ")}. The visitor can read the figures, so acknowledge ` +
              `briefly rather than restating them.`,
          }
        )
      } catch {
        return {
          error:
            "The price service didn't respond. Say so and offer to try again.",
        }
      }
    },
  },

  meta: {
    name: "getCryptoPrice",
    label: "Crypto prices",
    summary: "Live prices and 24h change, as a list with coloured badges.",
    widget: "crypto_price",
    example: "how are bitcoin and ethereum doing?",
    defaultEnabled: true,
  },
}
