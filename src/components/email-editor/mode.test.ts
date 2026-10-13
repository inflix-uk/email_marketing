import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BLANK_DESIGN, serializeDesign, toDesign } from "@/lib/email-design";
import { initialMode } from "./mode";

describe("initialMode", () => {
  const design = toDesign({ blocks: [{ id: "t", type: "text", text: "Hello" }] })!;

  it("opens a saved design in the visual editor", () => {
    const mode = initialMode("<p>stale html</p>", serializeDesign(design));
    assert.equal(mode.kind, "visual");
    assert.deepEqual(mode.kind === "visual" && mode.design, design);
    assert.equal(mode.kind === "visual" && mode.fresh, false);
  });

  it("opens hand-written HTML in the HTML editor", () => {
    assert.deepEqual(initialMode("<p>Hi</p>", null), { kind: "html", html: "<p>Hi</p>" });
    assert.deepEqual(initialMode("<p>Hi</p>", undefined), { kind: "html", html: "<p>Hi</p>" });
    assert.deepEqual(initialMode("<p>Hi</p>", ""), { kind: "html", html: "<p>Hi</p>" });
  });

  it("falls back to the saved HTML when the design can't be read", () => {
    assert.deepEqual(initialMode("<p>Hi</p>", "{broken"), { kind: "html", html: "<p>Hi</p>" });
    assert.deepEqual(initialMode("<p>Hi</p>", '{"version":99}'), { kind: "html", html: "<p>Hi</p>" });
  });

  it("starts a blank visual design when there is nothing yet", () => {
    assert.deepEqual(initialMode("", null), { kind: "visual", design: BLANK_DESIGN, fresh: true });
    assert.deepEqual(initialMode("  \n", undefined), { kind: "visual", design: BLANK_DESIGN, fresh: true });
    assert.deepEqual(initialMode("", "{broken"), { kind: "visual", design: BLANK_DESIGN, fresh: true });
  });
});
