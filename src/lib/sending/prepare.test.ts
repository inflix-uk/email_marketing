import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { htmlToText, type MergeContact } from "@/lib/render";
import {
  buildOneClickUnsubscribeUrl,
  buildOpenPixelUrl,
  buildUnsubscribeUrl,
  previewUnsubscribeUrl,
  verifyClick,
  verifyUnsubscribe,
  type LinkContext,
} from "@/lib/tokens";
import { subjectForVariant } from "./ab";
import {
  appendUnsubscribeFooter,
  buildCampaignEmail,
  buildEmail,
  decodeEntities,
  hasUnsubscribeTag,
  injectPreheader,
  rewriteLinks,
  type CampaignBuildContext,
  type EmailContent,
} from "./prepare";

const SEND_ID = "11111111-2222-4333-8444-555555555555";

// A fake signing context: prepare.ts is pure, nothing touches the database.
const LINKS: LinkContext = { appUrl: "https://mail.example.test", secret: "test-secret-0123456789abcdef" };
const CTX: CampaignBuildContext = { links: LINKS, companyAddress: "" };

const contact: MergeContact = {
  email: "ann@example.com",
  firstName: "Ann <b>&",
  lastName: "O'Neil",
  fields: { company: "Acme & Co" },
};

function campaign(overrides: Partial<EmailContent> = {}): EmailContent {
  return {
    subject: "Hi {{first_name}}, news from {{company}}",
    previewText: null,
    html: "<html><body><p>Hello {{first_name}} {{last_name}}</p><a href=\"{{unsubscribe_url}}\">Unsubscribe</a></body></html>",
    fromName: "Acme",
    fromEmail: "news@acme.test",
    replyTo: null,
    ...overrides,
  };
}

/** Pull every href value out of the HTML (decoded). */
function hrefs(html: string): string[] {
  return [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => decodeEntities(m[1]));
}

/** Parse a tracked click URL back into { sendId, url, sig }. */
function parseClick(href: string) {
  const u = new URL(href);
  const m = /\/api\/t\/c\/([^/]+)$/.exec(u.pathname);
  assert.ok(m, `not a click-tracking URL: ${href}`);
  return { sendId: m[1], url: u.searchParams.get("u")!, sig: u.searchParams.get("s") };
}

describe("buildCampaignEmail - merge tags", () => {
  it("renders the subject without escaping and the body with escaping", () => {
    const msg = buildCampaignEmail(campaign(), contact, SEND_ID, CTX);
    assert.equal(msg.subject, "Hi Ann <b>&, news from Acme & Co");
    assert.match(msg.html, /Hello Ann &lt;b&gt;&amp; O&#39;Neil/);
    assert.equal(msg.to, "ann@example.com");
    assert.deepEqual(msg.from, { name: "Acme", address: "news@acme.test" });
  });

  it("collapses newlines in the subject (header safety)", () => {
    const msg = buildCampaignEmail(campaign({ subject: "Hello\r\nBcc: x@y.z {{first_name}}" }), contact, SEND_ID, CTX);
    assert.equal(msg.subject, "Hello Bcc: x@y.z Ann <b>&");
  });

  it("uses the per-send unsubscribe URL for {{unsubscribe_url}} and does not add a footer", () => {
    const msg = buildCampaignEmail(campaign(), contact, SEND_ID, CTX);
    assert.ok(hrefs(msg.html).includes(buildUnsubscribeUrl(LINKS, SEND_ID)));
    assert.equal(msg.html.match(/Unsubscribe<\/a>/g)?.length, 1);
    assert.doesNotMatch(msg.html, /You are receiving this email/);
  });
});

describe("buildCampaignEmail - headers and text part", () => {
  it("sets RFC 8058 one-click unsubscribe headers", () => {
    const msg = buildCampaignEmail(campaign(), contact, SEND_ID, CTX);
    assert.equal(msg.headers?.["List-Unsubscribe"], `<${buildOneClickUnsubscribeUrl(LINKS, SEND_ID)}>`);
    assert.equal(msg.headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  });

  it("builds the text part from untracked HTML, without the preheader", () => {
    const msg = buildCampaignEmail(
      campaign({
        previewText: "Sneak peek",
        html: '<body><p>Read <a href="https://example.com/post">the post</a></p>{{unsubscribe_url}}</body>',
      }),
      contact,
      SEND_ID,
      CTX,
    );
    assert.ok(msg.text?.includes("the post (https://example.com/post)"));
    assert.ok(!msg.text?.includes("/api/t/"));
    assert.ok(!msg.text?.includes("Sneak peek"));
  });

  it("test sends (sendId null) have no tracking and no List-Unsubscribe headers", () => {
    const msg = buildEmail(
      campaign({ html: '<body><a href="https://example.com">x</a></body>' }),
      contact,
      { sendId: null, unsubscribeUrl: previewUnsubscribeUrl(LINKS) },
    );
    assert.deepEqual(msg.headers, {});
    assert.ok(!msg.html.includes("/api/t/"));
    assert.ok(hrefs(msg.html).includes("https://example.com"));
    assert.ok(hrefs(msg.html).includes(previewUnsubscribeUrl(LINKS)));
  });
});

describe("click tracking", () => {
  it("rewrites http(s) links to signed click URLs", () => {
    const html = rewriteLinks('<a href="https://example.com/a" class="btn">A</a> <a href=\'http://example.org\'>B</a>', SEND_ID, LINKS);
    const [a, b] = hrefs(html).map(parseClick);
    assert.equal(a.url, "https://example.com/a");
    assert.equal(a.sendId, SEND_ID);
    assert.ok(verifyClick(LINKS, SEND_ID, a.url, a.sig));
    assert.equal(b.url, "http://example.org");
    assert.ok(verifyClick(LINKS, SEND_ID, b.url, b.sig));
    assert.match(html, /class="btn"/);
  });

  it("decodes &amp; in hrefs before signing and escapes & in the new href", () => {
    const html = rewriteLinks('<a href="https://shop.test/?a=1&amp;b=2&#38;c=3">x</a>', SEND_ID, LINKS);
    assert.doesNotMatch(html, /href="[^"]*&(?!amp;)/, "raw & left in attribute");
    const click = parseClick(hrefs(html)[0]);
    assert.equal(click.url, "https://shop.test/?a=1&b=2&c=3");
    assert.ok(verifyClick(LINKS, SEND_ID, click.url, click.sig));
  });

  it("handles unquoted hrefs and attributes containing '>'", () => {
    const html = rewriteLinks('<a title="a > b" href=https://example.com/x>go</a>', SEND_ID, LINKS);
    assert.equal(parseClick(hrefs(html)[0]).url, "https://example.com/x");
    assert.match(html, /title="a > b"/);
  });

  it("skips mailto:, tel:, anchors, relative links, data-no-track and the app's own links", () => {
    const own = buildUnsubscribeUrl(LINKS, SEND_ID);
    const input = [
      '<a href="mailto:hi@example.com">m</a>',
      '<a href="tel:+441234">t</a>',
      '<a href="#top">anchor</a>',
      '<a href="/relative">rel</a>',
      '<a data-no-track href="https://example.com/private">p</a>',
      `<a href="${own}">unsub</a>`,
      `<a href="${buildOneClickUnsubscribeUrl(LINKS, SEND_ID)}">one-click</a>`,
      '<a data-href="https://example.com/data" name="x">no href</a>',
    ].join("\n");
    assert.equal(rewriteLinks(input, SEND_ID, LINKS), input);
  });

  it("tracks links built from merge tags, with contact-specific values", () => {
    const msg = buildCampaignEmail(
      campaign({ html: '<body><a href="https://example.com/?who={{email}}&amp;co={{company}}">me</a>{{unsubscribe_url}}</body>' }),
      contact,
      SEND_ID,
      CTX,
    );
    const tracked = hrefs(msg.html).find((h) => h.includes("/api/t/c/"));
    assert.ok(tracked);
    assert.equal(parseClick(tracked).url, "https://example.com/?who=ann@example.com&co=Acme & Co");
  });
});

describe("open pixel", () => {
  it("is inserted just before </body>", () => {
    const msg = buildCampaignEmail(campaign(), contact, SEND_ID, CTX);
    const pixel = buildOpenPixelUrl(LINKS, SEND_ID);
    assert.match(msg.html, new RegExp(`<img src="${pixel.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"[^>]*width="1" height="1"[^>]*></body>`));
  });

  it("is appended when there is no body tag", () => {
    const msg = buildCampaignEmail(campaign({ html: "<p>Hi</p>{{unsubscribe_url}}" }), contact, SEND_ID, CTX);
    assert.ok(msg.html.endsWith(">"));
    assert.ok(msg.html.lastIndexOf(buildOpenPixelUrl(LINKS, SEND_ID)) > msg.html.indexOf("<p>Hi</p>"));
  });
});

describe("preheader", () => {
  it("is injected right after <body> when previewText is set", () => {
    const msg = buildCampaignEmail(
      campaign({ previewText: "Hi {{first_name}}!", html: '<html><body style="margin:0"><p>Body</p>{{unsubscribe_url}}</body></html>' }),
      contact,
      SEND_ID,
      CTX,
    );
    assert.match(msg.html, /<body style="margin:0"><div style="display:none;[^"]*">Hi Ann &lt;b&gt;&amp;!/);
  });

  it("is not injected twice when the template already has it", () => {
    const html = '<body><div style="display:none;max-height:0;overflow:hidden;opacity:0;">Spring sale is on</div><p>x</p></body>';
    assert.equal(injectPreheader(html, "Spring sale is on"), html);
    // Escaped vs literal apostrophes still count as the same text.
    const html2 = '<body><div style="display:none">It\'s here</div></body>';
    assert.equal(injectPreheader(html2, "It&#39;s here"), html2);
  });

  it("is injected when the existing hidden div has different text", () => {
    const html = '<body><div style="display:none;"></div><p>x</p></body>';
    const out = injectPreheader(html, "Fresh text");
    assert.ok(out.startsWith('<body><div style="display:none;font-size:1px'));
    assert.ok(out.includes("Fresh text"));
  });

  it("is prepended when there is no body tag", () => {
    assert.ok(injectPreheader("<p>x</p>", "Peek").startsWith('<div style="display:none;'));
  });
});

describe("automatic unsubscribe footer", () => {
  it("is added before </body> when the HTML has no {{unsubscribe_url}}", () => {
    const msg = buildCampaignEmail(campaign({ html: "<html><body><p>No link here</p></body></html>" }), contact, SEND_ID, CTX);
    assert.match(msg.html, /You are receiving this email[\s\S]*Unsubscribe<\/a><\/td><\/tr><\/table><img[^>]*><\/body>/);
    assert.ok(hrefs(msg.html).includes(buildUnsubscribeUrl(LINKS, SEND_ID)), "unsubscribe link is not click-tracked");
    assert.match(htmlToText(msg.html), /Unsubscribe/);
    assert.match(msg.text ?? "", /Unsubscribe \(http/);
  });

  it("recognises {{ unsubscribe_url | fallback }} as present", () => {
    const msg = buildCampaignEmail(campaign({ html: "<body><a href=\"{{ unsubscribe_url | # }}\">Leave</a></body>" }), contact, SEND_ID, CTX);
    assert.doesNotMatch(msg.html, /You are receiving this email/);
  });

  it("is still added when {{unsubscribe_url}} only appears inside an HTML comment", () => {
    const msg = buildCampaignEmail(campaign({ html: "<body><!-- TODO {{unsubscribe_url}} --><p>Hi</p></body>" }), contact, SEND_ID, CTX);
    assert.match(msg.html, /You are receiving this email/);
  });

  it("treats the tag name case-insensitively, like the renderer", () => {
    const msg = buildCampaignEmail(campaign({ html: "<body><a href=\"{{UNSUBSCRIBE_URL}}\">Leave</a></body>" }), contact, SEND_ID, CTX);
    assert.doesNotMatch(msg.html, /You are receiving this email/);
    assert.ok(hrefs(msg.html).includes(buildUnsubscribeUrl(LINKS, SEND_ID)));
  });

  it("includes the escaped company address when set", () => {
    const out = appendUnsubscribeFooter("<body></body>", "https://app.test/u/1?s=x", "1 High St <Leeds>");
    assert.match(out, /1 High St &lt;Leeds&gt;<br>/);
    assert.ok(out.endsWith("</body>"));
  });

  it("is appended when there is no body tag", () => {
    const out = appendUnsubscribeFooter("<p>x</p>", "https://app.test/u/1?s=x", "");
    assert.ok(out.startsWith("<p>x</p><table"));
    assert.doesNotMatch(out, /<br>You are/);
  });
});

describe("build context (links + company address)", () => {
  it("signs every link with the given context only", () => {
    const msg = buildCampaignEmail(
      campaign({ html: '<body><a href="https://example.com/x">x</a><a href="{{unsubscribe_url}}">u</a></body>' }),
      contact,
      SEND_ID,
      CTX,
    );
    const other: LinkContext = { appUrl: LINKS.appUrl, secret: "another-secret" };
    const click = parseClick(hrefs(msg.html).find((h) => h.includes("/api/t/c/"))!);
    assert.ok(verifyClick(LINKS, SEND_ID, click.url, click.sig));
    assert.ok(!verifyClick(other, SEND_ID, click.url, click.sig));
    assert.ok(!verifyClick(LINKS, "22222222-2222-4333-8444-555555555555", click.url, click.sig));

    const unsub = new URL(hrefs(msg.html).find((h) => h.includes("/u/"))!);
    assert.equal(unsub.origin, LINKS.appUrl);
    assert.ok(verifyUnsubscribe(LINKS, SEND_ID, unsub.searchParams.get("s")));
    assert.ok(!verifyUnsubscribe(other, SEND_ID, unsub.searchParams.get("s")));
  });

  it("builds every public URL from ctx.appUrl", () => {
    const ctx: CampaignBuildContext = { links: { appUrl: "https://news.acme.test", secret: "s3cret" }, companyAddress: "" };
    const msg = buildCampaignEmail(campaign({ html: "<body><p>x</p></body>" }), contact, SEND_ID, ctx);
    assert.match(msg.html, /src="https:\/\/news\.acme\.test\/api\/t\/o\//);
    assert.ok(hrefs(msg.html).includes(buildUnsubscribeUrl(ctx.links, SEND_ID)));
    assert.equal(msg.headers?.["List-Unsubscribe"], `<${buildOneClickUnsubscribeUrl(ctx.links, SEND_ID)}>`);
    assert.doesNotMatch(msg.html, /mail\.example\.test/);
  });

  it("does not track links to the app's own public pages (case-insensitive)", () => {
    const input = `<a href="${LINKS.appUrl.toUpperCase()}/u/preview">p</a><a href="${LINKS.appUrl}/api/t/o/x">o</a>`;
    assert.equal(rewriteLinks(input, SEND_ID, LINKS), input);
    // ...but other pages of the same host are ordinary links.
    const page = `<a href="${LINKS.appUrl}/blog">b</a>`;
    assert.notEqual(rewriteLinks(page, SEND_ID, LINKS), page);
  });

  it("renders {{company_address}} from the context (escaped)", () => {
    const msg = buildCampaignEmail(
      campaign({ html: "<body><p>{{company_address}}</p>{{unsubscribe_url}}</body>" }),
      contact,
      SEND_ID,
      { ...CTX, companyAddress: "Acme <Ltd>, 1 High St" },
    );
    assert.match(msg.html, /<p>Acme &lt;Ltd&gt;, 1 High St<\/p>/);
  });

  it("puts the company address in the automatic footer", () => {
    const msg = buildCampaignEmail(
      campaign({ html: "<body><p>No link</p></body>" }),
      contact,
      SEND_ID,
      { ...CTX, companyAddress: "  1 High St, Leeds  " },
    );
    assert.match(msg.html, /1 High St, Leeds<br>You are receiving this email/);
    assert.match(msg.text ?? "", /1 High St, Leeds/);
  });

  it("test sends need no signing context and point at the preview page", () => {
    const msg = buildEmail(campaign({ html: "<body><p>{{company_address}}</p></body>" }), contact, {
      sendId: null,
      unsubscribeUrl: previewUnsubscribeUrl(LINKS),
      companyAddress: "1 High St",
    });
    assert.deepEqual(msg.headers, {});
    assert.ok(hrefs(msg.html).includes(`${LINKS.appUrl}/u/preview`));
    assert.match(msg.html, /<p>1 High St<\/p>/);
    assert.doesNotMatch(msg.html, /<img/);
  });

  it("hasUnsubscribeTag ignores tags inside comments", () => {
    assert.equal(hasUnsubscribeTag("<!-- {{unsubscribe_url}} -->"), false);
    assert.equal(hasUnsubscribeTag('<a href="{{ Unsubscribe_Url }}">x</a>'), true);
  });
});

describe("A/B subject lines", () => {
  const abTest = { subjectB: "{{first_name}}, a question", testPercent: 20, waitHours: 4, winner: null, decidedAt: null };
  const build = (variant: "A" | "B" | null, winner: "A" | "B" | null = null) => {
    const base = campaign({ subject: "News for {{first_name}}" });
    const subject = subjectForVariant(base.subject, { ...abTest, winner }, variant);
    return buildCampaignEmail({ ...base, subject }, { ...contact, firstName: "Ann" }, SEND_ID, CTX);
  };

  it("builds each variant with its own subject (merge tags rendered) and identical content", () => {
    const a = build("A");
    const b = build("B");
    assert.equal(a.subject, "News for Ann");
    assert.equal(b.subject, "Ann, a question");
    assert.equal(a.html, b.html);
    assert.deepEqual(a.headers, b.headers);
  });

  it("gives non-test recipients the winning subject", () => {
    assert.equal(build(null, "B").subject, "Ann, a question");
    assert.equal(build(null, "A").subject, "News for Ann");
  });
});
