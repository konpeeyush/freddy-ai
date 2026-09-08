import { widget } from "@workspace/api"

import type { DevTool } from "./types"

/*
 * Things to see in a city.
 *
 * Wikipedia's geosearch, which returns pages near a coordinate along with
 * thumbnails and one-line descriptions — real places, real photographs, no
 * key, CORS open. The same reasoning as every other demo tool: a carousel
 * cannot be judged against a fixture, because the interesting cases are the
 * ragged ones. Some pages have no thumbnail, some descriptions are long, and
 * a row of cards has to hold anyway.
 *
 * Two calls, like `getWeather`: geosearch takes coordinates, so a city name
 * has to be geocoded first. Open-Meteo's geocoder is reused rather than
 * Wikipedia's own search, because it resolves "Delhi" to a point rather than
 * to an article about Delhi.
 */

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
const WIKI_API = "https://en.wikipedia.org/w/api.php"

type GeoPlace = { name: string; latitude: number; longitude: number }

type WikiPage = {
  title?: string
  description?: string
  thumbnail?: { source?: string }
  coordinates?: { lat?: number; lon?: number }[]
}

/** Kilometres between two coordinates. Haversine, to one decimal. */
function distanceKm(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): number {
  const R = 6371
  const dLat = ((toLat - fromLat) * Math.PI) / 180
  const dLon = ((toLon - fromLon) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((fromLat * Math.PI) / 180) *
      Math.cos((toLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10
}

/*
 * Pages that are near a city without being places to visit.
 *
 * Geosearch is proximity-only, so it returns whatever article is *pinned* to a
 * coordinate — "Siege of Budapest" and "Bridges of Budapest" come back
 * alongside the castle. Worth filtering here rather than leaving to the model,
 * which would otherwise narrate a wartime siege as a thing to see on a trip.
 *
 * Matched on events and article kinds, because those are what an article
 * about a *happening* calls itself. Checked against title and description
 * together: "Kinmon incident" gives nothing away in its description, and
 * "2006 Jama Masjid bombings" gives nothing away in its title.
 */
const NOT_A_PLACE =
  /\b(list of|siege|battle|bombing|attack|massacre|riot|uprising|revolt|incident|election|census|treaty|disambiguation|invasion|conflict|war)\b/i

/*
 * Descriptions that mark a page as an abstraction rather than somewhere to
 * stand — a polity, an institution, an administrative area.
 *
 * Deliberately narrow, and this is the correction worth recording: a first
 * pass included `former` and `state`, which read plausibly and dropped the
 * Kyoto Imperial Palace ("Former ruling palace of the Emperor of Japan") —
 * one of the city's best-known sights. A landmark being historical is the
 * usual reason to visit it, so age words cannot be the test.
 *
 * `\bstate\b` is gone for the same reason (it would take "Palace of the
 * State"), leaving only phrases that name a polity outright.
 */
const NOT_VISITABLE =
  /\b(monarchy|sovereign state|country|empire|kingdom|dynasty|republic|learned society|political part(y|ies)|prefecture|municipality|government agency)\b/i

/**
 * Whether a geosearch result is somewhere a visitor could go and stand.
 *
 * Exported for its tests: both directions of error are real, and neither is
 * visible from the carousel — a dropped landmark simply is not there, and a
 * battle reads as a suggestion.
 */
export function isVisitable(title: string, description: string): boolean {
  if (!title) return false
  if (NOT_A_PLACE.test(`${title} ${description}`)) return false
  return !NOT_VISITABLE.test(description)
}

export const findPlaces: DevTool = {
  definition: {
    name: "findPlaces",
    description:
      "Find notable places to visit in or near a city — landmarks, museums, " +
      "neighbourhoods, parks — and show them as a swipeable row of cards. " +
      "Use when someone asks what to see, what to do, what is worth " +
      "visiting, or for sightseeing suggestions. Ask which city if none was " +
      "named rather than guessing one.",
    inputSchema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          minLength: 1,
          description: "City name, e.g. 'Budapest', 'Kyoto', 'Delhi'",
        },
      },
      required: ["city"],
    },
    async handler(input) {
      const city = typeof input.city === "string" ? input.city.trim() : ""
      if (!city) return { error: "No city was given." }

      try {
        const geo = (await fetch(
          `${GEOCODE_URL}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
        ).then((r) => r.json())) as { results?: GeoPlace[] }

        const place = geo.results?.[0]
        if (!place) {
          return { error: `Could not find a city called "${city}".` }
        }

        /*
         * `origin=*` is what makes this callable from a page at all —
         * Wikipedia's API requires it for anonymous cross-origin requests.
         */
        const params = new URLSearchParams({
          action: "query",
          format: "json",
          origin: "*",
          generator: "geosearch",
          ggscoord: `${place.latitude}|${place.longitude}`,
          ggsradius: "10000",
          ggslimit: "20",
          prop: "pageimages|description|coordinates",
          piprop: "thumbnail",
          pithumbsize: "400",
        })

        const result = (await fetch(`${WIKI_API}?${params}`).then((r) =>
          r.json()
        )) as { query?: { pages?: Record<string, WikiPage> } }

        const pages = Object.values(result.query?.pages ?? {})
        const places = pages
          .filter((page) => isVisitable(page.title ?? "", page.description ?? ""))
          /*
           * Photographed pages first. A row whose first two cards have no
           * image reads as broken, even when the ones behind them do — and
           * the visitor only ever sees the first two without swiping.
           */
          .sort((a, b) => Number(Boolean(b.thumbnail)) - Number(Boolean(a.thumbnail)))
          .slice(0, 10)
          .map((page) => {
            const at = page.coordinates?.[0]
            return {
              name: page.title as string,
              description: page.description,
              image: page.thumbnail?.source,
              distance:
                at?.lat !== undefined && at?.lon !== undefined
                  ? `${distanceKm(place.latitude, place.longitude, at.lat, at.lon)} km`
                  : undefined,
              url: `https://en.wikipedia.org/wiki/${encodeURIComponent(
                (page.title as string).replace(/ /g, "_")
              )}`,
            }
          })

        if (places.length === 0) {
          return { error: `Nothing notable came back for ${place.name}.` }
        }

        return widget(
          "place_carousel",
          { heading: `Worth seeing in ${place.name}`, places },
          {
            /*
             * Names the places rather than counting them. The model reads
             * this instead of the data, and "showed 8 places" leaves it
             * unable to answer "tell me about the second one" — which is the
             * obvious next question after a carousel.
             */
            summary:
              `Showed a swipeable row of ${places.length} places to visit in ` +
              `${place.name}: ${places.map((p) => p.name).join(", ")}. The ` +
              `visitor can see these — do not list them again in prose.`,
          }
        )
      } catch (cause) {
        console.warn("[findPlaces] failed:", cause)
        return { error: "Could not reach the places service." }
      }
    },
  },

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
