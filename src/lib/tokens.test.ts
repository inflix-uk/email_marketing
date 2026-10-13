import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildClickUrl,
  buildOneClickUnsubscribeUrl,
  buildOpenPixelUrl,
  buildUnsubscribeUrl,
  previewUnsubscribeUrl,
  sign,
  verify,
  verifyClick,
  verifyUnsubscribe,
  type LinkContext,
} from "./tokens";

// The builders are pure: everything comes from the LinkContext.
const ctx: LinkContext = {
  appUrl: "https://mail.example.com",
  secret: "test-secret-0123456789abcdef0123456789abcdef",
};
const otherSecret: LinkContext = { ...ctx, secret: "a-completely-different-secret-value-1234567890" };

const SEND_ID = "3f0c9a8e-8a8e-4c3e-9d5e-1b2c3d4e5f60";

describe("sign / verify", () => {
  test("signatures are short, URL-safe and deterministic", () => {
    const s = sign(ctx, "hello");
    assert.equal(s.length, 22);
    assert.match(s, /^[A-Za-z0-9_-]+$/);
    assert.equal(sign(ctx, "hello"), s);
    assert.notEqual(sign(ctx, "hello!"), s);
  });

  test("round-trips", () => {
    assert.equal(verify(ctx, "unsub:abc", sign(ctx, "unsub:abc")), true);
  });

  test("rejects a tampered value", () => {
    const s = sign(ctx, "unsub:abc");
    assert.equal(verify(ctx, "unsub:abd", s), false);
    assert.equal(verify(ctx, "unsub:abc ", s), false);
  });

  test("rejects a tampered, truncated or padded signature", () => {
    const s = sign(ctx, "unsub:abc");
    const flipped = (s[0] === "A" ? "B" : "A") + s.slice(1);
    assert.equal(verify(ctx, "unsub:abc", flipped), false);
    assert.equal(verify(ctx, "unsub:abc", s.slice(0, -1)), false);
    assert.equal(verify(ctx, "unsub:abc", s + "A"), false);
  });

  test("rejects missing signatures", () => {
    assert.equal(verify(ctx, "unsub:abc", null), false);
    assert.equal(verify(ctx, "unsub:abc", undefined), false);
    assert.equal(verify(ctx, "unsub:abc", ""), false);
  });

  test("signatures depend on the secret", () => {
    const s = sign(ctx, "unsub:abc");
    assert.equal(verify(otherSecret, "unsub:abc", s), false);
    assert.notEqual(sign(otherSecret, "unsub:abc"), s);
  });

  test("signatures do not depend on the app URL", () => {
    const moved: LinkContext = { ...ctx, appUrl: "https://news.example.org" };
    assert.equal(verify(moved, "unsub:abc", sign(ctx, "unsub:abc")), true);
  });
});

describe("unsubscribe URLs", () => {
  test("page URL uses the app URL and carries a valid signature", () => {
    const url = new URL(buildUnsubscribeUrl(ctx, SEND_ID));
    assert.equal(url.origin, "https://mail.example.com");
    assert.equal(url.pathname, `/u/${SEND_ID}`);
    assert.equal(verifyUnsubscribe(ctx, SEND_ID, url.searchParams.get("s")), true);
  });

  test("one-click URL points at the API route and shares the signature", () => {
    const page = new URL(buildUnsubscribeUrl(ctx, SEND_ID));
    const oneClick = new URL(buildOneClickUnsubscribeUrl(ctx, SEND_ID));
    assert.equal(oneClick.pathname, `/api/unsubscribe/${SEND_ID}`);
    assert.equal(oneClick.searchParams.get("s"), page.searchParams.get("s"));
    assert.equal(verifyUnsubscribe(ctx, SEND_ID, oneClick.searchParams.get("s")), true);
  });

  test("a signature for one send cannot unsubscribe another", () => {
    const s = new URL(buildUnsubscribeUrl(ctx, SEND_ID)).searchParams.get("s");
    assert.equal(verifyUnsubscribe(ctx, "some-other-send-id", s), false);
    assert.equal(verifyUnsubscribe(ctx, SEND_ID, null), false);
  });

  test("a signature made with another secret is rejected", () => {
    const s = new URL(buildUnsubscribeUrl(otherSecret, SEND_ID)).searchParams.get("s");
    assert.equal(verifyUnsubscribe(ctx, SEND_ID, s), false);
  });

  test("preview URL is unsigned and never verifies", () => {
    assert.equal(previewUnsubscribeUrl(ctx), "https://mail.example.com/u/preview");
    assert.equal(previewUnsubscribeUrl({ appUrl: "http://localhost:3000" }), "http://localhost:3000/u/preview");
    assert.equal(verifyUnsubscribe(ctx, "preview", null), false);
  });
});

describe("tracking URLs", () => {
  test("open pixel URL", () => {
    assert.equal(buildOpenPixelUrl(ctx, SEND_ID), `https://mail.example.com/api/t/o/${SEND_ID}`);
  });

  test("click URL round-trips the destination and verifies", () => {
    const target = "https://shop.example.com/sale?utm_source=email&utm_campaign=spring&x=a%20b#top";
    const url = new URL(buildClickUrl(ctx, SEND_ID, target));
    assert.equal(url.pathname, `/api/t/c/${SEND_ID}`);
    const u = url.searchParams.get("u");
    assert.equal(u, target);
    assert.equal(verifyClick(ctx, SEND_ID, u!, url.searchParams.get("s")), true);
  });

  test("click URL handles non-ASCII destinations", () => {
    const target = "https://example.com/café?q=£5 off";
    const url = new URL(buildClickUrl(ctx, SEND_ID, target));
    assert.equal(url.searchParams.get("u"), target);
    assert.equal(verifyClick(ctx, SEND_ID, target, url.searchParams.get("s")), true);
  });

  test("a changed destination is rejected (no open redirect)", () => {
    const url = new URL(buildClickUrl(ctx, SEND_ID, "https://example.com/offer"));
    const s = url.searchParams.get("s");
    assert.equal(verifyClick(ctx, SEND_ID, "https://evil.example.net/", s), false);
    assert.equal(verifyClick(ctx, "another-send", "https://example.com/offer", s), false);
  });

  test("signatures are scoped: a click signature is not an unsubscribe signature", () => {
    const unsub = new URL(buildUnsubscribeUrl(ctx, SEND_ID)).searchParams.get("s");
    const click = new URL(buildClickUrl(ctx, SEND_ID, "https://example.com")).searchParams.get("s");
    assert.equal(verifyUnsubscribe(ctx, SEND_ID, click), false);
    assert.equal(verifyClick(ctx, SEND_ID, "https://example.com", unsub), false);
  });
});
