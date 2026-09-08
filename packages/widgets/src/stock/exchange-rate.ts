import type { WidgetDefinition } from "../tree"

/*
 * Exchange rate.
 *
 * The reference for "a number is only meaningful next to its trend". A
 * conversion on its own is a fact the visitor has to take on trust; the same
 * conversion above a fortnight of history tells them whether today is a good
 * day to move money, which is the question actually being asked.
 *
 * The only stock widget that uses Chart. A sparkline is the cheapest possible
 * answer to "is this going up or down" — cheaper than the sentence a prose
 * tool would have to write, and it cannot be wrong about the direction.
 *
 * The `converted` string is pre-composed by whoever produced the data rather
 * than assembled from `amount`/`from`/`to` here. There is no concatenation in
 * the tree — a headline built from four separate Text nodes would wrap at the
 * wrong places in a narrow panel, and the currency's own decimal convention is
 * the producer's business, not the template's.
 */

export const exchangeRateWidget: WidgetDefinition = {
  id: "exchange_rate",
  version: 1,
  enabled: true,
  name: "Exchange rate",
  description:
    "Convert an amount between two currencies and show the rate, when it " +
    "was quoted, how it has moved, and a short history sparkline.",

  schema: {
    type: "object",
    properties: {
      from: {
        type: "string",
        description: "Source currency, ISO 4217 code, e.g. 'USD'",
      },
      to: {
        type: "string",
        description: "Target currency, ISO 4217 code, e.g. 'INR'",
      },
      amount: { type: "number", description: "Amount in the source currency" },
      /*
       * The pair as a label, e.g. "USD → INR". Pre-composed because the tree
       * cannot join strings, and separate from `converted` so the card can
       * lead with what it is before what it equals.
       */
      pair: { type: "string", description: "e.g. 'USD → INR'" },
      converted: {
        type: "string",
        description:
          "The full headline, already formatted for the target currency's " +
          "own convention, e.g. '500 USD = 43,210.50 INR'",
      },
      rate: {
        type: "number",
        description: "Units of `to` per one unit of `from`",
      },
      /*
       * The period's range. A start-to-end change says nothing when the two
       * ends happen to coincide — a rate that moved all month reads as
       * "+0.00%" — so the card also states the ground it actually covered.
       */
      low: { type: "number", description: "Lowest rate over the period" },
      high: { type: "number", description: "Highest rate over the period" },
      date: {
        type: "string",
        description: "ISO date the rate was quoted",
      },
      changePercent: {
        type: "string",
        description:
          "Move over the period covered by `history`, already signed and " +
          "suffixed, e.g. '+1.2%' or '-0.4%'",
      },
      /*
       * The sign, lifted out as its own field. `when` tests truthiness or
       * equality against a path — it cannot compare a number to zero — so the
       * only way to colour by direction is to have the producer state the
       * direction. Kept as an enum so the model cannot invent a third value.
       */
      changeDirection: {
        type: "string",
        enum: ["up", "down"],
        description:
          "'up' when changePercent is zero or positive, 'down' when negative",
      },
      history: {
        type: "array",
        description:
          "Rate at each point in the period, oldest first. Seven to fourteen " +
          "points reads well at the panel's width.",
        items: { type: "number" },
      },
      historyLabels: {
        type: "array",
        description:
          "Short axis labels, one per `history` point and in the same order. " +
          "Omit entirely rather than supplying a partial set.",
        items: { type: "string" },
      },
    },
    required: ["from", "to", "amount", "converted", "rate"],
  },

  states: {
    default: {
      type: "Card",
      props: { padding: 4 },
      children: [
        {
          type: "Col",
          props: { gap: 3 },
          children: [
            /*
             * Three tiers, in the order the eye reads them: what this is, the
             * answer, then the evidence. The first version led with the
             * converted amount and left the pair implicit in it, which made
             * a long headline the largest thing on the card and gave the
             * badge nothing to sit against.
             */
            {
              type: "Row",
              props: { gap: 2, align: "center", justify: "between" },
              children: [
                {
                  type: "Caption",
                  props: {
                    value: { $bind: "$.pair" },
                    size: "xs",
                    color: "tertiary",
                  },
                },
                // Two Badges under opposing `is` tests rather than one with a
                // bound colour: `when` compares a path to a literal and
                // nothing more, which is also why the sign is its own field —
                // truthiness cannot tell -0.4 from +1.2.
                {
                  type: "Badge",
                  when: { $bind: "$.changeDirection", is: "down" },
                  props: {
                    label: { $bind: "$.changePercent" },
                    color: "danger",
                    pill: true,
                    size: "sm",
                  },
                },
                {
                  type: "Badge",
                  when: { $bind: "$.changeDirection", is: "down", not: true },
                  props: {
                    label: { $bind: "$.changePercent" },
                    color: "success",
                    pill: true,
                    size: "sm",
                  },
                },
              ],
            },
            {
              type: "Title",
              props: { value: { $bind: "$.converted" }, size: "xl" },
            },
            {
              /*
               * Line rather than bar: a rate is a continuous series, and bars
               * anchored at zero compress a month's movement into a flat
               * block.
               */
              type: "Chart",
              when: { $bind: "$.history" },
              props: {
                type: "line",
                data: { $bind: "$.history" },
                labels: { $bind: "$.historyLabels" },
                height: 72,
                label: "Recent rate history",
              },
            },
            {
              /*
               * The footing under the chart: what one unit is worth, the
               * ground the period covered, and when it was quoted. Each is
               * its own Caption because the tree cannot join strings.
               */
              type: "Row",
              props: { gap: 3, align: "center", justify: "between" },
              children: [
                {
                  type: "Row",
                  props: { gap: 1, align: "center" },
                  children: [
                    {
                      type: "Caption",
                      props: { value: "Low", size: "xs", color: "tertiary" },
                    },
                    {
                      type: "Caption",
                      props: {
                        value: { $bind: "$.low", format: "number" },
                        size: "xs",
                        color: "secondary",
                      },
                    },
                    {
                      type: "Caption",
                      props: { value: "High", size: "xs", color: "tertiary" },
                    },
                    {
                      type: "Caption",
                      props: {
                        value: { $bind: "$.high", format: "number" },
                        size: "xs",
                        color: "secondary",
                      },
                    },
                  ],
                },
                {
                  // Hidden when the quote is undated: no date at all beats one
                  // implying a freshness the data cannot prove.
                  type: "Caption",
                  when: { $bind: "$.date" },
                  props: {
                    value: { $bind: "$.date", format: "date" },
                    size: "xs",
                    color: "tertiary",
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  },
}
