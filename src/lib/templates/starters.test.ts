import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDesign, renderDesign, serializeDesign } from "@/lib/email-design";
import { STARTER_TEMPLATES } from "@/lib/starter-templates";
import { lintEmailHtml } from "./lint";
import { BLANK_STARTER, BLANK_VISUAL_STARTER, findStarter, TEMPLATE_STARTERS } from "./starters";

describe("template starters", () => {
  it("offers the three starter designs, a blank visual design and blank HTML", () => {
    assert.deepEqual(
      TEMPLATE_STARTERS.map((starter) => starter.key),
      ["newsletter", "announcement", "plain", "blank-visual", "blank"],
    );
    assert.equal(findStarter("blank"), BLANK_STARTER);
    assert.equal(findStarter("nope"), undefined);
  });

  it("stores every visual starter as a canonical design whose HTML is generated from it", () => {
    for (const starter of [...STARTER_TEMPLATES, BLANK_VISUAL_STARTER]) {
      const design = parseDesign(starter.design);
      assert.ok(design, starter.key);
      assert.equal(serializeDesign(design), starter.design, starter.key);
      assert.equal(renderDesign(design), starter.html, starter.key);
      assert.equal(design.blocks.at(-1)?.type, "footer", starter.key);
    }
  });

  it("keeps the HTML starter free of a design, so it opens in the HTML editor", () => {
    assert.equal(BLANK_STARTER.design, null);
    assert.match(BLANK_STARTER.html, /\{\{unsubscribe_url\}\}/);
  });

  it("has no lint issues in any starter", () => {
    for (const starter of TEMPLATE_STARTERS) {
      assert.deepEqual(lintEmailHtml(starter.html), [], starter.key);
    }
  });

  it("never mentions anything but example.com", () => {
    for (const starter of TEMPLATE_STARTERS) {
      const hosts = [...starter.html.matchAll(/https?:\/\/([^/"'\s<]+)/g)].map((m) => m[1]);
      assert.deepEqual(
        hosts.filter((host) => host !== "example.com"),
        [],
        starter.key,
      );
    }
  });
});
