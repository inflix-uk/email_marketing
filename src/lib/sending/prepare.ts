// Builds the exact message a contact receives. Pure: no database access, so
// it is unit-testable and shared by the worker (real sends) and test sends.
// Callers fetch the LinkContext (`await getLinkContext()`) and the company
// address (`(await getSettings()).companyAddress`) once per batch.

import type { OutgoingEmail } from "@/lib/mailer";
import {
  escapeHtml,
  extractMergeTags,
  htmlToText,
  renderMergeTags,
  type MergeContact,
  type MergeData,
} from "@/lib/render";
import {
  buildClickUrl,
  buildOneClickUnsubscribeUrl,
  buildOpenPixelUrl,
  buildUnsubscribeUrl,
  type LinkContext,
} from "@/lib/tokens";

/** The parts of a campaign (or of an ad-hoc test) needed to build an email. */
export interface EmailContent {
  subject: string;
  previewText?: string | null;
  html: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
}

/** Per-batch context shared by every message of a campaign send. */
export interface CampaignBuildContext {
  /** Signs the tracking + unsubscribe links. */
  links: LinkContext;
  /** Postal address for {{company_address}} and the automatic footer. */
  companyAddress: string;
}

export type BuildOptions = {
  /** Link used for {{unsubscribe_url}} and the automatic footer. */
  unsubscribeUrl: string;
  /** Postal address for {{company_address}} and the automatic footer. */
  companyAddress?: string;
} & (
  | {
      /**
       * Real send id: enables click + open tracking and the RFC 8058
       * List-Unsubscribe headers (signed with `links`).
       */
      sendId: string;
      links: LinkContext;
    }
  | {
      /** `null` for test sends and previews: no tracking, no List-Unsubscribe headers. */
      sendId: null;
      links?: LinkContext;
    }
);

/** Build the outgoing message for one campaign recipient (tracking on). */
export function buildCampaignEmail(
  content: EmailContent,
  contact: MergeContact,
  sendId: string,
  ctx: CampaignBuildContext,
): OutgoingEmail {
  return buildEmail(content, contact, {
    sendId,
    links: ctx.links,
    unsubscribeUrl: buildUnsubscribeUrl(ctx.links, sendId),
    companyAddress: ctx.companyAddress,
  });
}

export function buildEmail(content: EmailContent, contact: MergeContact, opts: BuildOptions): OutgoingEmail {
  const companyAddress = opts.companyAddress?.trim() ?? "";
  const data: MergeData = { contact, unsubscribeUrl: opts.unsubscribeUrl, companyAddress };

  const subject = oneLine(renderMergeTags(content.subject, data));
  let html = renderMergeTags(content.html, data, { escape: true });

  // Every marketing email must carry a working unsubscribe link.
  if (!hasUnsubscribeTag(content.html)) {
    html = appendUnsubscribeFooter(html, opts.unsubscribeUrl, companyAddress);
  }

  // Plain-text part from the untracked HTML: readable URLs, no hidden preheader.
  const text = htmlToText(stripHiddenElements(html));

  const previewText = content.previewText?.trim()
    ? oneLine(renderMergeTags(content.previewText, data, { escape: true }))
    : "";
  if (previewText) html = injectPreheader(html, previewText);

  const headers: Record<string, string> = {};
  if (opts.sendId !== null) {
    html = rewriteLinks(html, opts.sendId, opts.links);
    html = addOpenPixel(html, opts.sendId, opts.links);
    headers["List-Unsubscribe"] = `<${buildOneClickUnsubscribeUrl(opts.links, opts.sendId)}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  return {
    to: contact.email,
    from: { name: oneLine(content.fromName), address: content.fromEmail.trim() },
    replyTo: content.replyTo?.trim() || null,
    subject,
    html,
    text,
    headers,
  };
}

// ---------------------------------------------------------------------------
// HTML transforms (exported for tests)
// ---------------------------------------------------------------------------

/** Collapse whitespace/newlines - for header values like the subject. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const BODY_OPEN_RE = /<body\b(?:[^>"']|"[^"]*"|'[^']*')*>/i;

function insertAfterBodyOpen(html: string, snippet: string): string {
  const m = BODY_OPEN_RE.exec(html);
  if (!m) return snippet + html;
  const at = m.index + m[0].length;
  return html.slice(0, at) + snippet + html.slice(at);
}

function insertBeforeBodyClose(html: string, snippet: string): string {
  const at = html.toLowerCase().lastIndexOf("</body");
  if (at === -1) return html + snippet;
  return html.slice(0, at) + snippet + html.slice(at);
}

/** Decode the HTML entities that can appear in attribute values (single pass). */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, name: string) => {
    const key = name.toLowerCase();
    if (key.startsWith("#x")) return safeFromCodePoint(parseInt(key.slice(2), 16), m);
    if (key.startsWith("#")) return safeFromCodePoint(parseInt(key.slice(1), 10), m);
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[key] ?? m;
  });
}

function safeFromCodePoint(code: number, fallback: string): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

/** Visible text of an HTML fragment, for comparisons. */
function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/&zwnj;/gi, ""))
    .replace(/[\s ͏‌ ﻿]+/g, " ")
    .trim();
}

const HIDDEN_ELEMENT_RE = /<(div|span)\b[^>]*display\s*:\s*none[^>]*>([\s\S]*?)<\/\1>/gi;

/** Remove display:none elements (preheaders) - used before generating the text part. */
export function stripHiddenElements(html: string): string {
  return html.replace(HIDDEN_ELEMENT_RE, "");
}

/** Filler after the preheader so inbox previews don't pull in the body text. */
const PREHEADER_FILLER = "&#847;&zwnj;&nbsp;".repeat(40);

/**
 * Hidden "preheader" shown by inboxes next to the subject. Inserted right
 * after <body>, unless the HTML already contains a hidden element with the
 * same text (e.g. the starter templates' own preheader div).
 */
export function injectPreheader(html: string, previewHtml: string): string {
  const wanted = textOf(previewHtml);
  if (!wanted) return html;
  for (const m of html.matchAll(HIDDEN_ELEMENT_RE)) {
    if (textOf(m[2]).includes(wanted)) return html;
  }
  const div =
    '<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">' +
    previewHtml +
    PREHEADER_FILLER +
    "</div>";
  return insertAfterBodyOpen(html, div);
}

/**
 * True when the template shows an {{unsubscribe_url}} tag. A tag inside an
 * HTML comment doesn't count - the recipient would never see the link.
 */
export function hasUnsubscribeTag(html: string): boolean {
  const visible = html.replace(/<!--[\s\S]*?-->/g, "");
  return extractMergeTags(visible).some((tag) => tag.toLowerCase() === "unsubscribe_url");
}

/** Small unsubscribe footer (plus postal address) for templates that lack {{unsubscribe_url}}. */
export function appendUnsubscribeFooter(html: string, unsubscribeUrl: string, companyAddress: string): string {
  const address = companyAddress.trim()
    ? `${escapeHtml(companyAddress.trim())}<br>`
    : "";
  const footer =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="padding:24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#6b7280;text-align:center;">' +
    address +
    "You are receiving this email because you subscribed to our updates.<br>" +
    `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>` +
    "</td></tr></table>";
  return insertBeforeBodyClose(html, footer);
}

// An <a ...> start tag; attribute values may contain ">".
const A_TAG_RE = /<a\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
// The href attribute: double-, single- or un-quoted. The leading \s stops data-href matching.
const HREF_RE = /(\shref\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const NO_TRACK_RE = /\sdata-no-track(?=[\s=/>])/i;

function isOwnUntrackedLink(url: string, appUrl: string): boolean {
  const base = appUrl.replace(/\/+$/, "");
  return [`${base}/u/`, `${base}/api/unsubscribe/`, `${base}/api/t/`].some((p) =>
    url.toLowerCase().startsWith(p.toLowerCase()),
  );
}

/**
 * Click tracking: point every http(s) link at the signed redirect. Leaves
 * mailto:, tel:, #anchors, relative links, the app's own unsubscribe /
 * tracking URLs and links marked `data-no-track` untouched.
 */
export function rewriteLinks(html: string, sendId: string, links: LinkContext): string {
  return html.replace(A_TAG_RE, (tag) => {
    if (NO_TRACK_RE.test(tag)) return tag;
    const m = HREF_RE.exec(tag);
    if (!m) return tag;
    const raw = m[2] ?? m[3] ?? m[4] ?? "";
    const url = decodeEntities(raw).trim();
    if (!/^https?:\/\/[^\s/]/i.test(url) || isOwnUntrackedLink(url, links.appUrl)) return tag;
    const tracked = buildClickUrl(links, sendId, url);
    return tag.slice(0, m.index) + `${m[1]}"${escapeHtml(tracked)}"` + tag.slice(m.index + m[0].length);
  });
}

/** 1x1 open-tracking image, just before </body>. */
export function addOpenPixel(html: string, sendId: string, links: LinkContext): string {
  const img = `<img src="${escapeHtml(buildOpenPixelUrl(links, sendId))}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;margin:0;padding:0;">`;
  return insertBeforeBodyClose(html, img);
}
