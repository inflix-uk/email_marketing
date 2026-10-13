import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeText, renderRichInline, renderRichParagraphs, sanitizeImageUrl, sanitizeLinkUrl } from "./rich-text";

const opts = { linkStyle: "color:#000;" };
const inline = (text: string) => renderRichInline(text, opts);

describe("escapeText", () => {
  it("escapes HTML and keeps merge tags as written", () => {
    assert.equal(escapeText(`a < b & "c" {{first_name | it's you}} > d`), `a &lt; b &amp; &quot;c&quot; {{first_name | it's you}} &gt; d`);
  });

  it("escapes tags whose fallback contains markup characters", () => {
    assert.equal(escapeText(`{{x | <b>}}`), "{{x | &lt;b&gt;}}");
    assert.equal(escapeText(`{{x | "q"}}`), "{{x | &quot;q&quot;}}");
  });

  it("escapes things that only look like tags", () => {
    assert.equal(escapeText("{{first name}} <"), "{{first name}} &lt;");
  });
});

describe("sanitizeLinkUrl", () => {
  it("keeps http(s) and mailto links", () => {
    assert.equal(sanitizeLinkUrl("  https://example.com/a?b=1&c=2#d "), "https://example.com/a?b=1&c=2#d");
    assert.equal(sanitizeLinkUrl("HTTP://example.com"), "HTTP://example.com");
    assert.equal(sanitizeLinkUrl("mailto:hi@example.com?subject=Hello there"), "mailto:hi@example.com?subject=Hello%20there");
  });

  it("completes bare domains and email addresses", () => {
    assert.equal(sanitizeLinkUrl("example.com"), "https://example.com");
    assert.equal(sanitizeLinkUrl("www.example.com/path?x=1"), "https://www.example.com/path?x=1");
    assert.equal(sanitizeLinkUrl("example.com:8080/x"), "https://example.com:8080/x");
    assert.equal(sanitizeLinkUrl("hi@example.com"), "mailto:hi@example.com");
  });

  it("allows the unsubscribe tag on its own and tags inside http(s) links", () => {
    assert.equal(sanitizeLinkUrl("{{ unsubscribe_url }}"), "{{unsubscribe_url}}");
    assert.equal(sanitizeLinkUrl("https://example.com/?n={{first_name | you there}}"), "https://example.com/?n={{first_name | you there}}");
  });

  it("rejects everything else", () => {
    for (const url of [
      "",
      "   ",
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:x",
      "tel:+441234567890",
      "ftp://example.com",
      "//example.com",
      "/relative/path",
      "#anchor",
      "{{fields.link}}",
      "{{email}}",
      'https://example.com/"onmouseover="alert(1)',
      "https://example.com/<b>",
      "https://",
      "just some words",
    ]) {
      assert.equal(sanitizeLinkUrl(url), "", JSON.stringify(url));
    }
  });
});

describe("sanitizeImageUrl", () => {
  it("accepts absolute http(s) URLs only", () => {
    assert.equal(sanitizeImageUrl("https://example.com/a b.png"), "https://example.com/a%20b.png");
    assert.equal(sanitizeImageUrl("http://localhost:3000/api/files/123"), "http://localhost:3000/api/files/123");
    assert.equal(sanitizeImageUrl("example.com/a.png"), "https://example.com/a.png");
    for (const url of ["", "data:image/png;base64,AAAA", "javascript:alert(1)", "/api/files/1", "mailto:a@example.com", "cid:logo", "example.com"]) {
      assert.equal(sanitizeImageUrl(url), "", url);
    }
  });
});

describe("rich text", () => {
  it("renders bold, italic and links", () => {
    assert.equal(inline("**bold** and *italic*"), "<strong>bold</strong> and <em>italic</em>");
    assert.equal(inline("[site](https://example.com)"), '<a href="https://example.com" style="color:#000;">site</a>');
  });

  it("nests formatting", () => {
    assert.equal(inline("**a *b* c**"), "<strong>a <em>b</em> c</strong>");
    assert.equal(inline("*a **b** c*"), "<em>a <strong>b</strong> c</em>");
    assert.equal(inline("***both***"), "<strong><em>both</em></strong>");
    assert.equal(inline("*a **b***"), "<em>a <strong>b</strong></em>");
    assert.equal(inline("[**bold** link](example.com)"), '<a href="https://example.com" style="color:#000;"><strong>bold</strong> link</a>');
    assert.equal(inline("**[link](https://example.com)**"), '<strong><a href="https://example.com" style="color:#000;">link</a></strong>');
  });

  it("leaves unmatched or spaced markers as plain text", () => {
    assert.equal(inline("2 * 3 * 4"), "2 * 3 * 4");
    assert.equal(inline("5 ** 2"), "5 ** 2");
    assert.equal(inline("a *b"), "a *b");
    assert.equal(inline("**a"), "**a");
    assert.equal(inline("[not a link]"), "[not a link]");
    assert.equal(inline("[x] (y)"), "[x] (y)");
  });

  it("supports backslash escapes", () => {
    assert.equal(inline(String.raw`\*not italic\*`), "*not italic*");
    assert.equal(inline(String.raw`\[x\](y)`), "[x](y)");
    assert.equal(inline(String.raw`a \\ b`), "a \\ b");
    assert.equal(inline(String.raw`C:\temp`), String.raw`C:\temp`);
  });

  it("escapes HTML in text, labels and urls", () => {
    assert.equal(inline("<b>x</b> & y"), "&lt;b&gt;x&lt;/b&gt; &amp; y");
    assert.equal(inline("[<i>x</i>](https://example.com/?a=1&b=2)"), '<a href="https://example.com/?a=1&amp;b=2" style="color:#000;">&lt;i&gt;x&lt;/i&gt;</a>');
  });

  it("drops unsafe link targets but keeps the text", () => {
    assert.equal(inline("[click](javascript:alert)"), "click");
    assert.equal(inline("[click](data:text/html;base64,AAAA)"), "click");
  });

  it("does not nest links", () => {
    const html = inline("[a [b](https://example.com/b) c](https://example.com/a)");
    assert.equal(html.split("<a ").length - 1, 1);
  });

  it("keeps merge tags intact, even with asterisks or brackets in the fallback", () => {
    assert.equal(inline("Hi {{first_name | *you*}}!"), "Hi {{first_name | *you*}}!");
    assert.equal(inline("*for {{first_name | a * b}} only*"), "<em>for {{first_name | a * b}} only</em>");
    assert.equal(inline("[Unsubscribe]({{unsubscribe_url}})"), '<a href="{{unsubscribe_url}}" style="color:#000;">Unsubscribe</a>');
    assert.equal(inline("[x](https://example.com/?n={{first_name | a b}})"), '<a href="https://example.com/?n={{first_name | a b}}" style="color:#000;">x</a>');
  });

  it("turns line breaks into <br> and blank lines into paragraphs", () => {
    assert.deepEqual(renderRichParagraphs("one\ntwo\r\n\r\n\n  three  \n\n", opts), ["one<br>two", "three"]);
    assert.deepEqual(renderRichParagraphs("  \n \n", opts), []);
  });
});
