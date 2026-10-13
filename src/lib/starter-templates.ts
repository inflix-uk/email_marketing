import { DEFAULT_STYLES, renderDesign, serializeDesign, toDesign, type EmailDesign } from "@/lib/email-design";

// Ready-made email templates offered when creating a new template or
// campaign and used by the seed script. Each starter is a visual design
// (see @/lib/email-design), so it opens in the visual editor; `html` is the
// table-based, inline-styled email generated from it.

export interface StarterTemplate {
  key: string;
  name: string;
  description: string;
  subject: string;
  previewText: string;
  html: string;
  /** Visual-editor design (JSON string) the html was generated from; null = hand-written HTML. */
  design: string | null;
}

function starter(
  meta: Omit<StarterTemplate, "html" | "design">,
  blocks: Record<string, unknown>[],
): StarterTemplate {
  const design: EmailDesign | null = toDesign({
    styles: DEFAULT_STYLES,
    blocks: blocks.map((block, i) => ({ id: `${meta.key}-${i + 1}`, ...block })),
  });
  if (!design) throw new Error(`Starter template "${meta.key}" is not a valid design`);
  return { ...meta, html: renderDesign(design), design: serializeDesign(design) };
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  starter(
    {
      key: "newsletter",
      name: "Simple newsletter",
      description: "Heading, a few paragraphs and a call-to-action button.",
      subject: "Our latest news, {{first_name | friend}}",
      previewText: "Here's what's new this month.",
    },
    [
      { type: "heading", level: 1, text: "Hi {{first_name | there}}," },
      {
        type: "text",
        text:
          "Here's a quick round-up of what we've been working on this month.\n\n" +
          "Replace this text with your own story. Keep paragraphs short, and lead with the thing your reader cares about most.",
      },
      { type: "button", label: "Read more", url: "https://example.com" },
    ],
  ),
  starter(
    {
      key: "announcement",
      name: "Announcement",
      description: "Big headline and one clear action - for launches and offers.",
      subject: "Big news, {{first_name | friend}}!",
      previewText: "Something new is here.",
    },
    [
      { type: "text", text: "**ANNOUNCEMENT**", size: "small", align: "center", color: DEFAULT_STYLES.accentColor },
      { type: "heading", level: 1, text: "Something new is here", align: "center" },
      {
        type: "text",
        text: "{{first_name | Hi}}, we're excited to share our latest launch with you. Describe the benefit in one or two sentences.",
        align: "center",
      },
      { type: "button", label: "Find out more", url: "https://example.com", align: "center" },
      { type: "text", text: "Questions? Just reply to this email.", size: "small", align: "center", color: "#6b7280" },
    ],
  ),
  starter(
    {
      key: "plain",
      name: "Plain text style",
      description: "Looks like a personal email - great for deliverability.",
      subject: "Quick question, {{first_name | there}}",
      previewText: "",
    },
    [
      {
        type: "text",
        text:
          "Hi {{first_name | there}},\n\n" +
          "Write your message here, as if you were writing to one person.\n\n" +
          "Best,\nThe Team",
      },
    ],
  ),
];
