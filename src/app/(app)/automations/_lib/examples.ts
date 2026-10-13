// Ready-made starting points for a new automation, plus the blank email used
// when a step is added. They are visual designs (see @/lib/email-design), so
// they open in the visual editor; the HTML is generated from the design.
// Pure and client-safe.

import { BLANK_DESIGN, renderDesign, serializeDesign, toDesign, type EmailDesign } from "@/lib/email-design";

export interface EmailContent {
  html: string;
  /** Visual-editor design (JSON string) the html was generated from. */
  design: string | null;
}

export interface ExampleStep extends EmailContent {
  delayMinutes: number;
  subject: string;
  previewText: string;
}

export interface AutomationExample {
  key: string;
  name: string;
  /** One line for the picker. */
  description: string;
  /** e.g. "1 email, sent immediately" / "3 emails over 5 days". */
  summary: string;
  steps: ExampleStep[];
}

function fromDesign(design: EmailDesign): EmailContent {
  return { html: renderDesign(design), design: serializeDesign(design) };
}

/** A heading, a few paragraphs, an optional button and the standard footer. */
function email(heading: string, paragraphs: string[], button?: { label: string; url: string }): EmailContent {
  const design = toDesign({
    blocks: [
      { id: "heading", type: "heading", text: heading },
      { id: "body", type: "text", text: paragraphs.join("\n\n") },
      ...(button ? [{ id: "button", type: "button", label: button.label, url: button.url }] : []),
    ],
  });
  return fromDesign(design ?? BLANK_DESIGN);
}

/** A new, empty email: a greeting, a placeholder line and the unsubscribe footer. */
export const BLANK_STEP: EmailContent = fromDesign(BLANK_DESIGN);

const DAY = 24 * 60;

export const AUTOMATION_EXAMPLES: AutomationExample[] = [
  {
    key: "welcome",
    name: "Welcome email",
    description: "Say hello the moment someone signs up, while they still remember you.",
    summary: "1 email, sent immediately",
    steps: [
      {
        delayMinutes: 0,
        subject: "Welcome, {{first_name | friend}}!",
        previewText: "Thanks for signing up - here's what to expect.",
        ...email("Welcome aboard!", [
          "Hi {{first_name | there}},",
          "Thanks for signing up. You're on the list, and we're glad to have you.",
          "Here's what you can expect from us: useful updates, the occasional offer, and nothing you didn't ask for.",
          "If you ever have a question, just reply to this email.",
        ]),
      },
    ],
  },
  {
    key: "onboarding",
    name: "3-email onboarding series",
    description: "Welcome new subscribers, then follow up with tips over the next few days.",
    summary: "3 emails over 5 days",
    steps: [
      {
        delayMinutes: 0,
        subject: "Welcome, {{first_name | friend}}!",
        previewText: "Thanks for signing up - here's how to get started.",
        ...email(
          "Welcome aboard!",
          [
            "Hi {{first_name | there}},",
            "Thanks for signing up. Over the next few days we'll send you a couple of short emails to help you get started.",
            "For now, there's just one thing to do: have a look around.",
          ],
          { label: "Get started", url: "https://example.com" },
        ),
      },
      {
        delayMinutes: 2 * DAY,
        subject: "A quick tip to get more out of it",
        previewText: "Two minutes that make a difference.",
        ...email("One quick tip", [
          "Hi {{first_name | there}},",
          "Now that you've had a couple of days to settle in, here is the one thing our happiest customers do first.",
          "Replace this paragraph with your best tip, and link to the page where they can try it.",
        ]),
      },
      {
        delayMinutes: 3 * DAY,
        subject: "How is it going, {{first_name | friend}}?",
        previewText: "We'd love to hear from you.",
        ...email("How is it going?", [
          "Hi {{first_name | there}},",
          "You've been with us for almost a week. Is there anything we can help with?",
          "Just reply to this email - a real person reads every message.",
        ]),
      },
    ],
  },
];

export function findExample(key: string | undefined): AutomationExample | undefined {
  return key ? AUTOMATION_EXAMPLES.find((e) => e.key === key) : undefined;
}
