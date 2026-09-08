import type { Sequence } from "@workspace/api"

/*
 * A shipped sequence, plus what the playground needs to talk about it.
 *
 * Same split as `DevTool`: the flow itself is what registers, the example is
 * for the person testing it. They travel together because a flow whose
 * example lives elsewhere drifts from it the first time either is edited.
 */
export type DevSequence = {
  sequence: Sequence
  /** A prompt known to start it — the playground offers it as a chip. */
  example: string
}

/*
 * The demo sequences, as a host page would define them.
 *
 * Ships for the same reason `DEV_TOOLS` does: the feature is invisible until
 * something uses it, and asking a developer to author a flow before they can
 * see what a flow does is backwards. This one runs against the demo tools, so
 * it works on a fresh clone with nothing configured.
 *
 * It is also the honest test. A sequence is a claim about *ordering*, and the
 * only way to see the claim hold is to watch the model be unable to reach a
 * tool it would otherwise have called — which needs real tools, in a real
 * conversation, not a fixture.
 */

/*
 * Travel briefing: where → weather → what to see → currency → rate → stays.
 *
 * Six steps, and every one earns its place. Two `ask` steps feed four tool
 * steps, so argument pinning is exercised rather than described; asks and
 * tools alternate, so a skipped step is obvious on screen; and all four tools
 * render widgets, which makes this the flow that shows a sequence composing
 * with the rest of the widget rather than replacing it.
 *
 * The widget variety is the point of the length. A card, a chart, a carousel
 * and a choosable list in one conversation is the only way to see that they
 * sit together — that a swipe row does not fight the panel's own scroll, and
 * that a chosen state survives the turns that come after it.
 *
 * It is also a flow the model would plausibly get *wrong* unaided. Asked
 * about a trip, the natural move is to call `getWeather` immediately and
 * guess the city from context — which is exactly what the first `ask` step
 * makes impossible, because `getWeather` is not in the request until the
 * destination has actually been captured.
 */
export const travelBriefing: Sequence = {
  id: "travelBriefing",
  label: "Travel briefing",
  trigger:
    "Use when someone mentions an upcoming trip, says they are travelling " +
    "or flying somewhere, or asks for help planning a visit. Not for a bare " +
    "weather question about a city — that is just the weather tool.",
  steps: [
    {
      kind: "ask",
      field: "destination",
      prompt: "which city they are travelling to",
    },
    {
      kind: "tool",
      tool: "getWeather",
      // The captured answer wins over whatever the model infers from the
      // conversation, which is the point of capturing it.
      inputFrom: { city: "$destination" },
    },
    {
      /*
       * Sightseeing before logistics, deliberately.
       *
       * The carousel is the part someone actually wants after "I'm going to
       * Budapest" — it is also the step that makes the rest feel worth
       * answering, so it sits before the two that ask for something.
       */
      kind: "tool",
      tool: "findPlaces",
      inputFrom: { city: "$destination" },
    },
    {
      kind: "ask",
      field: "homeCurrency",
      prompt:
        "which currency they normally spend in, as a three-letter code like " +
        "USD, GBP or INR",
    },
    {
      kind: "tool",
      tool: "convertCurrency",
      inputFrom: { from: "$homeCurrency" },
      // `to` is deliberately left unpinned: the destination's currency is not
      // something the visitor was asked for, and the model can infer it from
      // the city it already has. A sequence fixes the order of steps; it does
      // not have to fix every argument of every step.
    },
    {
      /*
       * Last, and priced in the currency captured two steps earlier — which
       * is the reason the currency step comes before it rather than after
       * the flow's more obvious ordering of "where, then what, then where to
       * sleep". A stay list priced in a currency the visitor does not think
       * in is a list they have to do arithmetic on.
       */
      kind: "tool",
      tool: "findStays",
      inputFrom: { city: "$destination", currency: "$homeCurrency" },
    },
  ],
}

/*
 * Support handoff: ask what is wrong → show the lead form.
 *
 * Two steps rather than four, and shorter on purpose — it is the flow where
 * the *guardrail* is the point rather than the ordering. Someone asking for a
 * human is often frustrated, and a frustrated visitor asks other things
 * mid-flow: "how much is this anyway", "do you have a phone number". An
 * unconstrained model answers those and never gets back to the form, which
 * reads as helpful and captures nothing.
 *
 * So this is the flow to watch with `captureLead` withheld, or with the
 * turn instruction removed, to see what the constraint is actually buying.
 */
export const supportHandoff: Sequence = {
  id: "supportHandoff",
  label: "Support handoff",
  trigger:
    "Use when someone asks to speak to a person, wants a callback or a demo, " +
    "says the assistant cannot help, or is clearly frustrated. Not for a " +
    "question that has a straightforward answer — try answering first.",
  steps: [
    {
      kind: "ask",
      field: "issue",
      prompt: "what they need help with, in their own words",
    },
    {
      kind: "tool",
      tool: "captureLead",
      // The form is pre-filled with what they just said, so the visitor
      // corrects a sentence rather than retyping it.
      inputFrom: { topic: "$issue" },
    },
  ],
}

/** Order is display order, as with `DEV_TOOLS`. */
export const DEV_SEQUENCES: DevSequence[] = [
  {
    sequence: travelBriefing,
    /*
     * Deliberately does not name the city.
     *
     * "What's the weather in Delhi?" would be answered by the weather tool
     * alone and prove nothing. A trip with no destination given is what makes
     * the first `ask` step do visible work — and it is the prompt where an
     * unsequenced model would guess a city rather than ask.
     */
    example: "I'm flying somewhere next week, can you help me get ready?",
  },
  {
    sequence: supportHandoff,
    /*
     * Deliberately a complaint rather than a request for a form. Someone who
     * asks "can I have a contact form" needs no sequence — this is the phrasing
     * where the model has to decide a handoff is warranted.
     */
    example: "this isn't working and I've been going in circles, I need a human",
  },
]

/** The tools every shipped sequence needs, for a drift check at startup. */
export function sequenceToolNames(sequences: Sequence[]): string[] {
  return [
    ...new Set(
      sequences.flatMap((sequence) =>
        sequence.steps
          .filter((step) => step.kind === "tool")
          .map((step) => (step as { tool: string }).tool)
      )
    ),
  ]
}
