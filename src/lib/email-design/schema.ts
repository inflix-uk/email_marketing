import { z } from "zod";

// The visual editor's document model. A design is saved as a JSON string
// next to the HTML generated from it (TemplateDoc.design, CampaignDoc.design,
// AutomationStep.design). Pure and client-safe: no DB, no Node APIs.

export const DESIGN_VERSION = 1;

// ---------------------------------------------------------------------------
// Limits and option lists
// ---------------------------------------------------------------------------

/** Web-safe font stacks (no web fonts: most inboxes don't load them). */
export const FONT_FAMILIES = {
  arial: { label: "Arial", stack: "Arial,Helvetica,sans-serif" },
  helvetica: { label: "Helvetica", stack: "Helvetica,Arial,sans-serif" },
  verdana: { label: "Verdana", stack: "Verdana,Geneva,sans-serif" },
  tahoma: { label: "Tahoma", stack: "Tahoma,Verdana,sans-serif" },
  trebuchet: { label: "Trebuchet MS", stack: "'Trebuchet MS',Tahoma,sans-serif" },
  georgia: { label: "Georgia", stack: "Georgia,'Times New Roman',serif" },
  times: { label: "Times New Roman", stack: "'Times New Roman',Times,serif" },
  courier: { label: "Courier New", stack: "'Courier New',Courier,monospace" },
} as const;

export type FontFamilyKey = keyof typeof FONT_FAMILIES;
export const FONT_FAMILY_KEYS = Object.keys(FONT_FAMILIES) as FontFamilyKey[];

export const CONTENT_WIDTH = { min: 480, max: 720, step: 20, default: 600 } as const;
export const SPACER_HEIGHT = { min: 8, max: 120, step: 4, default: 24 } as const;
export const IMAGE_WIDTH = { min: 10, max: 100, step: 5, default: 100 } as const;

export const MAX_BLOCKS = 200;
export const MAX_COLUMN_BLOCKS = 10;
const MAX_TEXT = 20_000;
const MAX_SHORT_TEXT = 500;
const MAX_URL = 2_000;

export const ALIGNMENTS = ["left", "center", "right"] as const;
export type Align = (typeof ALIGNMENTS)[number];

export const TEXT_SIZES = ["small", "normal", "large"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value);
}

/** "#ABC", "abc" or "AABBCC" -> "#aabbcc". Null when it is not a hex colour (yet). */
export function normalizeHexColor(input: string): string | null {
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(input.trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? [...match[1]].map((ch) => ch + ch).join("") : match[1];
  return `#${hex.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const color = z
  .string()
  .regex(HEX_COLOR_RE)
  .transform((value) => value.toLowerCase());
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const align = z.enum(ALIGNMENTS);
const longText = z.string().max(MAX_TEXT);
const shortText = z.string().max(MAX_SHORT_TEXT);
const url = z.string().max(MAX_URL);
const clampedInt = (range: { min: number; max: number; default: number }) =>
  z
    .number()
    .transform((n) => (Number.isFinite(n) ? Math.min(range.max, Math.max(range.min, Math.round(n))) : range.default));

const stylesSchema = z.object({
  /** Behind the content card. */
  pageBackground: color.default("#f4f5f7"),
  contentBackground: color.default("#ffffff"),
  /** Width of the content card in px. */
  contentWidth: clampedInt(CONTENT_WIDTH).default(CONTENT_WIDTH.default),
  fontFamily: z.enum(FONT_FAMILY_KEYS).default("arial"),
  textColor: color.default("#374151"),
  headingColor: color.default("#111827"),
  /** Links and (unless a button overrides it) buttons. */
  accentColor: color.default("#4f46e5"),
});

const headingSchema = z.object({
  id,
  type: z.literal("heading"),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  /** Plain text; merge tags allowed. */
  text: shortText.default(""),
  align: align.default("left"),
});

const textSchema = z.object({
  id,
  type: z.literal("text"),
  /** Simple rich text - see rich-text.ts. */
  text: longText.default(""),
  align: align.default("left"),
  size: z.enum(TEXT_SIZES).default("normal"),
  /** null = the global text colour. */
  color: color.nullable().default(null),
});

const imageSchema = z.object({
  id,
  type: z.literal("image"),
  /** Absolute http(s) URL. */
  src: url.default(""),
  alt: shortText.default(""),
  /** Optional link around the image. */
  link: url.default(""),
  /** Percent of the available width. */
  width: clampedInt(IMAGE_WIDTH).default(IMAGE_WIDTH.default),
  align: align.default("center"),
});

const buttonSchema = z.object({
  id,
  type: z.literal("button"),
  label: shortText.default(""),
  url: url.default(""),
  /** null = the global accent colour. */
  backgroundColor: color.nullable().default(null),
  textColor: color.default("#ffffff"),
  align: align.default("left"),
});

const dividerSchema = z.object({
  id,
  type: z.literal("divider"),
  color: color.default("#e5e7eb"),
});

const spacerSchema = z.object({
  id,
  type: z.literal("spacer"),
  height: clampedInt(SPACER_HEIGHT).default(SPACER_HEIGHT.default),
});

const columnChildSchema = z.discriminatedUnion("type", [textSchema, imageSchema, buttonSchema]);

const columnSchema = z.object({
  blocks: z.array(columnChildSchema).max(MAX_COLUMN_BLOCKS).default([]),
});

const columnsSchema = z.object({
  id,
  type: z.literal("columns"),
  columns: z.tuple([columnSchema, columnSchema]),
});

const footerSchema = z.object({
  id,
  type: z.literal("footer"),
  /** Rich text shown between the company address and the unsubscribe link. */
  text: longText.default(""),
  unsubscribeLabel: shortText.default("Unsubscribe"),
  color: color.default("#6b7280"),
});

const blockSchema = z.discriminatedUnion("type", [
  headingSchema,
  textSchema,
  imageSchema,
  buttonSchema,
  dividerSchema,
  spacerSchema,
  columnsSchema,
  footerSchema,
]);

const designSchema = z.object({
  version: z.literal(DESIGN_VERSION).default(DESIGN_VERSION),
  styles: stylesSchema.default(() => stylesSchema.parse({})),
  blocks: z.array(blockSchema).max(MAX_BLOCKS).default([]),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DesignStyles = z.output<typeof stylesSchema>;
export type HeadingBlock = z.output<typeof headingSchema>;
export type TextBlock = z.output<typeof textSchema>;
export type ImageBlock = z.output<typeof imageSchema>;
export type ButtonBlock = z.output<typeof buttonSchema>;
export type DividerBlock = z.output<typeof dividerSchema>;
export type SpacerBlock = z.output<typeof spacerSchema>;
export type ColumnsBlock = z.output<typeof columnsSchema>;
export type FooterBlock = z.output<typeof footerSchema>;

/** What a column can hold. */
export type ColumnChild = TextBlock | ImageBlock | ButtonBlock;
export type ColumnChildType = ColumnChild["type"];
export const COLUMN_CHILD_TYPES: ColumnChildType[] = ["text", "image", "button"];

export type Block = z.output<typeof blockSchema>;
export type BlockType = Block["type"];
/** Everything except the footer, which always exists exactly once. */
export type AddableBlockType = Exclude<BlockType, "footer">;
export const ADDABLE_BLOCK_TYPES: AddableBlockType[] = [
  "heading",
  "text",
  "image",
  "button",
  "divider",
  "spacer",
  "columns",
];

export const BLOCK_LABELS: Record<BlockType, string> = {
  heading: "Heading",
  text: "Text",
  image: "Image",
  button: "Button",
  divider: "Divider",
  spacer: "Spacer",
  columns: "Two columns",
  footer: "Footer",
};

/**
 * A visual email design: global styles + an ordered list of blocks. The last
 * block is always the footer (company address + unsubscribe link).
 */
export interface EmailDesign {
  version: typeof DESIGN_VERSION;
  styles: DesignStyles;
  blocks: Block[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_STYLES: DesignStyles = stylesSchema.parse({});

export const DEFAULT_FOOTER_TEXT = "You are receiving this email because you subscribed to our updates.";

export function createFooter(blockId = "footer"): FooterBlock {
  return footerSchema.parse({ id: blockId, type: "footer", text: DEFAULT_FOOTER_TEXT });
}

/** A new block of the given type with sensible starting content. */
export function createBlock(type: "heading", blockId: string): HeadingBlock;
export function createBlock(type: "text", blockId: string): TextBlock;
export function createBlock(type: "image", blockId: string): ImageBlock;
export function createBlock(type: "button", blockId: string): ButtonBlock;
export function createBlock(type: "divider", blockId: string): DividerBlock;
export function createBlock(type: "spacer", blockId: string): SpacerBlock;
export function createBlock(type: "columns", blockId: string): ColumnsBlock;
export function createBlock(type: ColumnChildType, blockId: string): ColumnChild;
export function createBlock(type: AddableBlockType, blockId: string): Exclude<Block, FooterBlock>;
export function createBlock(type: AddableBlockType, blockId: string): Exclude<Block, FooterBlock> {
  switch (type) {
    case "heading":
      return headingSchema.parse({ id: blockId, type, text: "Your heading" });
    case "text":
      return textSchema.parse({ id: blockId, type, text: "Write your text here." });
    case "image":
      return imageSchema.parse({ id: blockId, type });
    case "button":
      return buttonSchema.parse({ id: blockId, type, label: "Read more", url: "https://example.com" });
    case "divider":
      return dividerSchema.parse({ id: blockId, type });
    case "spacer":
      return spacerSchema.parse({ id: blockId, type });
    case "columns":
      return columnsSchema.parse({
        id: blockId,
        type,
        columns: [
          { blocks: [{ id: `${blockId}-a`, type: "text", text: "Left column text." }] },
          { blocks: [{ id: `${blockId}-b`, type: "text", text: "Right column text." }] },
        ],
      });
  }
}

/** A short greeting, one paragraph and the footer. */
export const BLANK_DESIGN: EmailDesign = {
  version: DESIGN_VERSION,
  styles: DEFAULT_STYLES,
  blocks: [
    textSchema.parse({
      id: "intro",
      type: "text",
      text: "Hi {{first_name | there}},\n\nStart writing your email here.",
    }),
    createFooter(),
  ],
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Enforce the invariants the editor and renderer rely on: unique block ids
 * (also inside columns) and exactly one footer, in last place.
 */
export function normalizeDesign(design: EmailDesign): EmailDesign {
  const seen = new Set<string>();
  const unique = (wanted: string): string => {
    let candidate = wanted;
    for (let n = 2; seen.has(candidate); n++) candidate = `${wanted.slice(0, 56)}-${n}`;
    seen.add(candidate);
    return candidate;
  };

  let footer: FooterBlock | null = null;
  const blocks: Block[] = [];
  for (const block of design.blocks) {
    if (block.type === "footer") {
      footer ??= block;
      continue;
    }
    const blockId = unique(block.id);
    if (block.type === "columns") {
      const [left, right] = block.columns.map((column) => ({
        blocks: column.blocks.map((child) => {
          const childId = unique(child.id);
          return childId === child.id ? child : { ...child, id: childId };
        }),
      }));
      blocks.push({ ...block, id: blockId, columns: [left, right] });
    } else {
      blocks.push(blockId === block.id ? block : { ...block, id: blockId });
    }
  }
  const last = footer ?? createFooter();
  blocks.push({ ...last, id: unique(last.id) });
  return { version: DESIGN_VERSION, styles: design.styles, blocks };
}

/** Validate an already-decoded value. Null when it isn't a design. */
export function toDesign(value: unknown): EmailDesign | null {
  const parsed = designSchema.safeParse(value);
  return parsed.success ? normalizeDesign(parsed.data) : null;
}

/**
 * Read a saved design. Never throws: null for missing, malformed or invalid
 * input (the caller then treats the email as hand-written HTML).
 */
export function parseDesign(json: string | null | undefined): EmailDesign | null {
  if (typeof json !== "string" || !json.trim()) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  return toDesign(value);
}

/**
 * Canonical JSON for storage: validated, normalised, keys in a fixed order -
 * so the same design always serialises to the same string.
 */
export function serializeDesign(design: EmailDesign): string {
  return JSON.stringify(toDesign(design) ?? normalizeDesign(design));
}
