import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPreviewDocument, PREVIEW_UNSUBSCRIBE_URL, renderPreviewHtml, withBaseTarget } from "./preview";

describe("renderPreviewHtml", () => {
  it("fills merge tags with the sample contact", () => {
    const out = renderPreviewHtml(
      'Hi {{first_name | there}} {{fields.company}} <a href="{{unsubscribe_url}}">x</a> {{missing | friend}}',
    );
    assert.equal(out, `Hi Jane Acme Ltd <a href="${PREVIEW_UNSUBSCRIBE_URL}">x</a> friend`);
  });
});

describe("withBaseTarget", () => {
  it("inserts as the first element of <head>", () => {
    assert.equal(
      withBaseTarget('<!DOCTYPE html><html><head lang="en"><base href="/x"></head><body></body></html>'),
      '<!DOCTYPE html><html><head lang="en"><base target="_blank"><base href="/x"></head><body></body></html>',
    );
  });

  it("adds a <head> when the document has none", () => {
    assert.equal(
      withBaseTarget("<html><body>Hi</body></html>"),
      '<html><head><base target="_blank"></head><body>Hi</body></html>',
    );
  });

  it("keeps the doctype first", () => {
    assert.equal(withBaseTarget("<!doctype html>\n<p>Hi</p>"), '<!doctype html><base target="_blank">\n<p>Hi</p>');
  });

  it("prepends to fragments", () => {
    assert.equal(withBaseTarget("<p>Hi</p>"), '<base target="_blank"><p>Hi</p>');
  });
});

describe("buildPreviewDocument", () => {
  it("renders tags and adds the base target", () => {
    assert.equal(buildPreviewDocument("<p>{{first_name}}</p>"), '<base target="_blank"><p>Jane</p>');
  });

  it("escapes merged values", () => {
    // Sample data has no special characters, so check a fallback is escaped.
    assert.equal(buildPreviewDocument("{{nope | <b>}}"), '<base target="_blank">&lt;b&gt;');
  });
});
