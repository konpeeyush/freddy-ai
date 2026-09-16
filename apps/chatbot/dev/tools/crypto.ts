import { getCryptoPrice as definition } from "../../src/tools/stock/crypto"

import type { DevTool } from "./types"

/*
 * The definition itself now ships by default in the production bundle (see
 * `src/tools/stock`) — this file only adds what the playground needs: a
 * toggle row and an example prompt.
 */
export const getCryptoPrice: DevTool = {
  definition,
  meta: {
    name: "getCryptoPrice",
    label: "Crypto prices",
    summary: "Live prices and 24h change, as a list with coloured badges.",
    widget: "crypto_price",
    example: "how are bitcoin and ethereum doing?",
    defaultEnabled: true,
  },
}
