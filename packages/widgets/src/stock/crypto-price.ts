import type { WidgetDefinition } from "../tree"

/*
 * Crypto prices.
 *
 * The "several of the same thing, scanned rather than read" shape. Where the
 * plans carousel wants tiers side by side to be compared, a watchlist wants
 * them stacked: the visitor is looking for one row, not weighing five against
 * each other, and a vertical list is what lets the eye run down a column of
 * prices.
 *
 * Deliberately compact — no card per coin, no sparkline per row. A widget that
 * answers "what is Bitcoin at" should take four lines of the transcript, not
 * fill the panel. The chart belongs in the exchange-rate widget, where a
 * single series is the whole subject.
 */

export const cryptoPriceWidget: WidgetDefinition = {
  id: "crypto_price",
  version: 1,
  enabled: true,
  name: "Crypto prices",
  description:
    "Current prices for one or more cryptocurrencies, as a compact list " +
    "with each coin's 24-hour move.",

  schema: {
    type: "object",
    properties: {
      coins: {
        type: "array",
        description:
          "The coins to show, most relevant first. One entry is fine — a " +
          "single-row list still reads better than a sentence with a number " +
          "buried in it.",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Stable identifier, e.g. 'bitcoin'",
            },
            name: { type: "string", description: "e.g. 'Bitcoin'" },
            symbol: {
              type: "string",
              description: "Ticker, e.g. 'BTC'",
            },
            price: {
              type: "object",
              description: "Current price",
              properties: {
                amount: { type: "number" },
                currency: {
                  type: "string",
                  description: "ISO 4217 code, e.g. 'USD'",
                },
              },
              required: ["amount", "currency"],
            },
            changePercent: {
              type: "string",
              description:
                "24-hour move, already signed and suffixed, e.g. '+2.4%'",
            },
            /*
             * The sign as its own field. `when` tests a path against a literal
             * and cannot compare a number to zero, so a template can only
             * colour by direction if the direction is stated in the data.
             */
            changeDirection: {
              type: "string",
              enum: ["up", "down"],
              description:
                "'up' when changePercent is zero or positive, 'down' when " +
                "negative",
            },
            marketCap: {
              type: "string",
              description: "Abbreviated market cap, e.g. '$1.2T'",
            },
          },
          required: ["id", "name", "symbol", "price"],
        },
      },
    },
    required: ["coins"],
  },

  states: {
    default: {
      type: "ListView",
      props: { status: { text: "Prices", icon: "price" }, gap: 2 },
      children: [
        {
          type: "Card",
          props: { padding: 3 },
          repeat: { over: "$.coins", as: "item", key: "$item.id", limit: 20 },
          children: [
            {
              type: "Row",
              props: { gap: 3, align: "center", justify: "between" },
              children: [
                {
                  type: "Col",
                  props: { gap: 1, align: "start" },
                  children: [
                    {
                      type: "Row",
                      props: { gap: 2, align: "center" },
                      children: [
                        {
                          type: "Title",
                          props: { value: { $bind: "$item.name" }, size: "sm" },
                        },
                        {
                          /*
                           * The ticker as a badge, not a caption. It is an
                           * identifier rather than prose, and setting it apart
                           * stops it reading as the start of the sentence the
                           * market cap finishes.
                           */
                          type: "Badge",
                          props: {
                            label: { $bind: "$item.symbol" },
                            color: "neutral",
                            size: "sm",
                          },
                        },
                      ],
                    },
                    {
                      type: "Caption",
                      when: { $bind: "$item.marketCap" },
                      props: {
                        value: { $bind: "$item.marketCap" },
                        size: "xs",
                        color: "tertiary",
                      },
                    },
                  ],
                },
                {
                  type: "Col",
                  props: { gap: 1, align: "end" },
                  children: [
                    {
                      type: "Text",
                      props: {
                        value: { $bind: "$item.price", format: "money" },
                        size: "md",
                        weight: "semibold",
                      },
                    },
                    // Same two-Badge branch as the exchange-rate widget: one
                    // `is` test and its inverse, because there is nothing in
                    // the tree that can evaluate a comparison.
                    {
                      type: "Badge",
                      when: { $bind: "$item.changeDirection", is: "down" },
                      props: {
                        label: { $bind: "$item.changePercent" },
                        color: "danger",
                        pill: true,
                        size: "sm",
                      },
                    },
                    {
                      type: "Badge",
                      when: {
                        $bind: "$item.changeDirection",
                        is: "down",
                        not: true,
                      },
                      props: {
                        label: { $bind: "$item.changePercent" },
                        color: "success",
                        pill: true,
                        size: "sm",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
}
