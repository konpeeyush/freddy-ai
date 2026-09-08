import type { WidgetDefinition } from "../tree"

/*
 * Lead capture form.
 *
 * The first stock widget that *collects* rather than reports. Every other one
 * renders an answer the tool already had; this one is the shape a visitor
 * types into, which is what makes it the missing example — `Form`, `Input`
 * and `Select` are rendered by the runtime and covered by its tests, but no
 * free keyless API returns data shaped like a form, so nothing demonstrated
 * them end to end.
 *
 * Two states, and the second one matters more than it looks. A form that
 * stays a form after submitting invites a second submit, and the model has no
 * way to tell the two apart in history — so `stateBy` reads a flag in the
 * data and swaps the whole tree for a confirmation. Reopening the panel
 * replays the same data and lands on the same state, which is what keeps a
 * submitted form submitted.
 */

export const leadCaptureWidget: WidgetDefinition = {
  id: "lead_capture",
  version: 1,
  enabled: true,
  name: "Lead capture form",
  description:
    "A short form asking for a name, email, and optionally a phone number " +
    "and what they need help with. Shows a confirmation once submitted.",

  schema: {
    type: "object",
    properties: {
      /*
       * Drives `stateBy`. Absent or false renders the form; true renders the
       * confirmation, which is how a submitted form survives a reload.
       */
      submitted: {
        type: "boolean",
        description:
          "True once the visitor has sent their details. Leave unset when " +
          "first showing the form.",
      },
      heading: {
        type: "string",
        description: "One short line above the fields, e.g. 'Leave your details'",
      },
      blurb: {
        type: "string",
        description:
          "One sentence on what happens next, e.g. 'Our team replies within " +
          "one working day.'",
      },
      /*
       * Pre-filled from what the conversation already established. A visitor
       * who has just said their name should not be asked to type it again —
       * and the model has it, so the only reason it would be blank is that
       * nobody passed it through.
       */
      name: { type: "string", description: "Pre-fills the name field, when known" },
      email: { type: "string", description: "Pre-fills the email field, when known" },
      phone: { type: "string", description: "Pre-fills the phone field, when known" },
      /** What the visitor is asking about, echoed back on the confirmation. */
      topic: {
        type: "string",
        description: "What they need help with, in a few words",
      },
      /** Shown on the confirmation, so the visitor knows what was recorded. */
      confirmation: {
        type: "string",
        description:
          "One sentence confirming what was sent, shown after submitting.",
      },
    },
    required: [],
  },

  stateBy: {
    $bind: "$.submitted",
    map: { true: "done", default: "form" },
  },

  states: {
    form: {
      type: "Card",
      props: { padding: 4, radius: "xl", gap: 3 },
      children: [
        {
          type: "Col",
          props: { gap: 1, align: "start" },
          children: [
            {
              type: "Title",
              props: {
                value: { $bind: "$.heading", fallback: "Leave your details" },
                size: "md",
              },
            },
            {
              type: "Caption",
              when: { $bind: "$.blurb" },
              props: { value: { $bind: "$.blurb" }, size: "xs", color: "tertiary" },
            },
          ],
        },
        {
          type: "Form",
          children: [
            {
              type: "Input",
              props: {
                name: "name",
                label: "Name",
                placeholder: "Your name",
                required: true,
                value: { $bind: "$.name", fallback: "" },
              },
            },
            {
              /*
               * `type: email` is not decoration — the Form runtime validates
               * against it, so a typo'd address is caught here rather than
               * becoming a lead nobody can reply to.
               */
              type: "Input",
              props: {
                name: "email",
                label: "Email",
                type: "email",
                placeholder: "you@company.com",
                required: true,
                value: { $bind: "$.email", fallback: "" },
              },
            },
            {
              // Optional on purpose. A required phone number is the field
              // people abandon a form over, and an email is enough to reply.
              type: "Input",
              props: {
                name: "phone",
                label: "Phone (optional)",
                type: "tel",
                placeholder: "+91 98765 43210",
                value: { $bind: "$.phone", fallback: "" },
              },
            },
            {
              type: "Input",
              props: {
                name: "topic",
                label: "What do you need help with?",
                type: "textarea",
                rows: 3,
                placeholder: "A sentence is plenty",
                value: { $bind: "$.topic", fallback: "" },
              },
            },
            {
              type: "Button",
              props: {
                label: "Send",
                variant: "primary",
                width: "full",
                onClickAction: {
                  /*
                   * `submit` rather than `emit`: it gathers the enclosing
                   * form and refuses to fire when validation fails, so the
                   * host never receives a half-filled lead.
                   */
                  kind: "submit",
                  functionName: "submitLead",
                  loadingBehavior: "widget",
                },
              },
            },
          ],
        },
      ],
    },

    done: {
      type: "Card",
      props: { padding: 4, radius: "xl", gap: 2 },
      children: [
        {
          type: "Row",
          props: { gap: 2, align: "center" },
          children: [
            { type: "Icon", props: { name: "check", size: 18, color: "#16a34a" } },
            {
              type: "Title",
              props: { value: "Thanks — we have your details", size: "sm" },
            },
          ],
        },
        {
          type: "Text",
          when: { $bind: "$.confirmation" },
          props: {
            value: { $bind: "$.confirmation" },
            size: "sm",
            color: "secondary",
          },
        },
      ],
    },
  },
}
