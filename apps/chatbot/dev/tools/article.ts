import { lookupArticle as definition } from "../../src/tools/stock/article"

import type { DevTool } from "./types"

/*
 * The definition itself now ships by default in the production bundle (see
 * `src/tools/stock`) — this file only adds what the playground needs: a
 * toggle row and an example prompt.
 */
export const lookupArticle: DevTool = {
  definition,
  meta: {
    name: "lookupArticle",
    label: "Encyclopaedia",
    summary: "Real Wikipedia summaries, with a thumbnail and a link out.",
    widget: "article_summary",
    example: "what is the great barrier reef?",
    defaultEnabled: true,
  },
}
