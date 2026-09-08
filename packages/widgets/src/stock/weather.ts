import type { WidgetDefinition } from "../tree"

/*
 * Weather card.
 *
 * The reference for "an existing prose tool becomes a widget". `getWeather`
 * already returned structured data — temperature, conditions, humidity — and
 * was being flattened into a sentence. The data was always there; only the
 * presentation changes.
 *
 * Single state: weather has no interaction, so there is nothing to move
 * between. `stateBy` is omitted and the one state renders unconditionally.
 */

export const weatherWidget: WidgetDefinition = {
  id: "weather_card",
  version: 1,
  enabled: true,
  name: "Weather card",
  description:
    "Current conditions for one city, as a card with the temperature, a " +
    "description, and the supporting readings.",

  schema: {
    type: "object",
    properties: {
      city: { type: "string", description: "City name" },
      region: { type: "string", description: "State or region, when known" },
      celsius: { type: "number", description: "Current temperature in °C" },
      condition: {
        type: "string",
        description: "Plain-language conditions, e.g. 'partly cloudy'",
      },
      /*
       * One name per kind of sky. A single "weather" icon meant a sun above
       * the words "heavy drizzle", and the picture is read before the words.
       */
      icon: {
        type: "string",
        enum: [
          "clear",
          "cloudy",
          "drizzle",
          "rain",
          "heavyRain",
          "snow",
          "fog",
          "storm",
        ],
        description: "Which sky to draw, chosen from the conditions",
      },
      headline: {
        type: "string",
        description:
          "The sky in one or two words, e.g. 'Partly cloudy'. Sits under the " +
          "temperature, where the fuller `condition` phrase would wrap.",
      },
      /*
       * Pre-formatted, units included. The tree cannot join strings, so a
       * value and its unit have to arrive together or they never share a
       * baseline.
       */
      temperature: {
        type: "string",
        description: "Current temperature with its degree sign, e.g. '27°'",
      },
      feelsLikeLabel: { type: "string", description: "e.g. '34°'" },
      humidityLabel: { type: "string", description: "e.g. '92%'" },
      windLabel: { type: "string", description: "e.g. '5 km/h'" },
      feelsLike: { type: "number" },
      humidity: { type: "number", description: "Relative humidity, percent" },
      windKph: { type: "number" },
      summary: {
        type: "string",
        description: "One sentence on what the rest of the day looks like",
      },
    },
    required: ["city", "temperature", "condition"],
  },

  states: {
    default: {
      type: "Card",
      props: { padding: 0, radius: "xl" },
      children: [
        {
          /*
           * A literal colour because it is the card's identity, not a themed
           * surface — it has to read the same in light and dark. The text on
           * it is pinned for the same reason: `inverse` follows the theme, so
           * on dark it resolves to near-black and puts black on blue.
           */
          type: "Box",
          props: { background: "#2563eb", padding: 5, width: "100%" },
          children: [
            {
              /*
               * Place, then temperature, then sky — the order the question was
               * asked in. The first version led with a number and left the
               * city underneath it, which reads as a reading in search of a
               * place rather than an answer to "what's the weather in Mohali".
               */
              type: "Row",
              props: { gap: 4, align: "center", justify: "between" },
              children: [
                {
                  type: "Col",
                  props: { gap: 1, align: "start" },
                  children: [
                    {
                      type: "Row",
                      props: { gap: 1, align: "center" },
                      children: [
                        {
                          type: "Icon",
                          props: { name: "location", size: 13, color: "#bfdbfe" },
                        },
                        {
                          type: "Text",
                          props: {
                            value: { $bind: "$.city" },
                            size: "sm",
                            color: "onColor",
                            weight: "medium",
                          },
                        },
                        {
                          // Only when it adds something: "Mohali, Punjab" is
                          // useful, "Delhi, Delhi" is noise.
                          type: "Caption",
                          when: { $bind: "$.region" },
                          props: {
                            value: { $bind: "$.region" },
                            size: "xs",
                            color: "onColorMuted",
                          },
                        },
                      ],
                    },
                    {
                      /*
                       * The degree sign is part of the value, not a separate
                       * node: the tree cannot join strings, and "27" with the
                       * symbol floated beside it never aligns on its baseline.
                       */
                      type: "Title",
                      props: {
                        value: { $bind: "$.temperature" },
                        size: "2xl",
                        color: "onColor",
                      },
                    },
                    {
                      type: "Text",
                      props: {
                        value: { $bind: "$.headline", fallback: "" },
                        size: "sm",
                        color: "onColor",
                        weight: "medium",
                      },
                    },
                  ],
                },
                {
                  /*
                   * Large, and the only picture on the card. At 28px beside the
                   * number it read as a bullet point; the sky is the thing
                   * being reported, so it earns the space.
                   */
                  type: "Icon",
                  props: {
                    name: { $bind: "$.icon", fallback: "weather" },
                    size: 56,
                    color: "#fde68a",
                  },
                },
              ],
            },
          ],
        },
        {
          /*
           * The supporting readings, on the card's own surface rather than the
           * blue. Three columns so they scan as a set, each led by its icon —
           * a label alone makes the eye read left to right twice.
           */
          type: "Row",
          props: { gap: 3, padding: 4, justify: "between", align: "start" },
          children: [
            {
              type: "Col",
              props: { gap: 1, align: "start" },
              children: [
                {
                  type: "Row",
                  props: { gap: 1, align: "center" },
                  children: [
                    {
                      type: "Icon",
                      props: { name: "weather", size: 12, color: "tertiary" },
                    },
                    {
                      type: "Caption",
                      props: {
                        value: "Feels like",
                        size: "xs",
                        color: "tertiary",
                      },
                    },
                  ],
                },
                {
                  type: "Text",
                  props: {
                    value: { $bind: "$.feelsLikeLabel", fallback: "—" },
                    size: "sm",
                    weight: "semibold",
                  },
                },
              ],
            },
            {
              type: "Col",
              props: { gap: 1, align: "start" },
              children: [
                {
                  type: "Row",
                  props: { gap: 1, align: "center" },
                  children: [
                    {
                      type: "Icon",
                      props: { name: "humidity", size: 12, color: "tertiary" },
                    },
                    {
                      type: "Caption",
                      props: {
                        value: "Humidity",
                        size: "xs",
                        color: "tertiary",
                      },
                    },
                  ],
                },
                {
                  type: "Text",
                  props: {
                    value: { $bind: "$.humidityLabel", fallback: "—" },
                    size: "sm",
                    weight: "semibold",
                  },
                },
              ],
            },
            {
              type: "Col",
              props: { gap: 1, align: "start" },
              children: [
                {
                  type: "Row",
                  props: { gap: 1, align: "center" },
                  children: [
                    {
                      type: "Icon",
                      props: { name: "wind", size: 12, color: "tertiary" },
                    },
                    {
                      type: "Caption",
                      props: { value: "Wind", size: "xs", color: "tertiary" },
                    },
                  ],
                },
                {
                  type: "Text",
                  props: {
                    value: { $bind: "$.windLabel", fallback: "—" },
                    size: "sm",
                    weight: "semibold",
                  },
                },
              ],
            },
          ],
        },
        {
          /*
           * The forecast sentence last, and only when there is one. It is the
           * one piece of prose here, so it reads as a footnote to the figures
           * rather than competing with them.
           */
          type: "Box",
          props: { padding: 4 },
          when: { $bind: "$.summary" },
          children: [
            {
              type: "Text",
              props: {
                value: { $bind: "$.summary" },
                size: "sm",
                color: "secondary",
              },
            },
          ],
        },
      ],
    },
  },
}
