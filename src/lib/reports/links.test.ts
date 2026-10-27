import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { csvFileName, csvSafeCell, toCsv } from "./csv";
import { buildClickMapHtml, isSystemLink } from "./links";

const APP = "https://mail.example.com";

describe("isSystemLink", () => {
  test("own unsubscribe / tracking links", () => {
    assert.equal(isSystemLink(`${APP}/u/abc`, APP), true);
    assert.equal(isSystemLink(`${APP}/api/unsubscribe/abc`, APP), true);
    assert.equal(isSystemLink("https://shop.example.com/unsubscribe?x=1", APP), true);
    assert.equal(isSystemLink("mailto:a@b.c", APP), true);
  });
  test("content links", () => {
    assert.equal(isSystemLink("https://shop.example.com/sale", APP), false);
    assert.equal(isSystemLink(`${APP}/blog`, APP), false);
  });
});

describe("buildClickMapHtml", () => {
  const html =
    '<html><head></head><body><a href="https://a.example/x?y=1&amp;z=2">A</a> <a href="https://b.example">B</a>' +
    ` <a href="${APP}/u/1">Unsub</a> <a href="#top">Top</a></body></html>`;

  test("badges each tracked link with its share of clicks", () => {
    const { html: out, found } = buildClickMapHtml(
      html,
      [
        { url: "https://a.example/x?y=1&z=2", clicks: 3 },
        { url: "https://gone.example", clicks: 1 },
      ],
      APP,
    );
    assert.match(out, /75\.00%/);
    assert.match(out, /data-click-map="1"/);
    assert.match(out, /data-click-map="0"/); // b.example: no clicks
    assert.equal((out.match(/data-click-map="/g) ?? []).length, 2); // no badge on unsubscribe / anchors
    assert.deepEqual([...found], ["https://a.example/x?y=1&z=2"]);
    assert.ok(out.indexOf("<style>") < out.indexOf("</head>"));
  });
});

describe("csv", () => {
  test("formula injection protection", () => {
    assert.equal(csvSafeCell("=SUM(A1)"), "'=SUM(A1)");
    assert.equal(csvSafeCell("+1"), "'+1");
    assert.equal(csvSafeCell("-1"), "'-1");
    assert.equal(csvSafeCell("@cmd"), "'@cmd");
    assert.equal(csvSafeCell("hello"), "hello");
    assert.equal(csvSafeCell(5), "5");
    assert.equal(csvSafeCell(null), "");
  });
  test("toCsv quotes and escapes", () => {
    assert.equal(toCsv([["a", "b,c"], ["=x", 1]]), 'a,"b,c"\r\n\'=x,1\r\n');
  });
  test("file name", () => {
    assert.equal(csvFileName("Spring sale!", "links", new Date("2026-10-13T10:00:00Z")), "spring-sale-links-2026-10-13.csv");
  });
});
