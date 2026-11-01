// Link helpers for reports: which clicked URLs are "system" links (left out
// of the Links table and click map), and the click-map overlay. Pure.

import { decodeEntities } from "@/lib/sending/prepare";

const SYSTEM_PATHS = ["/u/", "/api/unsubscribe/", "/api/t/", "/c/", "/f/"];
const UNSUBSCRIBE_RE = /unsubscribe|opt-?out|email-preferences|manage-preferences/i;

/** Unsubscribe, preference and tracking links: not content the reader chose to click. */
export function isSystemLink(url: string, appUrl: string | null | undefined): boolean {
  const lower = url.trim().toLowerCase();
  if (!/^https?:\/\//.test(lower)) return true;
  const base = (appUrl ?? "").trim().replace(/\/+$/, "").toLowerCase();
  if (base && SYSTEM_PATHS.some((p) => lower.startsWith(base + p))) return true;
  return UNSUBSCRIBE_RE.test(lower);
}

export interface ClickMapLink {
  url: string;
  clicks: number;
}

const A_TAG_RE = /<a\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const HREF_RE = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

const BADGE_STYLE =
  "display:inline-block;margin:0 4px 0 0;padding:0 6px;border-radius:9px;font:bold 11px/18px Arial,Helvetica,sans-serif;" +
  "letter-spacing:0;text-decoration:none;vertical-align:middle;white-space:nowrap;";

const OVERLAY_CSS =
  "<style>a[data-click-map]{outline:2px solid #4f46e5;outline-offset:2px;border-radius:2px}" +
  "a[data-click-map='0']{outline-color:#cbd5e1}</style>";

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * The email HTML with a badge on every tracked link showing its share of all
 * clicks ("12.50%"). Links are matched on their decoded href. Returns the
 * HTML and the URLs that were found in it.
 */
export function buildClickMapHtml(
  html: string,
  links: ClickMapLink[],
  appUrl: string | null | undefined,
): { html: string; found: Set<string> } {
  const byUrl = new Map(links.map((l) => [l.url, l.clicks]));
  const total = links.reduce((sum, l) => sum + l.clicks, 0);
  const found = new Set<string>();

  const out = html.replace(A_TAG_RE, (tag) => {
    const m = HREF_RE.exec(tag);
    if (!m) return tag;
    const url = decodeEntities(m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!/^https?:\/\//i.test(url) || isSystemLink(url, appUrl)) return tag;
    const clicks = byUrl.get(url) ?? 0;
    if (byUrl.has(url)) found.add(url);
    const share = total > 0 ? `${((clicks / total) * 100).toFixed(2)}%` : "0.00%";
    const colors = clicks > 0 ? "background:#4f46e5;color:#ffffff;" : "background:#e2e8f0;color:#334155;";
    const title = `${clicks} click${clicks === 1 ? "" : "s"} · ${share} of all clicks`;
    const badge = `<span style="${BADGE_STYLE}${colors}" title="${escapeAttr(title)}">${share}</span>`;
    const marked = tag.replace(/^<a\b/i, `<a data-click-map="${clicks > 0 ? "1" : "0"}"`);
    return marked + badge;
  });

  const head = out.search(/<\/head>/i);
  const withCss = head >= 0 ? out.slice(0, head) + OVERLAY_CSS + out.slice(head) : OVERLAY_CSS + out;
  return { html: withCss, found };
}
