import type { WidgetDefinition } from "../tree"

/*
 * Places to visit, as a swipeable row.
 *
 * The stock set's `Carousel` example, and the shape that needed one: four
 * read-only cards proved a card renders, none proved that a *row* of them
 * scrolls, snaps, and keeps its per-item keys straight when the data changes.
 *
 * A carousel rather than a list because the content is comparable and
 * pictorial — eight places with photographs are scanned sideways, whereas a
 * vertical list of the same eight fills the panel and buries the reply that
 * introduced them. The chat panel is ~380px wide, so `itemWidth` is set to
 * show one card and the edge of the next: the sliver is the affordance, and
 * without it a snap row looks like a single card that happens to be cropped.
 */

export const placeCarouselWidget: WidgetDefinition = {
  id: "place_carousel",
  version: 1,
  enabled: true,
  name: "Places carousel",
  description:
    "A swipeable row of places — attractions, neighbourhoods, landmarks — " +
    "each with a photo, a one-line description and a link.",

  schema: {
    type: "object",
    properties: {
      heading: {
        type: "string",
        description: "One short line above the row, e.g. 'Worth seeing in Budapest'",
      },
      places: {
        type: "array",
        description: "The places, in the order they should be shown.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "The place's name" },
            description: {
              type: "string",
              description: "One short line on what it is",
            },
            /*
             * Optional, and the layout has to hold without it. Wikipedia
             * returns no thumbnail for a fair share of pages, and a card that
             * collapses to half height next to its neighbours reads as a
             * broken image rather than a place with no photograph.
             */
            image: { type: "string", description: "Photo URL, when there is one" },
            /** Pre-formatted: the tree cannot join a number to its unit. */
            distance: {
              type: "string",
              description: "How far from the centre, e.g. '1.2 km'",
            },
            url: { type: "string", description: "Where to read more" },
          },
          required: ["name"],
        },
      },
    },
    required: ["places"],
  },

  states: {
    default: {
      type: "Col",
      props: { gap: 2, align: "start", width: "100%" },
      children: [
        {
          type: "Text",
          when: { $bind: "$.heading" },
          props: { value: { $bind: "$.heading" }, size: "sm", weight: "medium" },
        },
        {
          type: "Carousel",
          /*
           * Wide enough that a card is readable, narrow enough that the next
           * one peeks in. Cards sized to the full panel width give no hint
           * that there is anything to swipe to.
           */
          props: { itemWidth: "200px", gap: 2 },
          children: [
            {
              type: "Card",
              /*
               * Keyed by name rather than index: a re-render that reordered
               * the array would otherwise reuse the wrong card's image, and
               * the picture would appear to swap between places.
               */
              repeat: { over: "$.places", as: "item", key: "$item.name", limit: 12 },
              props: { padding: 0, radius: "lg" },
              children: [
                {
                  type: "Image",
                  when: { $bind: "$item.image" },
                  props: {
                    src: { $bind: "$item.image" },
                    alt: { $bind: "$item.name" },
                    width: "100%",
                    height: 110,
                    fit: "cover",
                  },
                },
                {
                  type: "Box",
                  props: { padding: 3, width: "100%" },
                  children: [
                    {
                      /*
                       * `between` so the link sits on the card's floor rather
                       * than under the text.
                       *
                       * The carousel makes every card the row's height, which
                       * fixes the ragged bottom edge — but a card with a
                       * shorter description then has its button floating
                       * mid-card with a gap beneath. Pushing the last child
                       * down is what turns equal heights into aligned ones.
                       */
                      type: "Col",
                      props: {
                        gap: 1,
                        align: "start",
                        justify: "between",
                        height: "100%",
                      },
                      children: [
                        {
                          /*
                           * Grouped, so `between` above has two things to
                           * separate rather than four to spread. Without this
                           * the title, description and badge would each drift
                           * apart to fill the card.
                           */
                          type: "Col",
                          props: { gap: 1, align: "start" },
                          children: [
                            {
                              type: "Title",
                              props: {
                                value: { $bind: "$item.name" },
                                size: "sm",
                                maxLines: 2,
                              },
                            },
                            {
                              type: "Caption",
                              when: { $bind: "$item.description" },
                              props: {
                                value: { $bind: "$item.description" },
                                size: "xs",
                                color: "tertiary",
                                maxLines: 2,
                              },
                            },
                            {
                              type: "Badge",
                              when: { $bind: "$item.distance" },
                              props: {
                                label: { $bind: "$item.distance" },
                                size: "sm",
                                color: "neutral",
                                pill: true,
                              },
                            },
                          ],
                        },
                        {
                          type: "Button",
                          when: { $bind: "$item.url" },
                          props: {
                            label: "Read more",
                            variant: "ghost",
                            size: "sm",
                            onClickAction: {
                              kind: "link",
                              url: { $bind: "$item.url" },
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
          ],
        },
      ],
    },
  },
}
