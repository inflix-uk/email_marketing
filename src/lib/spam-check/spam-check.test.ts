import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capitalsRatio, checkContent, contentHash, findImages, hostOf, shoutedWords, visibleText, type SpamRule } from ".";

const UNSUB = '<p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>';
const NORMAL_TEXT =
  "<p>Hello {{first_name}}, our autumn range has arrived. We picked a few favourites for you, from warm jumpers to " +
  "waterproof boots, and every order this week ships the next working day. Take a look and let us know what you think.</p>";

function rules(input: Parameters<typeof checkContent>[0]): SpamRule[] {
  return checkContent(input).map((f) => f.rule);
}

describe("visibleText", () => {
  it("drops head, style, script, comments, tags and attributes", () => {
    const html = `<!DOCTYPE html><html><head><title>FREE WINNER</title><style>.click-here{color:red} /* act now */</style></head>
      <body><!-- 100% free --><script>var winner = "guaranteed";</script>
      <div class="act-now" data-x="click here" title="risk-free">Hello <b>there</b></div></body></html>`;
    assert.equal(visibleText(html), "Hello there");
  });

  it("decodes entities and keeps words in separate cells apart", () => {
    assert.equal(visibleText("<td>Fish&nbsp;&amp;&nbsp;chips</td><td>&pound;5</td>"), "Fish & chips £5");
    assert.equal(visibleText("F<b>RE</b>E"), "FREE");
  });

  it("handles > inside attribute values and unclosed style tags", () => {
    assert.equal(visibleText('<a title="a > b" href="x">Link</a>'), "Link");
    assert.equal(visibleText("<p>Hi</p><style>.a{color:red}"), "Hi");
  });

  it("ignores zero-width preheader padding", () => {
    assert.equal(visibleText("<p>Hi&#8203;&zwnj;&#xAD;</p>"), "Hi");
  });
});

describe("checkContent - wording", () => {
  it("finds nothing in a normal email", () => {
    const findings = checkContent({ subject: "Our autumn range is here", html: NORMAL_TEXT + UNSUB });
    assert.deepEqual(findings, []);
  });

  it("does not flag ordinary words like sale and discount", () => {
    const findings = checkContent({
      subject: "Autumn sale: 20% discount on boots",
      html: `<p>Our sale starts today with a discount on everything, free delivery and a special offer.</p>${UNSUB}`,
    });
    assert.deepEqual(findings, []);
  });

  it("does not treat CSS, attributes or comments as keyword hits", () => {
    const html = `<html><head><style>.winner{} .click-here{}</style></head><body>
      <!-- act now, 100% free -->
      <table class="guaranteed risk-free"><tr><td style="font-family:'Cash Bonus'">${NORMAL_TEXT}</td></tr></table>
      <a href="https://example.com/winner?act=now" data-label="click here">See the range</a>${UNSUB}</body></html>`;
    assert.deepEqual(checkContent({ subject: "Hello", html }), []);
  });

  it("finds suspect phrases in the subject and body", () => {
    const findings = checkContent({ subject: "Act now - 100% FREE gift", html: `<p>Click here to claim. You are a winner.</p>${UNSUB}` });
    const phrases = findings.filter((f) => f.rule === "suspect-phrase").map((f) => `${f.location}:${f.match.toLowerCase()}`);
    assert.deepEqual(phrases.sort(), ["body:click here", "body:winner", "subject:100% free", "subject:act now"].sort());
  });

  it("matches whole phrases only", () => {
    assert.ok(!rules({ subject: "Meet the winners of our photo contest" }).includes("suspect-phrase"));
    assert.ok(rules({ subject: "Risk free trial" }).includes("suspect-phrase"));
  });

  it("flags shouted words and overall capitals", () => {
    const words = checkContent({ subject: "Our BIGGEST sale" });
    assert.equal(words.find((f) => f.rule === "caps-words")?.match, "BIGGEST");
    assert.ok(rules({ subject: "THIS IS OUR BIGGEST SALE EVER" }).includes("caps-ratio"));
    // Acronyms and short words are fine.
    assert.deepEqual(rules({ subject: "New FAQ and GDPR info for UK customers" }), []);
  });

  it("does not count merge tags or URLs as capitals", () => {
    assert.deepEqual(shoutedWords("Hi {{FIRST_NAME}}, see HTTPS://EXAMPLE.COM"), []);
    assert.equal(capitalsRatio("{{FIRST_NAME}}").letters, 0);
  });

  it("flags repeated punctuation", () => {
    const found = checkContent({ subject: "Last chance!!! Ready???", html: `<p>Save $$$ today</p>${UNSUB}` })
      .filter((f) => f.rule === "repeated-punctuation")
      .map((f) => f.match);
    assert.deepEqual(found, ["!!!", "???", "$$$"]);
    assert.ok(!rules({ subject: "Ready? Let's go!" }).includes("repeated-punctuation"));
  });

  it("checks the preview text and plain-text version too", () => {
    const findings = checkContent({ preheader: "Act now!!", text: "Visit bit.ly/abc today. Guaranteed." });
    const where = findings.map((f) => `${f.location}:${f.rule}`);
    assert.ok(where.includes("preheader:suspect-phrase"));
    assert.ok(where.includes("preheader:repeated-punctuation"));
    assert.ok(where.includes("text:suspect-phrase"));
    assert.ok(where.includes("text:link-shortener"));
  });
});

describe("checkContent - subject", () => {
  it("flags an empty subject only when a subject is given", () => {
    assert.deepEqual(rules({ subject: "  " }), ["empty-subject"]);
    assert.deepEqual(rules({ html: NORMAL_TEXT + UNSUB }), []);
  });

  it("flags a very long subject", () => {
    assert.ok(rules({ subject: "a".repeat(71) }).includes("long-subject"));
    assert.ok(!rules({ subject: "a".repeat(70) }).includes("long-subject"));
  });
});

describe("checkContent - body", () => {
  it("flags image-heavy emails but ignores tracking pixels", () => {
    const heavy = `<img src="https://example.com/banner.png" alt="Sale"><p>Shop now</p>${UNSUB}`;
    assert.ok(rules({ html: heavy }).includes("image-heavy"));
    const pixel = `${NORMAL_TEXT}<img src="https://example.com/p.gif" width="1" height="1">${UNSUB}`;
    assert.deepEqual(rules({ html: pixel }), []);
  });

  it("flags images without alt text (alt=\"\" is fine)", () => {
    const html = `${NORMAL_TEXT}<img src="https://example.com/img/hero.png"><img src="/logo.png" alt="">${UNSUB}`;
    const f = checkContent({ html }).find((x) => x.rule === "missing-alt");
    assert.equal(f?.match, "hero.png");
    const two = `${NORMAL_TEXT}<img src="a.png"><img src='b.png' title="x">${UNSUB}`;
    assert.equal(checkContent({ html: two }).find((x) => x.rule === "missing-alt")?.match, "2 images");
  });

  it("ignores images inside comments", () => {
    assert.deepEqual(findImages('<!-- <img src="x.png"> --><p>Hi</p>'), []);
  });

  it("flags link shorteners in links and text", () => {
    const html = `${NORMAL_TEXT}<a href="https://bit.ly/3abc">Read more</a> or visit www.tinyurl.com/x${UNSUB}`;
    const hosts = checkContent({ html }).filter((f) => f.rule === "link-shortener").map((f) => f.match);
    assert.deepEqual(hosts, ["bit.ly", "tinyurl.com"]);
    // A normal domain that merely contains a shortener's name is fine.
    assert.deepEqual(rules({ html: `${NORMAL_TEXT}<a href="https://notbit.ly.example.com/">x</a>${UNSUB}` }), []);
  });

  it("notes a missing unsubscribe link as info only", () => {
    const f = checkContent({ html: NORMAL_TEXT });
    assert.equal(f.length, 1);
    assert.equal(f[0].rule, "no-unsubscribe");
    assert.equal(f[0].severity, "info");
    // A commented-out tag doesn't count.
    assert.ok(rules({ html: `${NORMAL_TEXT}<!-- {{unsubscribe_url}} -->` }).includes("no-unsubscribe"));
  });

  it("gives every finding a stable id", () => {
    const a = checkContent({ subject: "WINNER!!!" });
    const b = checkContent({ subject: "WINNER!!!" });
    assert.deepEqual(
      a.map((f) => f.id),
      b.map((f) => f.id),
    );
    assert.equal(new Set(a.map((f) => f.id)).size, a.length);
  });
});

describe("helpers", () => {
  it("hostOf", () => {
    assert.equal(hostOf("https://www.Bit.ly/abc"), "bit.ly");
    assert.equal(hostOf("bit.ly/abc"), "bit.ly");
    assert.equal(hostOf("mailto:someone@example.com"), null);
    assert.equal(hostOf("{{unsubscribe_url}}"), null);
  });

  it("contentHash is stable and changes with the content", () => {
    assert.equal(contentHash({ subject: "a", html: "<p>b</p>" }), contentHash({ subject: "a", html: "<p>b</p>" }));
    assert.notEqual(contentHash({ subject: "a", html: "<p>b</p>" }), contentHash({ subject: "a", html: "<p>c</p>" }));
    assert.notEqual(contentHash({ subject: "ab", html: "" }), contentHash({ subject: "a", html: "b" }));
    assert.match(contentHash({}), /^[0-9a-z]{11}$/);
  });
});
