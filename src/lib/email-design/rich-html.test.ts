import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeEntities,
  hasRichText,
  markdownToRichHtml,
  richHtmlParagraphs,
  richHtmlToPlainText,
  safeColor,
  safeStyle,
  sanitizeRichHtml,
} from "./rich-html";
import { renderDesign } from "./render";
import { parseDesign, serializeDesign, toDesign } from "./schema";

describe("sanitizeRichHtml", () => {
  it("keeps the allowed formatting and links", () => {
    const html =
      '<p>Hi <b>bold</b> <strong>strong</strong> <i>it</i> <em>em</em> <u>under</u> <s>gone</s> ' +
      '<a href="https://example.com/a?b=1&amp;c=2">link</a><br>next</p>';
    assert.equal(
      sanitizeRichHtml(html),
      '<p>Hi <b>bold</b> <strong>strong</strong> <i>it</i> <em>em</em> <u>under</u> <s>gone</s> ' +
        '<a href="https://example.com/a?b=1&amp;c=2">link</a><br>next</p>',
    );
  });

  it("is idempotent", () => {
    const inputs = [
      '<div>One <b>two <i>three</i></b></div><div><br></div><div>Four <a href="example.com">x</a></div>',
      "<p>a &amp; b &lt;c&gt; &nbsp;d</p>",
      '<span style="color: rgb(255, 0, 0); font-size: 20px">red</span>',
      "Plain text with {{first_name | there}}",
    ];
    for (const input of inputs) {
      const once = sanitizeRichHtml(input);
      assert.equal(sanitizeRichHtml(once), once, input);
    }
  });

  it("turns divs, headings and list items into paragraphs", () => {
    assert.equal(sanitizeRichHtml("<div>One</div><div>Two</div>"), "<p>One</p><p>Two</p>");
    assert.equal(sanitizeRichHtml("<h1>Title</h1><ul><li>a</li><li>b</li></ul>"), "<p>Title</p><p>a</p><p>b</p>");
    assert.equal(sanitizeRichHtml("loose text"), "<p>loose text</p>");
  });

  it("keeps one blank line between paragraphs and drops them at the ends", () => {
    assert.equal(sanitizeRichHtml("<p><br></p><p>a</p><p><br></p><p><br></p><p>b</p><p><br></p>"), "<p>a</p><p><br></p><p>b</p>");
    assert.equal(sanitizeRichHtml("<p><br></p>"), "");
    assert.equal(sanitizeRichHtml(""), "");
  });

  it("removes scripts, styles, event handlers and unknown tags", () => {
    assert.equal(sanitizeRichHtml('<p onclick="x()">Hi<script>alert(1)</script></p>'), "<p>Hi</p>");
    assert.equal(sanitizeRichHtml("<style>p{}</style><p>a</p>"), "<p>a</p>");
    assert.equal(sanitizeRichHtml('<p><img src="x" onerror="alert(1)">a<iframe src="x"></iframe></p>'), "<p>a</p>");
    assert.equal(sanitizeRichHtml("<p><font face='x'>a</font> <code>b</code></p>"), "<p>a b</p>");
    assert.equal(sanitizeRichHtml('<b class="x" id="y">a</b>'), "<p><b>a</b></p>");
    assert.equal(sanitizeRichHtml("<!-- hi --><p>a</p>"), "<p>a</p>");
  });

  it("blocks unsafe link targets but keeps the text", () => {
    for (const href of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "jav&#x61;script:alert(1)",
      "jav&#97;script:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:x",
      "/relative",
      "#top",
    ]) {
      assert.equal(sanitizeRichHtml(`<a href="${href}">click</a>`), "<p>click</p>", href);
    }
    assert.equal(sanitizeRichHtml("<a>no href</a>"), "<p>no href</p>");
  });

  it("normalises link targets", () => {
    assert.equal(sanitizeRichHtml('<a href="example.com">x</a>'), '<p><a href="https://example.com">x</a></p>');
    assert.equal(sanitizeRichHtml("<a href='mailto:hi@example.com'>x</a>"), '<p><a href="mailto:hi@example.com">x</a></p>');
    assert.equal(sanitizeRichHtml("<a href=tel:+441234567890>x</a>"), '<p><a href="tel:+441234567890">x</a></p>');
    assert.equal(
      sanitizeRichHtml('<a href="https://example.com/?n={{first_name}}" target="_blank" onmouseover="x">x</a>'),
      '<p><a href="https://example.com/?n={{first_name}}">x</a></p>',
    );
    assert.equal(sanitizeRichHtml('<a href="{{unsubscribe_url}}">x</a>'), '<p><a href="{{unsubscribe_url}}">x</a></p>');
  });

  it("can't break out of an attribute", () => {
    const out = sanitizeRichHtml('<a href="https://example.com/&quot; onmouseover=&quot;alert(1)">x</a>');
    assert.equal(out, "<p>x</p>");
    assert.ok(!out.includes("onmouseover"));
  });

  it("doesn't nest links", () => {
    assert.equal(
      sanitizeRichHtml('<a href="https://a.example">a <a href="https://b.example">b</a></a>'),
      '<p><a href="https://a.example">a b</a></p>',
    );
  });

  it("keeps only safe styles on spans", () => {
    assert.equal(
      sanitizeRichHtml('<span style="color:#F00; background:url(x); font-weight:700; position:absolute">a</span>'),
      '<p><span style="color:#ff0000;font-weight:bold">a</span></p>',
    );
    assert.equal(sanitizeRichHtml('<span style="font-size:30px">a</span>'), "<p>a</p>");
    assert.equal(sanitizeRichHtml('<span style="color:expression(alert(1))">a</span>'), "<p>a</p>");
    assert.equal(sanitizeRichHtml('<font color="#00ff00">g</font>'), '<p><span style="color:#00ff00">g</span></p>');
  });

  it("escapes text and keeps merge tags", () => {
    assert.equal(sanitizeRichHtml("<p>1 &lt; 2 &amp; {{first_name | there}}</p>"), "<p>1 &lt; 2 &amp; {{first_name | there}}</p>");
    assert.equal(sanitizeRichHtml("<p>a < b</p>"), "<p>a &lt; b</p>");
    assert.equal(sanitizeRichHtml("<p>a&nbsp;&nbsp;b</p>"), "<p>a&nbsp;&nbsp;b</p>");
  });

  it("closes mis-nested and unclosed tags", () => {
    assert.equal(sanitizeRichHtml("<b>a<i>b</b>c</i>"), "<p><b>a<i>b</i></b>c</p>");
    assert.equal(sanitizeRichHtml("<p><b>open"), "<p><b>open</b></p>");
    assert.equal(sanitizeRichHtml("<b><p>one</p><p>two</p></b>"), "<p><b>one</b></p><p><b>two</b></p>");
  });

  it("drops empty formatting", () => {
    assert.equal(sanitizeRichHtml("<p>a<b></b><i> </i>b</p>"), "<p>a b</p>");
  });
});

describe("richHtmlParagraphs", () => {
  it("adds the link style when rendering", () => {
    assert.deepEqual(richHtmlParagraphs('<p><a href="https://example.com">x</a></p><p><br></p><p>y</p>', { linkStyle: "color:#000;" }), [
      '<a href="https://example.com" style="color:#000;">x</a>',
      "",
      "y",
    ]);
  });
});

describe("helpers", () => {
  it("decodes entities", () => {
    assert.equal(decodeEntities("&amp;&lt;&#65;&#x42;&unknown;&nbsp;"), "&<AB&unknown; ");
  });

  it("reads colours", () => {
    assert.equal(safeColor("#ABC"), "#aabbcc");
    assert.equal(safeColor("rgb(1, 2, 255)"), "#0102ff");
    assert.equal(safeColor("red"), null);
  });

  it("filters styles", () => {
    assert.equal(safeStyle("text-decoration-line: underline; font-style: italic"), "text-decoration:underline;font-style:italic");
    assert.equal(safeStyle("behavior:url(x)"), "");
  });

  it("converts the old markdown-style text", () => {
    assert.equal(
      markdownToRichHtml("Hi **there**,\nsee [our site](example.com).\n\n*Bye*"),
      '<p>Hi <strong>there</strong>,<br>see <a href="https://example.com">our site</a>.</p><p><em>Bye</em></p>',
    );
  });

  it("gives plain text", () => {
    assert.equal(richHtmlToPlainText("<p>Hi <b>you</b></p><p>a &amp; b</p>"), "Hi you a & b");
    assert.equal(hasRichText("<p><br></p>"), false);
    assert.equal(hasRichText("<p>x</p>"), true);
  });
});

describe("designs with rich text", () => {
  it("converts old markdown text blocks when a design is read", () => {
    const design = toDesign({ blocks: [{ id: "t", type: "text", text: "Go to [site](https://example.com)" }] });
    assert.ok(design);
    const block = design.blocks[0];
    assert.equal(block.type === "text" && block.format, "html");
    assert.equal(block.type === "text" && block.text, '<p>Go to <a href="https://example.com">site</a></p>');
    // Canonical: serializing again doesn't change anything.
    const json = serializeDesign(design);
    assert.equal(serializeDesign(parseDesign(json)!), json);
  });

  it("re-sanitises stored HTML and renders links as tracked-able <a> tags", () => {
    const design = toDesign({
      blocks: [
        {
          id: "t",
          type: "text",
          format: "html",
          text: '<p>Read <a href="https://example.com/post">the post</a><script>alert(1)</script> <a href="javascript:alert(1)">bad</a></p>',
        },
      ],
    });
    assert.ok(design);
    const html = renderDesign(design);
    assert.match(html, /<a href="https:\/\/example\.com\/post" style="color:#4f46e5;text-decoration:underline;">the post<\/a>/);
    assert.ok(!html.includes("<script"));
    assert.ok(!html.includes("javascript:"));
    assert.ok(html.includes(" bad"));
  });

  it("renders even when handed an unsanitised design directly", () => {
    const html = renderDesign({
      version: 1,
      styles: toDesign({})!.styles,
      blocks: [
        { id: "t", type: "text", format: "html", text: '<img src=x onerror="alert(1)"><p>ok</p>', align: "left", size: "normal", color: null },
      ],
    });
    assert.ok(!html.includes("onerror"));
    assert.ok(html.includes(">ok</p>"));
  });
});
