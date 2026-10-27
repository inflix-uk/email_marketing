import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { advanceCursor, applyRssItems, excerpt, FeedError, parseFeed, renderRssItems, selectNewItems, type FeedItem } from "./rss-feed";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>Zextons Blog</title>
  <link>https://blog.example.com</link>
  <!-- <item><title>commented out</title></item> -->
  <item>
    <title>Second &amp; newest post</title>
    <link>https://blog.example.com/second</link>
    <guid isPermaLink="false">post-2</guid>
    <pubDate>Tue, 20 Oct 2026 09:00:00 GMT</pubDate>
    <description><![CDATA[<p>Hello <b>world</b>, this is <img src="https://img.example.com/2.jpg"> the second post.</p>]]></description>
  </item>
  <item>
    <title><![CDATA[First post]]></title>
    <link>https://blog.example.com/first</link>
    <guid>https://blog.example.com/first</guid>
    <pubDate>Mon, 19 Oct 2026 09:00:00 GMT</pubDate>
    <description>&lt;p&gt;Escaped &amp;amp; html&lt;/p&gt;</description>
    <enclosure url="https://img.example.com/1.png" type="image/png" length="1" />
  </item>
  <item>
    <title>No guid</title>
    <link>https://blog.example.com/no-guid</link>
    <media:thumbnail url="https://img.example.com/3.jpg" />
  </item>
</channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Inflix News</title>
  <entry>
    <title>Atom entry</title>
    <link rel="alternate" href="https://news.example.com/a"/>
    <link rel="self" href="https://news.example.com/a.xml"/>
    <id>urn:uuid:1</id>
    <updated>2026-10-21T10:00:00Z</updated>
    <summary type="html">&lt;p&gt;Summary text&lt;/p&gt;</summary>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("parses RSS 2.0 items", () => {
    const feed = parseFeed(RSS);
    assert.equal(feed.title, "Zextons Blog");
    assert.equal(feed.items.length, 3);
    const [second, first, noGuid] = feed.items;
    assert.equal(second.id, "post-2");
    assert.equal(second.title, "Second & newest post");
    assert.equal(second.link, "https://blog.example.com/second");
    assert.equal(second.excerpt, "Hello world , this is the second post.");
    assert.equal(second.image, "https://img.example.com/2.jpg");
    assert.deepEqual(second.publishedAt, new Date("2026-10-20T09:00:00Z"));
    assert.equal(first.title, "First post");
    assert.equal(first.excerpt, "Escaped & html");
    assert.equal(first.image, "https://img.example.com/1.png");
    assert.equal(noGuid.id, "https://blog.example.com/no-guid");
    assert.equal(noGuid.image, "https://img.example.com/3.jpg");
    assert.equal(noGuid.publishedAt, null);
  });

  it("parses Atom entries", () => {
    const feed = parseFeed(ATOM);
    assert.equal(feed.title, "Inflix News");
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].id, "urn:uuid:1");
    assert.equal(feed.items[0].link, "https://news.example.com/a");
    assert.equal(feed.items[0].excerpt, "Summary text");
  });

  it("rejects things that aren't feeds", () => {
    assert.throws(() => parseFeed("<html><body>Hello</body></html>"), FeedError);
  });

  it("drops unsafe links", () => {
    const feed = parseFeed(`<rss><channel><item><title>x</title><link>javascript:alert(1)</link><guid>g</guid></item></channel></rss>`);
    assert.equal(feed.items[0].link, null);
  });
});

describe("excerpt", () => {
  it("cuts long text at a word", () => {
    const text = excerpt("word ".repeat(100), 30);
    assert.ok(text.length <= 31);
    assert.ok(text.endsWith("…"));
  });
});

const item = (id: string, date: string | null, link: string | null = null): FeedItem => ({
  id,
  title: id,
  link,
  excerpt: "",
  image: null,
  publishedAt: date ? new Date(date) : null,
});

describe("selectNewItems / advanceCursor", () => {
  const items = [item("c", "2026-10-03"), item("a", "2026-10-01"), item("b", "2026-10-02")];

  it("first run takes the newest N", () => {
    assert.deepEqual(
      selectNewItems(items, { seenIds: [], lastItemAt: null }, 2).map((i) => i.id),
      ["c", "b"],
    );
  });

  it("skips posts already sent and older than the cursor", () => {
    const cursor = advanceCursor({ seenIds: [], lastItemAt: null }, [items[1]]);
    assert.deepEqual(cursor.seenIds, ["a"]);
    assert.deepEqual(cursor.lastItemAt, new Date("2026-10-01"));
    assert.deepEqual(
      selectNewItems(items, cursor, 10).map((i) => i.id),
      ["c", "b"],
    );
    const after = advanceCursor(cursor, [items[0], items[2]]);
    assert.deepEqual(selectNewItems(items, after, 10), []);
    // An old post re-appearing with a new id (but an old date) isn't sent again.
    assert.deepEqual(selectNewItems([item("z", "2026-09-01")], after, 10), []);
  });

  it("dedupes by link and by id inside one feed", () => {
    const cursor = { seenIds: ["https://x.example/p"], lastItemAt: null };
    assert.deepEqual(selectNewItems([item("other-id", null, "https://x.example/p")], cursor, 5), []);
    assert.equal(selectNewItems([item("d", null), item("d", null)], { seenIds: [], lastItemAt: null }, 5).length, 1);
  });

  it("remembers at most 500 ids", () => {
    const many = Array.from({ length: 600 }, (_, i) => item(`id-${i}`, null));
    assert.equal(advanceCursor({ seenIds: [], lastItemAt: null }, many).seenIds.length, 500);
  });
});

describe("rendering", () => {
  const posts = [{ ...item("p", null, "https://blog.example.com/p"), title: "<Hi> & bye", excerpt: "Text" }];

  it("escapes post content", () => {
    const html = renderRssItems(posts);
    assert.ok(html.includes("&lt;Hi&gt; &amp; bye"));
    assert.ok(html.includes('href="https://blog.example.com/p"'));
    assert.ok(!html.includes("<Hi>"));
  });

  it("replaces {{rss_items}} (a whole paragraph holding only the tag)", () => {
    const out = applyRssItems('<body><p style="x">{{ rss_items }}</p><p>Bye</p></body>', posts);
    assert.ok(!out.includes("rss_items"));
    assert.ok(!out.includes('<p style="x">'));
    assert.ok(out.includes("<p>Bye</p>"));
  });

  it("adds the posts before </body> when the tag is missing", () => {
    const out = applyRssItems("<html><body><p>Hi</p></body></html>", posts);
    assert.ok(out.indexOf("Read more") < out.indexOf("</body>"));
  });
});
