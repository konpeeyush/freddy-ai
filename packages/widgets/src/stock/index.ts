import { articleSummaryWidget } from "./article-summary"
import { cryptoPriceWidget } from "./crypto-price"
import { exchangeRateWidget } from "./exchange-rate"
import { leadCaptureWidget } from "./lead-capture"
import { placeCarouselWidget } from "./place-carousel"
import { stayOptionsWidget } from "./stay-options"
import { weatherWidget } from "./weather"

/*
 * Stock widgets.
 *
 * Authored in the same format a customer's own widgets use — no privileged
 * path — so they double as the gallery templates someone forks to make their
 * own. That is the whole point of shipping them as definitions rather than as
 * React components.
 *
 * Each one backs a demo tool that calls a real API, so every shape here can be
 * seen rendering live data rather than a fixture:
 *
 *   weather_card         read-only card, single state
 *   exchange_rate        a series as a chart, sign-driven badge branch
 *   crypto_price         compact repeated rows, per-item badge branch
 *   article_summary      optional lead image, prose body, link out
 *   lead_capture         a form that collects, with a submitted state
 *   place_carousel       a swipeable row, repeated with per-item keys
 *   stay_options         a comparable list with a choice, and a chosen state
 *
 * The last three also stand as the worked example of the tree's one real
 * ceiling: `when` compares a path to a literal and nothing else, so anything
 * conditional on a comparison — "is this number negative" — needs the answer
 * supplied as data, not computed in the template.
 *
 * `lead_capture` is the one that collects rather than reports, and the only
 * one with a second state: a form that stays a form after submitting invites
 * a second submit. Its data comes from the visitor rather than an API, which
 * is why it can demonstrate `Form` and `Input` where the others cannot.
 *
 * The primitives still without a stock example — `Select`, `Checkbox`,
 * `RadioGroup`, `Progress` — are rendered by the runtime and covered by its
 * own tests. No free, keyless API produces data
 * shaped like a pricing table, and a fixture pretending otherwise proves less
 * than it appears to.
 */

export {
  articleSummaryWidget,
  cryptoPriceWidget,
  exchangeRateWidget,
  leadCaptureWidget,
  placeCarouselWidget,
  stayOptionsWidget,
  weatherWidget,
}

export const STOCK_WIDGETS = [
  weatherWidget,
  exchangeRateWidget,
  cryptoPriceWidget,
  articleSummaryWidget,
  leadCaptureWidget,
  placeCarouselWidget,
  stayOptionsWidget,
]
