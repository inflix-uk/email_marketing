import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STARTER_TEMPLATES } from "@/lib/starter-templates";
import { formatByteSize, htmlByteSize, lintEmailHtml, type LintIssue } from "./lint";
import { BLANK_STARTER } from "./starters";

const FOOTER = '<a href="{{unsubscribe_url}}">Unsubscribe</a>';

function email(body: string, head = ""): string {
  return `<!DOCTYPE html><html><head>${head}</head><body>${body}${FOOTER}</body></html>`;
}

function messages(issues: LintIssue[], level?: LintIssue["level"]): string[] {
  return issues.filter((i) => !level || i.level === level).map((i) => i.message);
}

function hasMessage(issues: LintIssue[], pattern: RegExp, level?: LintIssue["level"]): boolean {
  return messages(issues, level).some((m) => pattern.test(m));
}

describe("lintEmailHtml", () => {
  it("passes a clean email", () => {
    assert.deepEqual(lintEmailHtml(email("<p>Hello {{first_name | there}}</p>")), []);
  });

  it("passes every starter template without errors or warnings", () => {
    for (const starter of [...STARTER_TEMPLATES, BLANK_STARTER]) {
      assert.deepEqual(lintEmailHtml(starter.html), [], starter.key);
    }
  });

  it("reports an empty email as an error", () => {
    const issues = lintEmailHtml("   \n ");
    assert.equal(issues.length, 1);
    assert.equal(issues[0].level, "error");
  });

  it("reports a body with no visible content as an error", () => {
    const issues = lintEmailHtml(
      '<html><head><style>p{color:red}</style><title>Hi</title></head><body><table><tr><td>&nbsp;</td></tr></table><!-- Hello --></body></html>',
    );
    assert.ok(hasMessage(issues, /no visible text or images/, "error"));
  });

  it("treats an image-only email as having content", () => {
    const issues = lintEmailHtml(email('<img src="https://example.com/a.png" alt="Sale">'));
    assert.deepEqual(messages(issues, "error"), []);
  });

  it("warns when there is no unsubscribe link", () => {
    const issues = lintEmailHtml("<p>Hi there</p>");
    assert.ok(hasMessage(issues, /unsubscribe footer will be added automatically/, "warning"));
    assert.deepEqual(lintEmailHtml("<p>Hi</p><a href='{{ UNSUBSCRIBE_URL }}'>x</a>"), []);
  });

  it("flags an unsubscribe tag that is only inside a comment (no footer gets added)", () => {
    const issues = lintEmailHtml("<p>Hi</p><!-- {{unsubscribe_url}} -->");
    assert.ok(hasMessage(issues, /only appears inside an HTML comment/, "warning"));
    assert.ok(!hasMessage(issues, /footer will be added automatically/));
  });

  it("warns about script, form and iframe tags", () => {
    const issues = lintEmailHtml(
      email('<script>alert(1)</script><form action="/x"><input></form><iframe src="https://example.com"></iframe><p>Hi</p>'),
    );
    assert.ok(hasMessage(issues, /<script>/, "warning"));
    assert.ok(hasMessage(issues, /<form>/, "warning"));
    assert.ok(hasMessage(issues, /<iframe>/, "warning"));
  });

  it("does not flag tags that only appear in comments", () => {
    assert.deepEqual(lintEmailHtml(email("<!-- <script>x</script> <form> --><p>Hi</p>")), []);
  });

  it("keeps Outlook conditional comments", () => {
    const issues = lintEmailHtml(email("<!--[if mso]><form></form><![endif]--><p>Hi</p>"));
    assert.ok(hasMessage(issues, /<form>/));
  });

  it("counts images without alt text", () => {
    const issues = lintEmailHtml(
      email(
        '<img src="a.png"><img src="b.png" data-alt="x"><img src="c.png" alt=""><img alt src="d.png"><img src="e.png" ALT="E" />',
      ),
    );
    assert.ok(hasMessage(issues, /^2 images are missing alt text/));
    const one = lintEmailHtml(email('<img src="a.png"/>'));
    assert.ok(hasMessage(one, /^1 image is missing alt text/));
  });

  it("warns about data: URI images", () => {
    const issues = lintEmailHtml(email('<img alt="x" src="data:image/png;base64,AAAA">'));
    assert.ok(hasMessage(issues, /data: URI/));
  });

  it("warns about external stylesheets but not other link tags", () => {
    const withSheet = lintEmailHtml(email("<p>Hi</p>", '<link rel="stylesheet" href="https://example.com/a.css">'));
    assert.ok(hasMessage(withSheet, /External stylesheets/));
    const withIcon = lintEmailHtml(email("<p>Hi</p>", '<link rel="icon" href="/favicon.ico">'));
    assert.deepEqual(withIcon, []);
  });

  it("warns when the HTML is close to Gmail's clipping limit", () => {
    const big = email(`<p>${"x".repeat(101 * 1024)}</p>`);
    assert.ok(hasMessage(lintEmailHtml(big), /Gmail clips messages over 102 KB/));
    const small = email(`<p>${"x".repeat(90 * 1024)}</p>`);
    assert.ok(!hasMessage(lintEmailHtml(small), /Gmail/));
  });

  it("warns about custom fields without a fallback, once per field", () => {
    const issues = lintEmailHtml(email("<p>{{fields.company}} {{fields.company}} {{city | your city}} {{plan | }}</p>"));
    assert.deepEqual(messages(issues), [
      "{{fields.company}} is a custom field with no fallback - contacts without it will see a blank. Add a fallback, e.g. {{fields.company | there}}.",
    ]);
  });

  it("warns when only some uses of a custom field have a fallback", () => {
    const issues = lintEmailHtml(email("<p>{{company | us}} and {{company}}</p>"));
    assert.ok(hasMessage(issues, /\{\{company\}\} is a custom field with no fallback/));
  });

  it("does not require fallbacks for built-in tags (any case)", () => {
    assert.deepEqual(lintEmailHtml(email("<p>{{first_name}} {{ Last_Name }} {{email}} {{company_address}}</p>")), []);
  });

  it("suggests the built-in tag for likely typos, even with a fallback", () => {
    const issues = lintEmailHtml(email("<p>{{firstname | there}}</p>"));
    assert.ok(hasMessage(issues, /did you mean \{\{first_name\}\}/));
  });

  it("reports malformed merge tags", () => {
    const issues = lintEmailHtml(email("<p>{{first name}} {{last_name} {{#if x}}</p>"));
    const msg = messages(issues).find((m) => m.includes("appear as-is"));
    assert.ok(msg);
    assert.match(msg, /\{\{first name\}\}/);
    assert.match(msg, /\{\{last_name\}/);
    assert.match(msg, /\{\{#if x\}\}/);
  });

  it("lists errors before warnings", () => {
    const issues = lintEmailHtml("<script></script>");
    assert.equal(issues[0].level, "error");
    assert.ok(issues.slice(1).every((i) => i.level === "warning"));
  });
});

describe("htmlByteSize / formatByteSize", () => {
  it("counts UTF-8 bytes", () => {
    assert.equal(htmlByteSize("abc"), 3);
    assert.equal(htmlByteSize("é"), 2);
  });

  it("formats sizes", () => {
    assert.equal(formatByteSize(512), "512 B");
    assert.equal(formatByteSize(1024), "1 KB");
    assert.equal(formatByteSize(12_390), "12.1 KB");
    assert.equal(formatByteSize(102 * 1024), "102 KB");
  });
});
