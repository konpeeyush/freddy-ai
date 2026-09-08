import type { WidgetDefinition } from "../tree"

/*
 * Places to stay, as a choosable list.
 *
 * The counterpart to `place_carousel`: that one is browsing, this one is
 * deciding. A vertical list rather than a carousel because the cards are
 * being *compared* on price and rating — numbers read down a column and get
 * lost across a scroll — and because a choice the visitor must make should
 * not require swiping to discover its options.
 *
 * Two states, like `lead_capture`, and for the same reason: once a stay is
 * chosen the list has done its job, and leaving three buttons live invites a
 * second pick the conversation has already moved past.
 */

export const stayOptionsWidget: WidgetDefinition = {
  id: "stay_options",
  version: 1,
  enabled: true,
  name: "Stay options",
  description:
    "A short list of places to stay, each with a price and rating, that the " +
    "visitor can pick from. Shows the chosen one once they have.",

  schema: {
    type: "object",
    properties: {
      heading: {
        type: "string",
        description: "One short line above the list, e.g. 'Where to stay'",
      },
      /*
       * Drives `stateBy`, and a boolean rather than the chosen name.
       *
       * `stateBy` maps a stringified value through a fixed table, so a free
       * value — any hotel name — misses every key and lands on `default`.
       * The flag is what branches; the name below is what gets shown.
       */
      picked: {
        type: "boolean",
        description:
          "True once the visitor has chosen. Leave unset when first showing " +
          "the list.",
      },
      chosen: {
        type: "string",
        description: "The name of the stay they picked, shown once they have.",
      },
      chosenNote: {
        type: "string",
        description: "One line confirming the choice, shown after they pick.",
      },
      stays: {
        type: "array",
        description: "The options, best first.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name of the hotel or area" },
            area: { type: "string", description: "Neighbourhood or district" },
            /** Pre-formatted with its currency — the tree cannot join them. */
            price: {
              type: "string",
              description: "Price per night including the symbol, e.g. '€120'",
            },
            rating: {
              type: "number",
              description: "Out of 5, e.g. 4.5. Drawn as stars.",
            },
            note: { type: "string", description: "One short selling line" },
            image: { type: "string", description: "Photo URL, when there is one" },
          },
          required: ["name"],
        },
      },
    },
    required: ["stays"],
  },

  stateBy: { $bind: "$.picked", map: { true: "chosen", default: "picking" } },

  states: {
    picking: {
      type: "Col",
      props: { gap: 2, align: "start", width: "100%" },
      children: [
        {
          type: "Text",
          when: { $bind: "$.heading" },
          props: { value: { $bind: "$.heading" }, size: "sm", weight: "medium" },
        },
        {
          type: "Card",
          repeat: { over: "$.stays", as: "item", key: "$item.name", limit: 8 },
          props: { padding: 3, radius: "lg", width: "100%" },
          children: [
            {
              type: "Row",
              props: { gap: 3, align: "start", justify: "between", width: "100%" },
              children: [
                {
                  type: "Col",
                  props: { gap: 1, align: "start" },
                  children: [
                    {
                      type: "Title",
                      props: { value: { $bind: "$item.name" }, size: "sm" },
                    },
                    {
                      type: "Caption",
                      when: { $bind: "$item.area" },
                      props: {
                        value: { $bind: "$item.area" },
                        size: "xs",
                        color: "tertiary",
                      },
                    },
                    {
                      type: "Rating",
                      when: { $bind: "$item.rating" },
                      props: { value: { $bind: "$item.rating" }, max: 5, size: "sm" },
                    },
                    {
                      type: "Caption",
                      when: { $bind: "$item.note" },
                      props: {
                        value: { $bind: "$item.note" },
                        size: "xs",
                        color: "tertiary",
                        maxLines: 2,
                      },
                    },
                  ],
                },
                {
                  type: "Col",
                  props: { gap: 2, align: "end" },
                  children: [
                    {
                      type: "Text",
                      when: { $bind: "$item.price" },
                      props: {
                        value: { $bind: "$item.price" },
                        size: "sm",
                        weight: "medium",
                      },
                    },
                    {
                      type: "Button",
                      props: {
                        label: "Choose",
                        variant: "primary",
                        size: "sm",
                        onClickAction: {
                          /*
                           * `emit` rather than `submit`: there is no form
                           * here, and the choice is the click itself. The
                           * name travels as an additional input so the host —
                           * or the AI fallback — knows which card was picked.
                           */
                          kind: "emit",
                          functionName: "chooseStay",
                          additionalInputs: {
                            name: { $bind: "$item.name" },
                            price: { $bind: "$item.price" },
                          },
                          loadingBehavior: "widget",
                        },
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

    chosen: {
      type: "Card",
      props: { padding: 4, radius: "xl", gap: 2 },
      children: [
        {
          type: "Row",
          props: { gap: 2, align: "center" },
          children: [
            { type: "Icon", props: { name: "check", size: 18, color: "#16a34a" } },
            {
              type: "Title",
              props: { value: { $bind: "$.chosen" }, size: "sm" },
            },
          ],
        },
        {
          type: "Text",
          when: { $bind: "$.chosenNote" },
          props: {
            value: { $bind: "$.chosenNote" },
            size: "sm",
            color: "secondary",
          },
        },
      ],
    },
  },
}
