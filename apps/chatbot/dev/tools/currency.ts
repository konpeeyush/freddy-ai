import { convertCurrency as definition } from "../../src/tools/stock/currency"

import type { DevTool } from "./types"

/*
 * The definition itself now ships by default in the production bundle (see
 * `src/tools/stock`) — this file only adds what the playground needs: a
 * toggle row and an example prompt.
 */
export const convertCurrency: DevTool = {
  definition,
  meta: {
    name: "convertCurrency",
    label: "Currency",
    summary: "Live ECB rates with a month of history, drawn as a chart.",
    widget: "exchange_rate",
    example: "what's 500 USD in INR?",
    defaultEnabled: true,
  },
}
