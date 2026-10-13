import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildVariables,
  escapeHtml,
  extractMergeTags,
  htmlToText,
  renderMergeTags,
  type MergeContact,
  type MergeData,
} from "./render";

const contact: MergeContact = {
  email: "jane.doe@example.com",
  firstName: "Jane",
  lastName: "Doe",
  fields: { company: "Acme Ltd", city: "Leeds" },
};

function data(overrides: Partial<MergeContact> = {}, extra?: Record<string, string>): MergeData {
  return {
    contact: { ...contact, ...overrides },
    unsubscribeUrl: "https://mail.example.com/u/send-1?s=abc",
    companyAddress: "Acme Ltd, 1 High Street, Leeds LS1 1AA",
    extra,
  };
}

describe("renderMergeTags", () => {
  test("replaces the built-in contact tags", () => {
    const out = renderMergeTags("{{first_name}} {{last_name}} / {{full_name}} <{{email}}>", data());
    assert.equal(out, "Jane Doe / Jane Doe <jane.doe@example.com>");
  });

  test("tolerates whitespace inside the braces and is case-insensitive", () => {
    assert.equal(renderMergeTags("Hi {{  first_name  }}", data()), "Hi Jane");
    assert.equal(renderMergeTags("Hi {{First_Name}}", data()), "Hi Jane");
  });

  test("full_name copes with a missing first or last name", () => {
    assert.equal(renderMergeTags("{{full_name}}", data({ lastName: null })), "Jane");
    assert.equal(renderMergeTags("{{full_name}}", data({ firstName: "  ", lastName: "Doe" })), "Doe");
    assert.equal(renderMergeTags("[{{full_name}}]", data({ firstName: null, lastName: null })), "[]");
  });

  test("unsubscribe_url and company_address come from the merge data", () => {
    assert.equal(renderMergeTags("{{unsubscribe_url}}", data()), "https://mail.example.com/u/send-1?s=abc");
    assert.equal(renderMergeTags("{{company_address}}", data()), "Acme Ltd, 1 High Street, Leeds LS1 1AA");
  });

  test("company_address is empty (or its fallback) when not given", () => {
    const noAddress: MergeData = { ...data(), companyAddress: undefined };
    assert.equal(renderMergeTags("[{{company_address}}]", noAddress), "[]");
    assert.equal(renderMergeTags("{{company_address | Our address}}", noAddress), "Our address");
  });

  test("company_address is HTML-escaped in bodies", () => {
    const d: MergeData = { ...data(), companyAddress: "Smith & Sons <Ltd>" };
    assert.equal(renderMergeTags("{{company_address}}", d, { escape: true }), "Smith &amp; Sons &lt;Ltd&gt;");
  });

  describe("fallbacks", () => {
    test("used when the value is missing, empty or whitespace-only", () => {
      assert.equal(renderMergeTags("Hi {{first_name | there}}", data({ firstName: null })), "Hi there");
      assert.equal(renderMergeTags("Hi {{first_name | there}}", data({ firstName: "" })), "Hi there");
      assert.equal(renderMergeTags("Hi {{first_name|there}}", data({ firstName: "   " })), "Hi there");
    });

    test("ignored when the value is present", () => {
      assert.equal(renderMergeTags("Hi {{ first_name | there }}", data()), "Hi Jane");
    });

    test("may contain spaces and punctuation, trimmed at both ends", () => {
      assert.equal(
        renderMergeTags("Hello {{ first_name |  valued customer!  }}", data({ firstName: null })),
        "Hello valued customer!",
      );
    });

    test("an empty fallback renders nothing", () => {
      assert.equal(renderMergeTags("[{{first_name |}}]", data({ firstName: null })), "[]");
    });
  });

  describe("custom fields", () => {
    test("available as {{fields.key}} and as the bare {{key}}", () => {
      assert.equal(renderMergeTags("{{fields.company}} in {{fields.city}}", data()), "Acme Ltd in Leeds");
      assert.equal(renderMergeTags("{{company}} in {{city}}", data()), "Acme Ltd in Leeds");
    });

    test("support fallbacks in both syntaxes", () => {
      const d = data({ fields: {} });
      assert.equal(renderMergeTags("{{fields.company | your company}}", d), "your company");
      assert.equal(renderMergeTags("{{company | your company}}", d), "your company");
    });

    test("built-in tags win over a custom field with the same name", () => {
      const d = data({ fields: { email: "someone-else@example.org" } });
      assert.equal(renderMergeTags("{{email}}", d), "jane.doe@example.com");
      assert.equal(renderMergeTags("{{fields.email}}", d), "someone-else@example.org");
    });

    test("keys may contain dashes and digits", () => {
      const d = data({ fields: { "member-no": "A-42", plan2: "Pro" } });
      assert.equal(renderMergeTags("{{member-no}} / {{fields.plan2}}", d), "A-42 / Pro");
    });
  });

  test("extra variables are merged in and can override built-ins", () => {
    const d = data({}, { campaign_name: "Spring sale", first_name: "Override" });
    assert.equal(renderMergeTags("{{campaign_name}}: {{first_name}}", d), "Spring sale: Override");
  });

  test("unknown tags render empty, or their fallback", () => {
    assert.equal(renderMergeTags("a{{nope}}b", data()), "ab");
    assert.equal(renderMergeTags("a{{nope | x}}b", data()), "axb");
    assert.equal(renderMergeTags("{{fields.nope | n/a}}", data()), "n/a");
  });

  test("text that is not a merge tag is left untouched", () => {
    const input = "Price: {not a tag} {{ }} {{bad tag}} {single} }}";
    assert.equal(renderMergeTags(input, data()), input);
  });

  describe("HTML escaping", () => {
    const nasty = data({ firstName: `<script>alert("x")</script>`, fields: { company: "Smith & Sons 'Ltd'" } });

    test("escape: true escapes values for HTML bodies", () => {
      assert.equal(
        renderMergeTags("<p>{{first_name}}</p>", nasty, { escape: true }),
        "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>",
      );
      assert.equal(
        renderMergeTags("{{company}}", nasty, { escape: true }),
        "Smith &amp; Sons &#39;Ltd&#39;",
      );
    });

    test("escape: true also escapes fallbacks", () => {
      assert.equal(
        renderMergeTags("{{first_name | Tom & Jerry}}", data({ firstName: null }), { escape: true }),
        "Tom &amp; Jerry",
      );
    });

    test("escaping is off by default (subjects / plain text)", () => {
      assert.equal(renderMergeTags("{{company}}", nasty), "Smith & Sons 'Ltd'");
      assert.equal(renderMergeTags("{{company}}", nasty, { escape: false }), "Smith & Sons 'Ltd'");
    });

    test("the template markup itself is never escaped", () => {
      assert.equal(renderMergeTags(`<a href="{{unsubscribe_url}}">x</a>`, data(), { escape: true }),
        `<a href="https://mail.example.com/u/send-1?s=abc">x</a>`);
    });
  });

  test("tags named after Object.prototype members render as unknown tags", () => {
    assert.equal(renderMergeTags("[{{constructor}}]", data()), "[]");
    assert.equal(renderMergeTags("[{{toString | x}}]", data(), { escape: true }), "[x]");
  });
});

describe("buildVariables", () => {
  test("exposes every custom field under both names", () => {
    const vars = buildVariables(data());
    assert.equal(vars.company, "Acme Ltd");
    assert.equal(vars["fields.company"], "Acme Ltd");
    assert.equal(vars.city, "Leeds");
  });

  test("coerces non-string field values and treats null as empty", () => {
    const fields = { age: 42, nothing: null } as unknown as Record<string, string>;
    const vars = buildVariables(data({ fields }));
    assert.equal(vars.age, "42");
    assert.equal(vars.nothing, "");
  });
});

describe("escapeHtml", () => {
  test("escapes the five HTML-significant characters", () => {
    assert.equal(escapeHtml(`<a href="x">Tom & Jerry's</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;");
  });

  test("escapes ampersands first (no double-escaping artefacts)", () => {
    assert.equal(escapeHtml("&lt;"), "&amp;lt;");
  });
});

describe("extractMergeTags", () => {
  test("returns unique tag names in order of first use, without braces or fallbacks", () => {
    const html = "Hi {{ first_name | there }}, {{fields.company}} {{first_name}} {{unsubscribe_url}} {{company}}";
    assert.deepEqual(extractMergeTags(html), ["first_name", "fields.company", "unsubscribe_url", "company"]);
  });

  test("returns an empty array when there are no tags", () => {
    assert.deepEqual(extractMergeTags("<p>No tags {here}</p>"), []);
  });
});

describe("htmlToText", () => {
  test("drops head, style and script blocks", () => {
    const html = `<html><head><title>T</title><style>p{color:red}</style></head><body><script>alert(1)</script><p>Hello</p></body></html>`;
    assert.equal(htmlToText(html), "Hello");
  });

  test("turns links into 'label (url)' and bare urls into just the url", () => {
    assert.equal(
      htmlToText(`<p>Read <a href="https://example.com/post" style="x">the <b>post</b></a></p>`),
      "Read the post (https://example.com/post)",
    );
    assert.equal(htmlToText(`<a href="https://example.com">https://example.com</a>`), "https://example.com");
    assert.equal(htmlToText(`<a href='https://example.com'><img src="x.png"></a>`), "https://example.com");
  });

  test("keeps paragraph, line-break and list structure", () => {
    const html = "<h1>Title</h1><p>One<br>Two<br/>Three</p><ul><li>Apples</li><li>Pears</li></ul>";
    assert.equal(htmlToText(html), "Title\nOne\nTwo\nThree\n- Apples\n- Pears");
  });

  test("decodes common entities", () => {
    assert.equal(htmlToText("<p>Fish&nbsp;&amp;&nbsp;chips &lt;3 &quot;yum&quot; it&#39;s</p>"), `Fish & chips <3 "yum" it's`);
  });

  test("collapses whitespace and excess blank lines", () => {
    const html = "<p>  lots   of    space  </p>\n\n\n\n<p>next</p>";
    assert.equal(htmlToText(html), "lots of space\n\nnext");
  });

  test("renders a starter-style table layout to readable text", () => {
    const html = `<table><tr><td><h1 style="x">Hi Jane,</h1><p>Body text.</p></td></tr><tr><td><a href="{{unsubscribe_url}}">Unsubscribe</a></td></tr></table>`;
    // Each closing </p> and </tr> ends a line, so table rows are separated by a blank line.
    assert.equal(htmlToText(html), "Hi Jane,\nBody text.\n\nUnsubscribe ({{unsubscribe_url}})");
  });

  test("decodes entities once, including named ones like &pound;", () => {
    assert.equal(htmlToText("<p>&amp;lt; &pound;5 &ldquo;hi&rdquo; &#8364;1 &#x2014;</p>"), "&lt; £5 “hi” €1 —");
  });

  test("separates table cells", () => {
    assert.equal(htmlToText("<table><tr><td>A</td><td>B</td></tr></table>"), "A B");
  });
});
