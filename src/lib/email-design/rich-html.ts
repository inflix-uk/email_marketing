import { escapeText, renderRichParagraphs, sanitizeLinkUrl } from "./rich-text";

// The text editor's stored format: a small, safe subset of HTML.
//
//   <p>Hello <b>bold</b> <i>italic</i> <u>underline</u> <s>strike</s>
//      <a href="https://example.com">a link</a><br>next line</p>
//   <span style="color:#ff0000;font-weight:bold">styled</span>
//
// sanitizeRichHtml() turns anything (the editor's innerHTML, pasted HTML,
// a stored design) into that subset. It runs in the editor on every change
// and again in the renderer, so stored HTML is never trusted. Pure and
// client-safe: a tiny tokenizer, no DOM.

/** Inline tags that are kept (aliases map to the kept name). */
const INLINE_TAGS: Record<string, string> = {
  b: "b",
  strong: "strong",
  i: "i",
  em: "em",
  u: "u",
  ins: "u",
  s: "s",
  strike: "s",
  del: "s",
  span: "span",
  font: "span",
  a: "a",
};

/** Tags that start a new paragraph. */
const BLOCK_TAGS = new Set([
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ul", "ol", "dl", "dt", "dd", "blockquote",
  "section", "article", "header", "footer", "main", "aside", "nav", "table", "thead", "tbody", "tfoot",
  "tr", "td", "th", "caption", "pre", "hr", "figure", "figcaption", "address", "center", "form",
  "fieldset", "body", "html",
]);

/** Tags removed together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  "script", "style", "head", "title", "template", "iframe", "object", "embed", "noscript", "textarea",
  "select", "option", "svg", "math", "xml", "button", "canvas", "audio", "video", "frameset", "frame",
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  bull: "•",
};

/** Decode HTML character references. Unknown names are left as written. */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);?/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { kind: "text"; value: string }
  | { kind: "open"; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { kind: "close"; name: string };

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/y;
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let text = "";
  let i = 0;
  const flush = () => {
    if (text) tokens.push({ kind: "text", value: decodeEntities(text) });
    text = "";
  };
  while (i < input.length) {
    const lt = input.indexOf("<", i);
    if (lt === -1) {
      text += input.slice(i);
      break;
    }
    text += input.slice(i, lt);
    i = lt;
    if (input.startsWith("<!--", i)) {
      const end = input.indexOf("-->", i + 4);
      i = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input[i + 1] === "!" || input[i + 1] === "?") {
      const end = input.indexOf(">", i);
      i = end === -1 ? input.length : end + 1;
      continue;
    }
    TAG_RE.lastIndex = i;
    const m = TAG_RE.exec(input);
    if (!m) {
      text += "<";
      i++;
      continue;
    }
    flush();
    i += m[0].length;
    const name = m[2].toLowerCase();
    if (m[1]) {
      tokens.push({ kind: "close", name });
      continue;
    }
    if (DROP_WITH_CONTENT.has(name) && !m[4]) {
      // Skip to the matching close tag (or the end).
      const close = new RegExp(`</${name}\\s*>`, "ig");
      close.lastIndex = i;
      const end = close.exec(input);
      i = end ? end.index + end[0].length : input.length;
      continue;
    }
    tokens.push({ kind: "open", name, attrs: parseAttrs(m[3]), selfClosing: Boolean(m[4]) });
  }
  flush();
  return tokens;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

/** "#abc", "#aabbcc" or "rgb(1, 2, 3)" -> "#aabbcc"; null for anything else. */
export function safeColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) return `#${hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1]}`;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(?:1|1\.0+|0?\.\d+|0)\s*)?\)$/.exec(v);
  if (rgb) return `#${toHex(+rgb[1])}${toHex(+rgb[2])}${toHex(+rgb[3])}`;
  return null;
}

/** Keep only colour, bold, italic, underline and strike-through from a style attribute. */
export function safeStyle(style: string): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of style.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim().toLowerCase().replace(/\s*!important$/, "");
    let kept: string | null = null;
    if (prop === "color") {
      const color = safeColor(value);
      if (color) kept = `color:${color}`;
    } else if (prop === "font-weight") {
      if (value === "bold" || value === "bolder" || /^[6-9]00$/.test(value)) kept = "font-weight:bold";
      else if (value === "normal" || value === "400") kept = "font-weight:normal";
    } else if (prop === "font-style") {
      if (value === "italic" || value === "oblique") kept = "font-style:italic";
      else if (value === "normal") kept = "font-style:normal";
    } else if (prop === "text-decoration" || prop === "text-decoration-line") {
      if (value.includes("underline")) kept = "text-decoration:underline";
      else if (value.includes("line-through")) kept = "text-decoration:line-through";
      else if (value === "none") kept = "text-decoration:none";
    }
    if (kept) {
      const key = kept.slice(0, kept.indexOf(":"));
      if (!seen.has(key)) {
        seen.add(key);
        out.push(kept);
      }
    }
  }
  return out.join(";");
}

// ---------------------------------------------------------------------------
// Sanitizer
// ---------------------------------------------------------------------------

export interface RichHtmlOptions {
  /** Inline style added to every link (the email renderer passes the accent colour). */
  linkStyle?: string;
}

interface OpenInline {
  /** Name in the source (for matching the close tag). */
  source: string;
  /** Kept element, or null when the tag is dropped but its content kept. */
  open: string | null;
  close: string;
  isLink: boolean;
}

/** Escape text for output: merge tags stay, non-breaking spaces stay visible. */
function emitText(value: string): string {
  return escapeText(value).replace(/ /g, "&nbsp;");
}

/** Remove elements left with nothing inside (repeated, for nesting). */
function dropEmptyElements(html: string): string {
  const empty = /<(b|strong|i|em|u|s|span|a)(?:\s[^>]*)?>\s*<\/\1>/g;
  let previous;
  do {
    previous = html;
    html = html.replace(empty, (m) => (/\s/.test(m.replace(/<[^>]*>/g, "")) ? " " : ""));
  } while (html !== previous);
  return html;
}

/** Trim spaces and line breaks at the start and end of a paragraph. */
function trimParagraph(html: string): string {
  return html.replace(/^(?:\s|<br>)+/, "").replace(/(?:\s|<br>)+$/, "");
}

/**
 * Sanitize rich text into paragraphs. Each entry is one paragraph's inline
 * HTML; an empty line between paragraphs is kept as "" (rendered as a blank
 * line). Leading and trailing empty paragraphs are dropped.
 */
export function richHtmlParagraphs(input: string, options: RichHtmlOptions = {}): string[] {
  const linkStyle = options.linkStyle ? ` style="${options.linkStyle}"` : "";
  const paragraphs: string[] = [];
  const stack: OpenInline[] = [];
  let current = "";
  /** True once the current paragraph came from an explicit block tag (so an empty one counts). */
  let explicit = false;

  const reopen = () => stack.map((entry) => entry.open ?? "").join("");
  const closeAll = () =>
    stack
      .slice()
      .reverse()
      .map((entry) => (entry.open ? entry.close : ""))
      .join("");

  const flush = (keepEmpty: boolean) => {
    const html = trimParagraph(dropEmptyElements(current + closeAll()));
    if (html || (keepEmpty && explicit)) paragraphs.push(html);
    current = reopen();
    explicit = false;
  };

  for (const token of tokenize(input)) {
    if (token.kind === "text") {
      current += emitText(token.value.replace(/[\t\n\r\f ]+/g, " "));
      continue;
    }

    const { name } = token;
    if (token.kind === "open") {
      if (name === "br") {
        current += "<br>";
        continue;
      }
      if (BLOCK_TAGS.has(name)) {
        flush(false);
        explicit = true;
        continue;
      }
      if (token.selfClosing || name === "img" || name === "input" || name === "wbr" || name === "meta" || name === "link") {
        continue;
      }
      const kept = INLINE_TAGS[name];
      let entry: OpenInline = { source: name, open: null, close: "", isLink: false };
      if (kept === "a") {
        const href = sanitizeLinkUrl(token.attrs.href ?? "");
        // No nested links; an unsafe target keeps the text only.
        if (href && !stack.some((e) => e.isLink)) {
          entry = { source: name, open: `<a href="${escapeText(href)}"${linkStyle}>`, close: "</a>", isLink: true };
        }
      } else if (kept === "span") {
        let style = safeStyle(token.attrs.style ?? "");
        if (name === "font" && token.attrs.color) {
          const color = safeColor(token.attrs.color);
          if (color && !style.includes("color:")) style = style ? `color:${color};${style}` : `color:${color}`;
        }
        if (style) entry = { source: name, open: `<span style="${style}">`, close: "</span>", isLink: false };
      } else if (kept) {
        entry = { source: name, open: `<${kept}>`, close: `</${kept}>`, isLink: false };
      }
      stack.push(entry);
      current += entry.open ?? "";
      continue;
    }

    // Close tag.
    if (BLOCK_TAGS.has(name)) {
      flush(true);
      continue;
    }
    let index = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].source === name) {
        index = i;
        break;
      }
    }
    if (index === -1) continue;
    // Close everything opened inside it too (mis-nested markup).
    while (stack.length > index) {
      const entry = stack.pop()!;
      if (entry.open) current += entry.close;
    }
  }

  const last = trimParagraph(dropEmptyElements(current + closeAll()));
  if (last || explicit) paragraphs.push(last);

  // Collapse runs of empty paragraphs to one and drop them at the ends.
  const result: string[] = [];
  for (const p of paragraphs) {
    if (!p && (result.length === 0 || result[result.length - 1] === "")) continue;
    result.push(p);
  }
  while (result.length && result[result.length - 1] === "") result.pop();
  return result;
}

/** Canonical stored form: "<p>...</p>" per paragraph ("<p><br></p>" for a blank line), or "" when empty. */
export function sanitizeRichHtml(input: string): string {
  return richHtmlParagraphs(input)
    .map((p) => `<p>${p || "<br>"}</p>`)
    .join("");
}

/** The old "simple rich text" (**bold**, *italic*, [text](url)) as rich HTML. */
export function markdownToRichHtml(text: string): string {
  return sanitizeRichHtml(renderRichParagraphs(text, { linkStyle: "" }).map((p) => `<p>${p}</p>`).join(""));
}

/** Plain text of rich HTML (for summaries). */
export function richHtmlToPlainText(html: string): string {
  const text = richHtmlParagraphs(html)
    .map((p) => p.replace(/<br>/g, " ").replace(/<[^>]*>/g, ""))
    .join(" ");
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

/** True when the rich HTML shows any text. */
export function hasRichText(html: string): boolean {
  return richHtmlToPlainText(html).length > 0;
}
