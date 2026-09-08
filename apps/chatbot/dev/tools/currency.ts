import { widget } from "@workspace/api"

import type { DevTool } from "./types"

/*
 * Currency conversion.
 *
 * Real rates from Frankfurter, which publishes the European Central Bank's
 * daily reference rates. No key, no quota, CORS open — so a handler on a
 * customer's page can call it directly, which is the point of the demo.
 *
 * The reason this tool exists rather than a fourth card: it returns a *series*
 * as well as a number, which is the only stock tool that does. A chart cannot
 * be tested with data that never changes.
 */

const API = "https://api.frankfurter.dev/v1"

/** ECB publishes on working days only, so a month of history is ~22 points. */
const HISTORY_DAYS = 30

type LatestResponse = {
  amount?: number
  base?: string
  date?: string
  rates?: Record<string, number>
}

type SeriesResponse = {
  rates?: Record<string, Record<string, number>>
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

/** `2026-08-28` → `28 Aug`, for axis labels that fit. */
function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString("en", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
}

export const convertCurrency: DevTool = {
  definition: {
    name: "convertCurrency",
    description:
      "Convert an amount between two currencies at today's rate, and show " +
      "how the rate has moved over the last month. Use whenever someone asks " +
      "what an amount is worth in another currency, about an exchange rate, " +
      "or whether a rate is up or down. Ask which currencies if they were " +
      "not named — never guess a pair.",
    inputSchema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Three-letter code to convert from, e.g. 'USD'",
        },
        to: {
          type: "string",
          description: "Three-letter code to convert to, e.g. 'INR'",
        },
        amount: {
          type: "number",
          description: "How much to convert. Defaults to 1 when not given.",
        },
      },
      required: ["from", "to"],
    },

    async handler(input) {
      const from = String(input.from ?? "").toUpperCase()
      const to = String(input.to ?? "").toUpperCase()
      const amount = isNumber(input.amount) ? input.amount : 1

      if (from === to) {
        // Returned rather than thrown: the model can say something sensible
        // about it, where a thrown error would just break the turn.
        return { error: `${from} and ${to} are the same currency.` }
      }

      try {
        const start = new Date()
        start.setUTCDate(start.getUTCDate() - HISTORY_DAYS)
        const startDate = start.toISOString().slice(0, 10)

        /*
         * Both calls at once. They are independent, and the visitor is
         * watching a spinner for however long the slower one takes.
         */
        const [latestRaw, seriesRaw] = await Promise.all([
          fetch(`${API}/latest?base=${from}&symbols=${to}`).then((r) =>
            r.json()
          ) as Promise<LatestResponse>,
          fetch(`${API}/${startDate}..?base=${from}&symbols=${to}`).then((r) =>
            r.json()
          ) as Promise<SeriesResponse>,
        ])

        const rate = latestRaw.rates?.[to]
        if (!isNumber(rate)) {
          /*
           * The usual cause is a code the ECB does not publish — Frankfurter
           * covers about 30 currencies, so this is a normal miss rather than
           * a failure, and the model should say which pair failed.
           */
          return {
            error:
              `I couldn't get a rate for ${from} to ${to}. One of those may ` +
              `not be a currency this service covers.`,
          }
        }

        const series = Object.entries(seriesRaw.rates ?? {})
          .map(([date, rates]) => ({ date, value: rates?.[to] }))
          .filter((point): point is { date: string; value: number } =>
            isNumber(point.value)
          )
          .sort((a, b) => a.date.localeCompare(b.date))

        const first = series[0]?.value
        const changePercent =
          isNumber(first) && first !== 0 ? ((rate - first) / first) * 100 : 0

        /*
         * The period's range, alongside the change.
         *
         * A start-to-end comparison says nothing when the two happen to
         * coincide — a rate that moved all month reads as "+0.00%", which
         * looks like a broken card rather than a true statement. The high and
         * low always describe the period, so the card has something to say
         * either way.
         */
        const values = series.map((point) => point.value)
        const low = values.length ? Math.min(...values) : rate
        const high = values.length ? Math.max(...values) : rate

        const converted = amount * rate

        return widget(
          "exchange_rate",
          {
            from,
            to,
            amount,
            pair: `${from} → ${to}`,
            /*
             * Composed here, not in the tree: the widget runtime has no string
             * concatenation, so a headline made of several values has to
             * arrive as one.
             */
            converted: `${amount.toLocaleString("en-US")} ${from} = ${converted.toLocaleString(
              "en-US",
              { minimumFractionDigits: 2, maximumFractionDigits: 2 }
            )} ${to}`,
            rate,
            date: latestRaw.date ?? "",
            /*
             * Signed and suffixed here for the same reason, and the direction
             * lifted into its own field: `when` can test equality but cannot
             * compare a number to zero, so colouring by sign needs the sign
             * stated rather than derived.
             */
            changePercent: `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`,
            changeDirection: changePercent >= 0 ? "up" : "down",
            low,
            high,
            history: values,
            historyLabels: series.map((point) => shortDate(point.date)),
          },
          {
            summary:
              `Showed a conversion card: ${amount} ${from} is ` +
              `${converted.toFixed(2)} ${to} at ${rate.toFixed(4)}, ` +
              `${changePercent >= 0 ? "up" : "down"} ` +
              `${Math.abs(changePercent).toFixed(2)}% over the last month ` +
              `(range ${low.toFixed(2)}–${high.toFixed(2)}), with a chart of ` +
              `the period. The visitor can see all of it, so ` +
              `acknowledge briefly rather than repeating the numbers.`,
          }
        )
      } catch {
        return {
          error:
            "The exchange-rate service didn't respond. Say so and offer to " +
            "try again.",
        }
      }
    },
  },

  meta: {
    name: "convertCurrency",
    label: "Currency",
    summary: "Live ECB rates with a month of history, drawn as a chart.",
    widget: "exchange_rate",
    example: "what's 500 USD in INR?",
    defaultEnabled: true,
  },
}
