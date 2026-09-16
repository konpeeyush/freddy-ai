import { getWeather as definition } from "../../src/tools/stock/weather"

import type { DevTool } from "./types"

/*
 * The definition itself now ships by default in the production bundle (see
 * `src/tools/stock`) — this file only adds what the playground needs: a
 * toggle row and an example prompt.
 */
export const getWeather: DevTool = {
  definition,
  meta: {
    name: "getWeather",
    label: "Weather",
    summary: "Live conditions for a city, rendered as a card.",
    widget: "weather_card",
    example: "What's the weather in Delhi?",
    defaultEnabled: true,
  },
}
