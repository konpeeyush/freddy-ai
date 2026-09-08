import { widget } from "@workspace/api"

import type { DevTool } from "./types"

/*
 * Weather lookup.
 *
 * Open-Meteo needs no API key, which keeps the demo self-contained — one
 * fewer secret to hold and no rate-limit account to manage for a demo tool.
 * It also sends permissive CORS headers, which is what makes this tool
 * portable to the browser at all: most weather APIs cannot be called from a
 * page, and would have to stay server-side.
 *
 * Two calls, not one: the forecast endpoint takes coordinates, so a name has
 * to be geocoded first.
 */

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

/** WMO weather codes. Trimmed to the ones that actually come back. */
const CONDITIONS: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "freezing fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  80: "rain showers",
  81: "heavy rain showers",
  82: "violent rain showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "thunderstorm with heavy hail",
}

type Place = {
  name: string
  latitude: number
  longitude: number
  admin1?: string
}

type Current = {
  temperature_2m: number
  apparent_temperature?: number
  relative_humidity_2m?: number
  wind_speed_10m?: number
  weather_code: number
}

/*
 * Hand-rolled in place of the server's Zod parse.
 *
 * The widget bundle ships to a customer's page, so a validator is weight the
 * demo does not need to carry. The obligation is the same either way: the
 * response is a third party's, so every field is checked before it reaches
 * the card — a missing `temperature_2m` must produce the "unexpected"
 * message, not `NaN°C`.
 */
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function optionalNumber(value: unknown): number | undefined {
  return isNumber(value) ? value : undefined
}

function firstPlace(raw: unknown): Place | undefined {
  const results = (raw as { results?: unknown })?.results
  const first = Array.isArray(results) ? results[0] : undefined
  if (!first || typeof first !== "object") return undefined

  const candidate = first as Record<string, unknown>
  if (
    typeof candidate.name !== "string" ||
    !isNumber(candidate.latitude) ||
    !isNumber(candidate.longitude)
  ) {
    return undefined
  }

  return {
    name: candidate.name,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    admin1:
      typeof candidate.admin1 === "string" ? candidate.admin1 : undefined,
  }
}

function currentConditions(raw: unknown): Current | undefined {
  const current = (raw as { current?: unknown })?.current
  if (!current || typeof current !== "object") return undefined

  const candidate = current as Record<string, unknown>
  if (
    !isNumber(candidate.temperature_2m) ||
    !isNumber(candidate.weather_code)
  ) {
    return undefined
  }

  return {
    temperature_2m: candidate.temperature_2m,
    weather_code: candidate.weather_code,
    apparent_temperature: optionalNumber(candidate.apparent_temperature),
    relative_humidity_2m: optionalNumber(candidate.relative_humidity_2m),
    wind_speed_10m: optionalNumber(candidate.wind_speed_10m),
  }
}

/**
 * One line on the rest of the day, from the numbers we already have.
 *
 * Written here rather than left to the model: the card needs a sentence in a
 * fixed slot, and asking the model to invent one per call spends a step and
 * risks it contradicting the readings printed right above it.
 */
/*
 * WMO code → icon name.
 *
 * The card used to send `icon: "weather"` for everything, which meant a sun
 * sitting above the words "heavy drizzle". The picture is the first thing
 * read, so getting it wrong undoes the sentence beneath it.
 *
 * Grouped by what the sky looks like rather than by code range: a visitor
 * cannot tell 51 from 53, but they can tell drizzle from a downpour.
 */
function iconFor(code: number): string {
  if (code === 0 || code === 1) return "clear"
  if (code === 2 || code === 3) return "cloudy"
  if (code === 45 || code === 48) return "fog"
  if (code >= 51 && code <= 57) return "drizzle"
  if (code >= 61 && code <= 65) return code >= 65 ? "heavyRain" : "rain"
  if (code >= 71 && code <= 77) return "snow"
  if (code >= 80 && code <= 82) return code >= 82 ? "heavyRain" : "rain"
  if (code >= 85 && code <= 86) return "snow"
  if (code >= 95) return "storm"
  return "cloudy"
}

/*
 * The sky as a single word, for the card's headline.
 *
 * `condition` is precise ("heavy drizzle") and belongs in the sentence; this
 * is the one-word version that sits under the temperature, where a phrase
 * would wrap.
 */
function headline(code: number): string {
  const icon = iconFor(code)
  if (icon === "clear") return code === 0 ? "Clear" : "Mostly clear"
  if (icon === "cloudy") return code === 2 ? "Partly cloudy" : "Overcast"
  if (icon === "fog") return "Fog"
  if (icon === "drizzle") return "Drizzle"
  if (icon === "rain") return "Rain"
  if (icon === "heavyRain") return "Heavy rain"
  if (icon === "snow") return "Snow"
  if (icon === "storm") return "Storm"
  return "Cloudy"
}

function describe(celsius: number, condition: string): string {
  const feel =
    celsius >= 35
      ? "Very hot"
      : celsius >= 28
        ? "Warm"
        : celsius >= 18
          ? "Mild"
          : celsius >= 8
            ? "Cool"
            : "Cold"
  return `${feel} with ${condition} expected for the rest of the afternoon.`
}

export const getWeather: DevTool = {
  definition: {
    name: "getWeather",
    // The model reads this to decide *whether* to call the tool. Vague
    // descriptions are the usual reason a tool never fires.
    description:
      "Get the current weather for a city. Use whenever someone asks about " +
      "weather, temperature, rain, or conditions in a place. Ask which city " +
      "if none was named — never guess one, and never assume where the " +
      "visitor is.",
    inputSchema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          minLength: 1,
          description:
            "City name, e.g. 'Delhi', 'San Francisco', 'Paris, France'",
        },
      },
      required: ["city"],
    },
    async handler(input) {
      const city = typeof input.city === "string" ? input.city : ""

      try {
        const geoRaw = await fetch(
          `${GEOCODE_URL}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
        ).then((r) => r.json())

        const place = firstPlace(geoRaw)
        if (!place) {
          // Returned rather than thrown: the model can relay a miss usefully,
          // where a thrown error would just break the turn.
          return { error: `I couldn't find a place called "${city}".` }
        }

        const forecastRaw = await fetch(
          `${FORECAST_URL}?latitude=${place.latitude}&longitude=${place.longitude}` +
            `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code`
        ).then((r) => r.json())

        const c = currentConditions(forecastRaw)
        if (!c) {
          return { error: "The weather service returned something unexpected." }
        }

        const celsius = Math.round(c.temperature_2m)
        const condition = CONDITIONS[c.weather_code] ?? "unknown conditions"

        /*
         * The data was always structured — it was only ever being flattened
         * into a sentence. Returning a widget changes the presentation, not
         * the lookup.
         */
        return widget(
          "weather_card",
          {
            city: place.name,
            region: place.admin1,
            celsius,
            condition,
            icon: iconFor(c.weather_code),
            headline: headline(c.weather_code),
            /*
             * Units belong to the value, not the template: the tree cannot
             * join strings, so "34°" assembled from a number and a floating
             * degree sign never sits on the same baseline.
             */
            temperature: `${Math.round(celsius)}°`,
            feelsLikeLabel: isNumber(c.apparent_temperature)
              ? `${Math.round(c.apparent_temperature)}°`
              : undefined,
            humidityLabel: isNumber(c.relative_humidity_2m)
              ? `${Math.round(c.relative_humidity_2m)}%`
              : undefined,
            windLabel: isNumber(c.wind_speed_10m)
              ? `${Math.round(c.wind_speed_10m)} km/h`
              : undefined,
            feelsLike:
              c.apparent_temperature === undefined
                ? undefined
                : `${Math.round(c.apparent_temperature)}°`,
            humidity:
              c.relative_humidity_2m === undefined
                ? undefined
                : `${c.relative_humidity_2m}%`,
            windKph:
              c.wind_speed_10m === undefined
                ? undefined
                : `${Math.round(c.wind_speed_10m)} km/h`,
            summary: describe(celsius, condition),
          },
          {
            // What the model sees. Without it the model would describe a card
            // it cannot read, or repeat the reading in prose underneath it.
            summary:
              `Showed a weather card for ${place.name}: ${celsius}°C, ` +
              `${condition}. The visitor can see the details, so do not repeat ` +
              `the numbers — acknowledge briefly or offer something related.`,
          }
        )
      } catch {
        return { error: "The weather service is unreachable right now." }
      }
    },
  },
  meta: {
    name: "getWeather",
    label: "Weather",
    summary: "Live conditions for a city, rendered as a card.",
    widget: "weather_card",
    example: "What's the weather in Delhi?",
    defaultEnabled: true,
  },
}
