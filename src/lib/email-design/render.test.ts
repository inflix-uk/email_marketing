import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderMergeTags, SAMPLE_CONTACT } from "@/lib/render";
import { injectPreheader } from "@/lib/sending/prepare";
import { lintEmailHtml } from "@/lib/templates/lint";
import { renderDesign } from "./render";
import { BLANK_DESIGN, createBlock, createFooter, DEFAULT_STYLES, toDesign, type Block, type EmailDesign } from "./schema";

function design(blocks: unknown[], styles: Record<string, unknown> = {}): EmailDesign {
  const parsed = toDesign({ styles, blocks });
  assert.ok(parsed, "test design must be valid");
  return parsed;
}

function render(blocks: unknown[], styles: Record<string, unknown> = {}): string {
  return renderDesign(design(blocks, styles));
}

/** Every block type with realistic content. */
const EVERYTHING: unknown[] = [
  { id: "h", type: "heading", level: 1, text: "Hi {{first_name | there}}", align: "center" },
  { id: "t", type: "text", text: "First **bold** and *italic*.\nSame paragraph.\n\nSecond with [a link](https://example.com/a?b=1&c=2)." },
  { id: "i", type: "image", src: "https://example.com/hero.png", alt: "Our new office", link: "example.com/office", width: 50 },
  { id: "b", type: "button", label: "Read more", url: "https://example.com/read", align: "center" },
  { id: "d", type: "divider" },
  { id: "s", type: "spacer", height: 32 },
  {
    id: "c",
    type: "columns",
    columns: [
      { blocks: [{ id: "c1", type: "image", src: "https://example.com/left.jpg", alt: "Left" }, { id: "c2", type: "text", text: "Left text" }] },
      { blocks: [{ id: "c3", type: "text", text: "Right text" }, { id: "c4", type: "button", label: "Go", url: "https://example.com/go" }] },
    ],
  },
  { id: "f", type: "footer", text: "You subscribed at [example.com](https://example.com).", unsubscribeLabel: "Stop these emails" },
];

describe("renderDesign", () => {
  it("renders a complete, lint-clean HTML document for every block type", () => {
    const html = render(EVERYTHING);
    assert.match(html, /^<!DOCTYPE html>/);
    assert.match(html, /<\/html>$/);
    assert.deepEqual(lintEmailHtml(html), []);

    assert.match(html, /<h1 style="[^"]*text-align:center;">Hi \{\{first_name \| there\}\}<\/h1>/);
    assert.match(html, /<strong>bold<\/strong> and <em>italic<\/em>\.<br>Same paragraph\.<\/p>/);
    assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" style="color:#4f46e5;text-decoration:underline;">a link<\/a>/);
    assert.match(html, /<a href="https:\/\/example\.com\/office"[^>]*><img src="https:\/\/example\.com\/hero\.png" alt="Our new office" width="260"/);
    assert.match(html, /<a href="https:\/\/example\.com\/read" style="[^"]*">Read more<\/a>/);
    assert.match(html, /border-top:1px solid #e5e7eb/);
    assert.match(html, /<td height="32" style="height:32px;/);
    assert.match(html, /class="em-col em-col-first"[\s\S]*Left text[\s\S]*class="em-col"[\s\S]*Right text/);
    assert.match(html, /Stop these emails<\/a>/);
  });

  it("renders the blank design and the block defaults without lint issues", () => {
    assert.deepEqual(lintEmailHtml(renderDesign(BLANK_DESIGN)), []);
    const defaults: Block[] = [
      createBlock("heading", "a"),
      createBlock("text", "b"),
      createBlock("image", "c"),
      createBlock("button", "d"),
      createBlock("divider", "e"),
      createBlock("spacer", "f"),
      createBlock("columns", "g"),
      createFooter(),
    ];
    const html = renderDesign({ version: 1, styles: DEFAULT_STYLES, blocks: defaults });
    assert.deepEqual(lintEmailHtml(html), []);
  });

  it("is deterministic and does not leak block ids", () => {
    const first = render(EVERYTHING);
    assert.equal(first, render(EVERYTHING));
    assert.doesNotMatch(first, /\bid="/);
  });

  it("always ends with the footer: company address and unsubscribe link", () => {
    for (const blocks of [[], [{ id: "t", type: "text", text: "Hello" }], EVERYTHING]) {
      const html = render(blocks);
      assert.match(html, /\{\{company_address\}\}/);
      assert.match(html, /<a href="\{\{unsubscribe_url\}\}"/);
      assert.ok(html.lastIndexOf("{{unsubscribe_url}}") > html.lastIndexOf("</p>"), "footer comes after the content");
      assert.ok(!lintEmailHtml(html).some((issue) => /unsubscribe/i.test(issue.message)));
    }
    // Even a hand-built design object without a footer block gets one.
    const html = renderDesign({ version: 1, styles: DEFAULT_STYLES, blocks: [createBlock("text", "t")] });
    assert.match(html, /<a href="\{\{unsubscribe_url\}\}"[^>]*>Unsubscribe<\/a>/);
  });

  it("moves a misplaced footer to the end and keeps only one", () => {
    const html = render([
      { id: "f1", type: "footer", text: "First footer" },
      { id: "t", type: "text", text: "Body text" },
      { id: "f2", type: "footer", text: "Second footer" },
    ]);
    assert.ok(html.indexOf("Body text") < html.indexOf("First footer"));
    assert.doesNotMatch(html, /Second footer/);
    assert.equal(html.split("{{unsubscribe_url}}").length - 1, 1);
  });

  it("escapes user text everywhere", () => {
    const evil = `<script>alert("x")</script> & 'quotes'`;
    const html = render([
      { id: "h", type: "heading", text: evil },
      { id: "t", type: "text", text: evil },
      { id: "i", type: "image", src: "https://example.com/a.png", alt: `"><script>alert(1)</script>` },
      { id: "b", type: "button", label: evil, url: "https://example.com" },
      { id: "f", type: "footer", text: evil, unsubscribeLabel: evil },
    ]);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /alert\("x"\)/);
    assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &#39;quotes&#39;/);
    assert.match(html, /alt="&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
    assert.deepEqual(
      lintEmailHtml(html).filter((issue) => issue.level === "error"),
      [],
    );
  });

  it("only allows http(s) and mailto links", () => {
    const html = render([
      { id: "t", type: "text", text: "[js](javascript:alert(1)) [data](data:text/html,x) [ok](https://example.com) [mail](mailto:hi@example.com) [bare](example.com/x)" },
      { id: "b", type: "button", label: "Click", url: "javascript:alert(1)" },
      { id: "i", type: "image", src: "https://example.com/a.png", alt: "", link: "vbscript:x" },
      { id: "i2", type: "image", src: "javascript:alert(1)", alt: "bad" },
      { id: "i3", type: "image", src: "data:image/png;base64,AAAA", alt: "inline" },
    ]);
    assert.doesNotMatch(html, /javascript:|vbscript:|data:/i);
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(hrefs, [
      "https://example.com",
      "mailto:hi@example.com",
      "https://example.com/x",
      "{{unsubscribe_url}}",
    ]);
    // The unsafe link text and the button stay visible, just without a target.
    assert.match(html, />Click<\/a>/);
    assert.match(html, /js/);
    // Images with an unusable source are left out.
    assert.equal(html.split("<img").length - 1, 1);
  });

  it("passes merge tags through for the sender, including in links", () => {
    const html = render([
      { id: "t", type: "text", text: "Hi {{ first_name | there }}, from {{fields.company | your team}} [open](https://example.com/?e={{email}})" },
      { id: "b", type: "button", label: "For {{first_name}}", url: "https://example.com/u/{{fields.code | none}}" },
    ]);
    assert.match(html, /Hi \{\{ first_name \| there \}\}, from \{\{fields\.company \| your team\}\}/);
    assert.match(html, /href="https:\/\/example\.com\/\?e=\{\{email\}\}"/);
    const sent = renderMergeTags(
      html,
      { contact: { ...SAMPLE_CONTACT, fields: { company: "A&B <Ltd>" } }, unsubscribeUrl: "https://app.example.com/u/1" },
      { escape: true },
    );
    assert.match(sent, /Hi Jane, from A&amp;B &lt;Ltd&gt;/);
    assert.match(sent, /href="https:\/\/example\.com\/\?e=jane\.doe@example\.com"/);
    assert.match(sent, /href="https:\/\/example\.com\/u\/none"/);
    assert.match(sent, /href="https:\/\/app\.example\.com\/u\/1"/);
  });

  it("never lets a merge-tag fallback inject markup", () => {
    const html = render([
      { id: "t", type: "text", text: `{{first_name | <img src=x onerror=alert(1)>}}` },
      { id: "i", type: "image", src: "https://example.com/a.png", alt: `{{first_name | " onload="alert(1)}}` },
    ]);
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /alt="[^"]*" onload=/);
  });

  it("applies the global styles", () => {
    const html = render([{ id: "h", type: "heading", text: "Title" }, { id: "t", type: "text", text: "Body [x](https://example.com)" }, { id: "b", type: "button", label: "Go", url: "https://example.com" }], {
      pageBackground: "#101010",
      contentBackground: "#FAFAFA",
      contentWidth: 640,
      fontFamily: "georgia",
      textColor: "#222222",
      headingColor: "#333333",
      accentColor: "#ff0066",
    });
    assert.match(html, /<body style="margin:0;padding:0;background-color:#101010;">/);
    assert.match(html, /max-width:640px;background-color:#fafafa/);
    assert.match(html, /<table [^>]*width="640" align="center">/);
    assert.match(html, /font-family:Georgia,'Times New Roman',serif/);
    assert.match(html, /<h1 style="[^"]*color:#333333;/);
    assert.match(html, /<p style="[^"]*color:#222222;/);
    assert.match(html, /<a href="https:\/\/example\.com" style="color:#ff0066;/);
    assert.match(html, /bgcolor="#ff0066"/);
    assert.match(html, /@media only screen and \(max-width:672px\)/);
  });

  it("uses a button's own colours over the accent colour", () => {
    const html = render([{ id: "b", type: "button", label: "Go", url: "https://example.com", backgroundColor: "#00aa55", textColor: "#000000" }]);
    assert.match(html, /bgcolor="#00aa55"[^>]*mso-padding-alt:12px 24px;/);
    assert.match(html, /color:#000000;text-decoration:none/);
  });

  it("skips empty blocks, and shows placeholders only when asked", () => {
    const blocks = [
      { id: "h", type: "heading", text: "  " },
      { id: "t", type: "text", text: "" },
      { id: "i", type: "image", src: "" },
      { id: "b", type: "button", label: "", url: "https://example.com" },
    ];
    const html = render(blocks);
    assert.doesNotMatch(html, /<h1|<p |<img|dashed/);
    const preview = renderDesign(design(blocks), { placeholders: true });
    assert.equal(preview.split("dashed").length - 1, 4);
  });

  it("leaves the preheader slot to the sender", () => {
    const html = injectPreheader(render(EVERYTHING), "Preview text here");
    assert.match(html, /<body [^>]*><div style="display:none;[^"]*">Preview text here/);
  });
});
