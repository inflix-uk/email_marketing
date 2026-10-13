import { escapeText, hasText, renderRichInline, renderRichParagraphs, sanitizeImageUrl, sanitizeLinkUrl } from "./rich-text";
import {
  FONT_FAMILIES,
  type Align,
  type Block,
  type ButtonBlock,
  type ColumnChild,
  type ColumnsBlock,
  type DesignStyles,
  type EmailDesign,
  type FooterBlock,
  type HeadingBlock,
  type ImageBlock,
  type TextBlock,
} from "./schema";

// Design -> email HTML. Table-based layout with inline styles so it holds up
// in Outlook, Gmail and Apple Mail: a centred fixed-width card (ghost table
// for Outlook), padded-cell buttons, and one small media query that tightens
// the side padding and stacks columns on phones. Pure and client-safe, so the
// editor preview and the server produce exactly the same HTML.
//
// All user text is escaped (merge tags pass through for the sender to fill
// in), links are limited to http(s)/mailto, and colours / sizes come from the
// validated design, never from free text.

export interface RenderOptions {
  /**
   * Editor preview only: show a dashed box for blocks that have no content
   * yet (e.g. an image without a source). Never use for HTML that is saved.
   */
  placeholders?: boolean;
}

/** Side padding of the content card (px). The media query uses MOBILE_SIDE_PADDING. */
const SIDE_PADDING = 40;
const MOBILE_SIDE_PADDING = 24;
/** Space above the first / below the last block of the card. */
const EDGE_PADDING = 40;
/** Half the space between two blocks. */
const BLOCK_GAP = 10;
const COLUMN_GAP = 20;

const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

const HEADING_SIZES: Record<HeadingBlock["level"], string> = {
  1: "font-size:28px;line-height:36px;",
  2: "font-size:22px;line-height:30px;",
  3: "font-size:18px;line-height:26px;",
};

const TEXT_SIZES: Record<TextBlock["size"], string> = {
  small: "font-size:14px;line-height:21px;",
  normal: "font-size:16px;line-height:24px;",
  large: "font-size:18px;line-height:28px;",
};

interface Context {
  styles: DesignStyles;
  font: string;
  placeholders: boolean;
}

/** One row of the content card. */
type Row =
  | { kind: "cell"; html: string; align?: Align; cellStyle?: string }
  | { kind: "spacer"; height: number };

function linkStyle(ctx: Context, color = ctx.styles.accentColor): string {
  return `color:${color};text-decoration:underline;`;
}

function placeholder(ctx: Context, label: string): string {
  return (
    `<table ${TABLE} width="100%"><tr>` +
    `<td align="center" style="padding:24px 16px;border:2px dashed #cbd5e1;border-radius:6px;font-family:${ctx.font};font-size:13px;line-height:20px;color:#64748b;">${label}</td>` +
    `</tr></table>`
  );
}

function renderHeading(block: HeadingBlock, ctx: Context): string {
  if (!hasText(block.text)) return ctx.placeholders ? placeholder(ctx, "Empty heading") : "";
  const tag = `h${block.level}`;
  const style =
    `margin:0;font-family:${ctx.font};${HEADING_SIZES[block.level]}font-weight:bold;` +
    `color:${ctx.styles.headingColor};text-align:${block.align};`;
  return `<${tag} style="${style}">${escapeText(block.text.trim())}</${tag}>`;
}

function renderText(block: TextBlock, ctx: Context): string {
  const paragraphs = renderRichParagraphs(block.text, { linkStyle: linkStyle(ctx) });
  if (paragraphs.length === 0) return ctx.placeholders ? placeholder(ctx, "Empty text block") : "";
  const style =
    `font-family:${ctx.font};${TEXT_SIZES[block.size]}color:${block.color ?? ctx.styles.textColor};` +
    `text-align:${block.align};`;
  return paragraphs
    .map((html, i) => {
      const margin = i === paragraphs.length - 1 ? "margin:0;" : "margin:0 0 16px;";
      return `<p style="${margin}${style}">${html}</p>`;
    })
    .join("\n");
}

function renderImage(block: ImageBlock, ctx: Context, availableWidth: number): string {
  const src = sanitizeImageUrl(block.src);
  if (!src) return ctx.placeholders ? placeholder(ctx, "Image: upload or choose one") : "";
  const width = Math.max(1, Math.round((availableWidth * block.width) / 100));
  const img =
    `<img src="${escapeText(src)}" alt="${escapeText(block.alt.trim())}" width="${width}" ` +
    `style="display:inline-block;width:${width}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;vertical-align:top;` +
    // Styles the alt text shown while images are blocked (the cell itself has font-size:0).
    `font-family:${ctx.font};font-size:14px;line-height:20px;color:${ctx.styles.textColor};">`;
  const href = sanitizeLinkUrl(block.link);
  return href ? `<a href="${escapeText(href)}" style="text-decoration:none;">${img}</a>` : img;
}

/** "Bulletproof" button: the coloured cell carries the shape, so it also works where <a> padding is ignored. */
function renderButton(block: ButtonBlock, ctx: Context): string {
  if (!hasText(block.label)) return ctx.placeholders ? placeholder(ctx, "Button without a label") : "";
  const background = block.backgroundColor ?? ctx.styles.accentColor;
  const href = sanitizeLinkUrl(block.url);
  const linkAttrs = href ? ` href="${escapeText(href)}"` : "";
  const style =
    `display:inline-block;padding:12px 24px;font-family:${ctx.font};font-size:16px;line-height:20px;font-weight:bold;` +
    `color:${block.textColor};text-decoration:none;border-radius:6px;`;
  return (
    `<table ${TABLE}><tr>` +
    `<td align="center" bgcolor="${background}" style="background-color:${background};border-radius:6px;mso-padding-alt:12px 24px;">` +
    `<a${linkAttrs} style="${style}">${escapeText(block.label.trim())}</a>` +
    `</td></tr></table>`
  );
}

function renderDivider(color: string): string {
  return (
    `<table ${TABLE} width="100%"><tr>` +
    `<td style="border-top:1px solid ${color};font-size:0;line-height:0;height:1px;">&nbsp;</td>` +
    `</tr></table>`
  );
}

function renderColumnChild(child: ColumnChild, ctx: Context, width: number): { html: string; align: Align } {
  switch (child.type) {
    case "text":
      return { html: renderText(child, ctx), align: "left" };
    case "image":
      return { html: renderImage(child, ctx, width), align: child.align };
    case "button":
      return { html: renderButton(child, ctx), align: child.align };
  }
}

function renderColumns(block: ColumnsBlock, ctx: Context, availableWidth: number): string {
  const columnWidth = Math.floor((availableWidth - COLUMN_GAP) / 2);
  const cells = block.columns.map((column, index) => {
    const rows = column.blocks
      .map((child) => ({ child, ...renderColumnChild(child, ctx, columnWidth) }))
      .filter((row) => row.html);
    const inner = rows
      .map((row, i) => {
        const padding = i === rows.length - 1 ? "0" : "0 0 12px";
        const imageCell = row.child.type === "image" ? "font-size:0;line-height:0;" : "";
        return `<tr><td align="${row.align}" style="padding:${padding};${imageCell}">${row.html}</td></tr>`;
      })
      .join("\n");
    const side = index === 0 ? `padding-right:${COLUMN_GAP / 2}px;` : `padding-left:${COLUMN_GAP / 2}px;`;
    const className = index === 0 ? "em-col em-col-first" : "em-col";
    const content = inner ? `<table ${TABLE} width="100%">\n${inner}\n</table>` : "&nbsp;";
    return `<td class="${className}" width="50%" valign="top" style="width:50%;vertical-align:top;${side}">\n${content}\n</td>`;
  });
  const empty = block.columns.every((column) => column.blocks.length === 0);
  if (empty && !ctx.placeholders) return "";
  if (empty) return placeholder(ctx, "Empty columns");
  return `<table ${TABLE} width="100%"><tr>\n${cells.join("\n")}\n</tr></table>`;
}

function renderRow(block: Exclude<Block, FooterBlock>, ctx: Context, availableWidth: number): Row | null {
  switch (block.type) {
    case "heading": {
      const html = renderHeading(block, ctx);
      return html ? { kind: "cell", html } : null;
    }
    case "text": {
      const html = renderText(block, ctx);
      return html ? { kind: "cell", html } : null;
    }
    case "image": {
      const html = renderImage(block, ctx, availableWidth);
      // The alignment lives on the cell (works in Outlook); no line box around the image.
      return html ? { kind: "cell", html, align: block.align, cellStyle: "font-size:0;line-height:0;" } : null;
    }
    case "button": {
      const html = renderButton(block, ctx);
      return html ? { kind: "cell", html, align: block.align } : null;
    }
    case "divider":
      return { kind: "cell", html: renderDivider(block.color) };
    case "columns": {
      const html = renderColumns(block, ctx, availableWidth);
      return html ? { kind: "cell", html } : null;
    }
    case "spacer":
      return { kind: "spacer", height: block.height };
  }
}

function renderCard(rows: Row[], ctx: Context): string {
  if (rows.length === 0) return "";
  const { styles } = ctx;
  const body = rows
    .map((row, i) => {
      if (row.kind === "spacer") {
        return `<tr><td height="${row.height}" style="height:${row.height}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
      }
      const top = i === 0 ? EDGE_PADDING : BLOCK_GAP;
      const bottom = i === rows.length - 1 ? EDGE_PADDING : BLOCK_GAP;
      const style = `padding:${top}px ${SIDE_PADDING}px ${bottom}px;${row.cellStyle ?? ""}`;
      return `<tr>\n<td class="em-pad" align="${row.align ?? "left"}" style="${style}">\n${row.html}\n</td>\n</tr>`;
    })
    .join("\n");
  return (
    `<table ${TABLE} width="100%" bgcolor="${styles.contentBackground}" ` +
    `style="max-width:${styles.contentWidth}px;background-color:${styles.contentBackground};border-radius:8px;">\n${body}\n</table>\n`
  );
}

function renderFooter(block: FooterBlock, ctx: Context): string {
  const style =
    `padding:24px 16px;font-family:${ctx.font};font-size:12px;line-height:18px;color:${block.color};text-align:center;`;
  const link = linkStyle(ctx, block.color);
  const text = renderRichInline(block.text, { linkStyle: link });
  const label = escapeText(block.unsubscribeLabel.trim() || "Unsubscribe");
  const lines = ["{{company_address}}", text, `<a href="{{unsubscribe_url}}" style="${link}">${label}</a>`];
  return (
    `<table ${TABLE} width="100%" style="max-width:${ctx.styles.contentWidth}px;">\n<tr>\n` +
    `<td align="center" style="${style}">\n${lines.filter(Boolean).join("<br>\n")}\n</td>\n</tr>\n</table>\n`
  );
}

/** The complete HTML document for a design. */
export function renderDesign(design: EmailDesign, options: RenderOptions = {}): string {
  const { styles } = design;
  const ctx: Context = {
    styles,
    font: FONT_FAMILIES[styles.fontFamily].stack,
    placeholders: options.placeholders === true,
  };
  const availableWidth = styles.contentWidth - SIDE_PADDING * 2;

  const rows: Row[] = [];
  let footer: FooterBlock | null = null;
  for (const block of design.blocks) {
    if (block.type === "footer") {
      footer ??= block;
      continue;
    }
    const row = renderRow(block, ctx, availableWidth);
    if (row) rows.push(row);
  }
  // Parsed designs always end with a footer; hand-built ones still get one.
  footer ??= { id: "footer", type: "footer", text: "", unsubscribeLabel: "Unsubscribe", color: "#6b7280" };

  const breakpoint = styles.contentWidth + 32;
  return `<!DOCTYPE html>
<html lang="en" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title></title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
@media only screen and (max-width:${breakpoint}px) {
  .em-pad { padding-left:${MOBILE_SIDE_PADDING}px !important; padding-right:${MOBILE_SIDE_PADDING}px !important; }
  .em-col { display:block !important; width:100% !important; padding-left:0 !important; padding-right:0 !important; }
  .em-col-first { padding-bottom:20px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${styles.pageBackground};">
<table ${TABLE} width="100%" bgcolor="${styles.pageBackground}" style="background-color:${styles.pageBackground};">
<tr>
<td align="center" style="padding:32px 16px;">
<!--[if mso]><table ${TABLE} width="${styles.contentWidth}" align="center"><tr><td><![endif]-->
${renderCard(rows, ctx)}${renderFooter(footer, ctx)}<!--[if mso]></td></tr></table><![endif]-->
</td>
</tr>
</table>
</body>
</html>`;
}
