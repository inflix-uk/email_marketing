import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkImage,
  cleanImageName,
  IMAGE_EMPTY_ERROR,
  IMAGE_SIZE_ERROR,
  IMAGE_TYPE_ERROR,
  isImageContentType,
  MAX_IMAGE_BYTES,
  sniffImageType,
} from "./image-type";

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap((v) => (typeof v === "string" ? [...v].map((ch) => ch.charCodeAt(0)) : [v])));

const PNG = bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, "IHDR");
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, "JFIF");
const GIF = bytes("GIF89a", 1, 0, 1, 0);
const WEBP = bytes("RIFF", 0x24, 0, 0, 0, "WEBPVP8 ");

describe("sniffImageType", () => {
  it("recognises the accepted formats by their leading bytes", () => {
    assert.equal(sniffImageType(PNG), "image/png");
    assert.equal(sniffImageType(JPEG), "image/jpeg");
    assert.equal(sniffImageType(GIF), "image/gif");
    assert.equal(sniffImageType(bytes("GIF87a", 1, 0)), "image/gif");
    assert.equal(sniffImageType(WEBP), "image/webp");
  });

  it("rejects everything else, including SVG, HTML and other RIFF files", () => {
    for (const data of [
      bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      bytes('<?xml version="1.0"?><svg></svg>'),
      bytes("<!DOCTYPE html><html><script>alert(1)</script></html>"),
      bytes("%PDF-1.7"),
      bytes("RIFF", 0x24, 0, 0, 0, "WAVEfmt "),
      bytes("BM", 0, 0, 0, 0),
      bytes("GIF90a"),
      bytes(0x89, "PNG"),
      bytes(0xff, 0xd8),
      bytes("plain text"),
      new Uint8Array(0),
    ]) {
      assert.equal(sniffImageType(data), null);
    }
  });
});

describe("checkImage", () => {
  it("accepts a valid image", () => {
    assert.deepEqual(checkImage(PNG), { ok: true, contentType: "image/png" });
  });

  it("explains what is wrong otherwise", () => {
    assert.deepEqual(checkImage(new Uint8Array(0)), { ok: false, error: IMAGE_EMPTY_ERROR });
    assert.deepEqual(checkImage(bytes("<svg></svg>")), { ok: false, error: IMAGE_TYPE_ERROR });

    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG);
    assert.deepEqual(checkImage(big), { ok: false, error: IMAGE_SIZE_ERROR });

    const exact = new Uint8Array(MAX_IMAGE_BYTES);
    exact.set(PNG);
    assert.equal(checkImage(exact).ok, true);
  });
});

describe("cleanImageName", () => {
  it("keeps the base name and uses the real type's extension", () => {
    assert.equal(cleanImageName("Summer sale.PNG", "image/png"), "Summer sale.png");
    assert.equal(cleanImageName("photo.png", "image/jpeg"), "photo.jpg");
    assert.equal(cleanImageName("evil.svg", "image/gif"), "evil.gif");
  });

  it("strips paths and control characters, and never returns an empty name", () => {
    assert.equal(cleanImageName("C:\\Users\\me\\logo.webp", "image/webp"), "logo.webp");
    assert.equal(cleanImageName("../../etc/passwd", "image/png"), "passwd.png");
    assert.equal(cleanImageName("a\u0000b\r\n.png", "image/png"), "ab.png");
    assert.equal(cleanImageName("", "image/png"), "image.png");
    assert.equal(cleanImageName(".png", "image/png"), "image.png");
    assert.equal(cleanImageName("x".repeat(300) + ".png", "image/png").length, 104);
  });
});

describe("isImageContentType", () => {
  it("only accepts the four supported types", () => {
    assert.equal(isImageContentType("image/png"), true);
    assert.equal(isImageContentType("image/svg+xml"), false);
    assert.equal(isImageContentType("text/html"), false);
    assert.equal(isImageContentType(undefined), false);
    assert.equal(isImageContentType("toString"), false);
  });
});
