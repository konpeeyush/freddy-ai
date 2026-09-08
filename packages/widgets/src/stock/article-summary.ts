import type { WidgetDefinition } from "../tree"

/*
 * Article summary.
 *
 * The "answer, then the source" shape — a knowledge-base or encyclopaedia
 * lookup. The extract is the answer, so it renders in full; the link exists
 * because a summary that cannot be checked is worth less than one that can.
 *
 * The thumbnail is optional and gated, not defaulted to a placeholder. A
 * grey box where an image should be reads as a failure; no image at all just
 * reads as a text card, which is what most articles honestly are.
 */

export const articleSummaryWidget: WidgetDefinition = {
  id: "article_summary",
  version: 1,
  enabled: true,
  name: "Article summary",
  description:
    "Summarise one article or encyclopaedia entry — title, a one-line " +
    "description, an extract, and a link to the source.",

  schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Article title" },
      description: {
        type: "string",
        description:
          "The one-line gloss that sits under the title, e.g. 'Japanese " +
          "animation studio'. Not a summary of the extract.",
      },
      extract: {
        type: "string",
        description:
          "The summary itself, two to four sentences. Plain prose — the " +
          "renderer has no markdown.",
      },
      thumbnail: {
        type: "string",
        description:
          "Absolute https URL for the lead image. Omit when there is none.",
      },
      url: {
        type: "string",
        description: "Canonical URL of the source article",
      },
      lang: {
        type: "string",
        description:
          "BCP 47 language tag of the source, e.g. 'fr'. Set it only when " +
          "the source is not in the conversation's language — it renders as " +
          "a badge, and one reading 'en' on an English page is noise.",
      },
    },
    required: ["title", "extract", "url"],
  },

  states: {
    default: {
      type: "Card",
      props: { padding: 0, radius: "xl" },
      children: [
        {
          /*
           * Full-bleed above the padded body, so `padding: 0` on the Card and
           * the padding moves to the Box below. A banner inset from the card
           * edge looks like an image someone forgot to size.
           */
          type: "Image",
          when: { $bind: "$.thumbnail" },
          props: {
            src: { $bind: "$.thumbnail" },
            alt: { $bind: "$.title" },
            width: "100%",
            height: 140,
            fit: "cover",
          },
        },
        {
          type: "Box",
          props: { padding: 4, width: "100%" },
          children: [
            {
              type: "Col",
              props: { gap: 3, align: "start" },
              children: [
                {
                  type: "Col",
                  props: { gap: 0, align: "start" },
                  children: [
                    {
                      type: "Title",
                      props: {
                        value: { $bind: "$.title" },
                        size: "md",
                        maxLines: 2,
                      },
                    },
                    {
                      type: "Row",
                      props: { gap: 2, align: "center" },
                      children: [
                        {
                          type: "Caption",
                          when: { $bind: "$.description" },
                          props: {
                            value: { $bind: "$.description" },
                            size: "xs",
                            color: "tertiary",
                          },
                        },
                        {
                          // Only worth showing when the source is not in the
                          // visitor's own language — but the tree cannot
                          // compare, so it shows whenever the producer sets
                          // it, and the producer omits it for the common case.
                          type: "Badge",
                          when: { $bind: "$.lang" },
                          props: {
                            label: { $bind: "$.lang" },
                            color: "neutral",
                            pill: true,
                            size: "sm",
                          },
                        },
                      ],
                    },
                  ],
                },
                {
                  /*
                   * Clamped rather than scrolled. An extract that runs long is
                   * the link's job — the card's job is to be skimmable inside
                   * a transcript that keeps moving.
                   */
                  type: "Text",
                  props: {
                    value: { $bind: "$.extract" },
                    size: "sm",
                    color: "secondary",
                    maxLines: 4,
                  },
                },
                {
                  type: "Button",
                  props: {
                    label: "Read the full article",
                    color: "secondary",
                    size: "md",
                    block: true,
                    width: "100%",
                    icon: "arrow",
                    onClickAction: {
                      kind: "link",
                      url: { $bind: "$.url" },
                      // New tab: the widget is embedded in someone else's
                      // page, and navigating away would take the whole
                      // conversation with it.
                      newTab: true,
                    },
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
