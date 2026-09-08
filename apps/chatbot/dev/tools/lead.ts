import { widget } from "@workspace/api"

import type { DevTool } from "./types"

/*
 * Lead capture.
 *
 * The one demo tool with no external API, and deliberately so. Every other
 * one calls a real service because a card cannot be judged against data that
 * never moves — but a lead has no public endpoint to post to, and inventing
 * one would be a fixture pretending to be a integration.
 *
 * So the handler stores locally and hands the widget back. What it
 * demonstrates is the shape a customer implements: the tool decides *when* to
 * ask, the widget collects, and the host page's `submitLead` listener decides
 * where it goes. Swapping localStorage for a POST to their CRM is the whole
 * of the real integration.
 */

const STORAGE_KEY = "widget-playground-leads"

export type StoredLead = {
  name?: string
  email?: string
  phone?: string
  topic?: string
  /** When it was captured, so a playground session can be read in order. */
  at: string
}

export function loadLeads(): StoredLead[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StoredLead[]) : []
  } catch {
    return []
  }
}

export function saveLead(lead: StoredLead): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...loadLeads(), lead]))
  } catch {
    // Private browsing, or full. The lead is still shown as captured, which
    // is what the visitor was promised — losing it is our problem, not a
    // reason to tell them it failed.
  }
}

export const captureLead: DevTool = {
  definition: {
    name: "captureLead",
    /*
     * Written around when to *show the form*, not around what a lead is.
     *
     * The failure this description exists to prevent is the model politely
     * asking for an email in prose and then never calling anything — which
     * looks like it worked and captures nothing. So it says explicitly that
     * showing the form is the way to ask.
     */
    description:
      "Show a short form collecting the visitor's name, email and what they " +
      "need help with. Use when someone asks to be contacted, wants a demo, " +
      "a quote, a callback, or to talk to a person — and when a question " +
      "needs a human to answer it. Show the form rather than asking for " +
      "details in prose: typing an email into a sentence is how they get " +
      "lost. Pass anything the conversation already established as the " +
      "matching argument, so they are not asked twice.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "The visitor's name, if they have already given it. Pre-fills " +
            "the field. Omit rather than guessing.",
        },
        email: {
          type: "string",
          description: "Their email, if already given. Pre-fills the field.",
        },
        phone: {
          type: "string",
          description: "Their phone number, if already given.",
        },
        topic: {
          type: "string",
          description:
            "What they need help with, in a few words, drawn from what they " +
            "have said. Pre-fills the last field so they can correct it " +
            "rather than retype it.",
        },
        blurb: {
          type: "string",
          description:
            "One sentence on what happens next, e.g. 'Our team replies " +
            "within one working day.' Keep it honest — do not promise a " +
            "timeframe you were not told.",
        },
      },
      // Nothing is required: the form is worth showing even when the
      // conversation has established none of it.
      required: [],
    },
    handler(input) {
      const text = (key: string) =>
        typeof input[key] === "string" && (input[key] as string).trim()
          ? (input[key] as string).trim()
          : undefined

      return widget(
        "lead_capture",
        {
          heading: "Leave your details",
          blurb: text("blurb") ?? "We'll get back to you by email.",
          name: text("name"),
          email: text("email"),
          phone: text("phone"),
          topic: text("topic"),
        },
        {
          /*
           * The model reads this instead of the form's data, so it has to say
           * the form is *showing* rather than submitted. Without the second
           * sentence the model thanks the visitor for details they have not
           * sent yet — the single most common way this reply goes wrong.
           */
          summary:
            "Showed the visitor a form asking for their name, email, phone " +
            "and what they need help with. They have not filled it in yet — " +
            "do not thank them or confirm anything until they submit it.",
        }
      )
    },
  },

  meta: {
    name: "captureLead",
    label: "Lead capture",
    summary:
      "A form collecting name, email and topic. The only demo tool with no " +
      "external API — the host page decides where a lead goes.",
    widget: "lead_capture",
    example: "can someone from your team call me?",
    defaultEnabled: true,
  },
}
