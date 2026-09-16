import { findPlaces as definition, isVisitable } from "../../src/tools/stock/places"

import type { DevTool } from "./types"

export { isVisitable }

/*
 * The definition itself now ships by default in the production bundle (see
 * `src/tools/stock`) — this file only adds what the playground needs: a
 * toggle row and an example prompt.
 */
export const findPlaces: DevTool = {
  definition,
  meta: {
    name: "findPlaces",
    label: "Places to visit",
    summary:
      "Wikipedia geosearch, drawn as a swipeable carousel. Real photos, and " +
      "ragged data — some places have no image.",
    widget: "place_carousel",
    example: "what's worth seeing in Budapest?",
    defaultEnabled: true,
  },
}
