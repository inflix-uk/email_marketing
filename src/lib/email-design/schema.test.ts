import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADDABLE_BLOCK_TYPES,
  BLANK_DESIGN,
  createBlock,
  DEFAULT_STYLES,
  MAX_BLOCKS,
  normalizeHexColor,
  parseDesign,
  serializeDesign,
  toDesign,
} from "./schema";

describe("parseDesign", () => {
  it("returns null for missing or malformed input", () => {
    for (const input of [null, undefined, "", "   ", "not json", "{", "null", "42", '"text"', "[]", '{"blocks":"nope"}']) {
      assert.equal(parseDesign(input), null, String(input));
    }
  });

  it("rejects unknown block types, bad colours, bad ids and wrong value types", () => {
    const bad = [
      { blocks: [{ id: "a", type: "video" }] },
      { blocks: [{ id: "a", type: "text", text: 42 }] },
      { blocks: [{ id: "a b", type: "text", text: "x" }] },
      { blocks: [{ type: "text", text: "x" }] },
      { blocks: [{ id: "a", type: "button", backgroundColor: "red" }] },
      { blocks: [{ id: "a", type: "divider", color: "#fff;background:url(javascript:1)" }] },
      { blocks: [{ id: "a", type: "heading", level: 7 }] },
      { blocks: [{ id: "a", type: "text", align: "justify" }] },
      { styles: { pageBackground: "url(x)" }, blocks: [] },
      { styles: { fontFamily: "Comic Sans MS" }, blocks: [] },
      { version: 2, blocks: [] },
      { blocks: [{ id: "c", type: "columns", columns: [{ blocks: [] }] }] },
      { blocks: [{ id: "c", type: "columns", columns: [{ blocks: [{ id: "x", type: "heading" }] }, { blocks: [] }] }] },
      { blocks: Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => ({ id: `s${i}`, type: "spacer" })) },
    ];
    for (const value of bad) {
      assert.equal(parseDesign(JSON.stringify(value)), null, JSON.stringify(value).slice(0, 80));
    }
  });

  it("fills in defaults and always ends with one footer", () => {
    const design = parseDesign("{}");
    assert.ok(design);
    assert.deepEqual(design.styles, DEFAULT_STYLES);
    assert.deepEqual(
      design.blocks.map((b) => b.type),
      ["footer"],
    );

    const partial = parseDesign(JSON.stringify({ styles: { accentColor: "#FF0000" }, blocks: [{ id: "t", type: "text" }] }));
    assert.ok(partial);
    assert.equal(partial.styles.accentColor, "#ff0000");
    assert.equal(partial.styles.contentWidth, 600);
    assert.deepEqual(partial.blocks[0], { id: "t", type: "text", text: "", align: "left", size: "normal", color: null });
    assert.equal(partial.blocks.at(-1)?.type, "footer");
  });

  it("clamps numbers into range", () => {
    const design = toDesign({
      styles: { contentWidth: 5000 },
      blocks: [
        { id: "s", type: "spacer", height: -5 },
        { id: "i", type: "image", width: 250.6 },
      ],
    });
    assert.ok(design);
    assert.equal(design.styles.contentWidth, 720);
    assert.deepEqual(
      design.blocks.slice(0, 2).map((b) => (b.type === "spacer" ? b.height : b.type === "image" ? b.width : null)),
      [8, 100],
    );
  });

  it("makes duplicate ids unique, including inside columns", () => {
    const design = toDesign({
      blocks: [
        { id: "a", type: "text" },
        { id: "a", type: "text" },
        { id: "c", type: "columns", columns: [{ blocks: [{ id: "a", type: "text" }] }, { blocks: [{ id: "c", type: "button" }] }] },
        { id: "a", type: "footer" },
      ],
    });
    assert.ok(design);
    const ids: string[] = [];
    for (const block of design.blocks) {
      ids.push(block.id);
      if (block.type === "columns") for (const column of block.columns) for (const child of column.blocks) ids.push(child.id);
    }
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, 6);
  });

  it("drops unknown keys", () => {
    const design = parseDesign(JSON.stringify({ extra: 1, blocks: [{ id: "t", type: "text", text: "x", onclick: "alert(1)" }] }));
    assert.ok(design);
    assert.ok(!("extra" in design));
    assert.ok(!("onclick" in design.blocks[0]));
  });
});

describe("serializeDesign", () => {
  it("round-trips", () => {
    const json = serializeDesign(BLANK_DESIGN);
    assert.deepEqual(parseDesign(json), BLANK_DESIGN);
    assert.equal(serializeDesign(parseDesign(json)!), json);
  });

  it("is canonical: key order does not matter", () => {
    const a = toDesign({ styles: { accentColor: "#112233", textColor: "#000000" }, blocks: [{ id: "t", type: "text", text: "x", align: "center" }] });
    const b = toDesign({ blocks: [{ align: "center", text: "x", type: "text", id: "t" }], styles: { textColor: "#000000", accentColor: "#112233" } });
    assert.ok(a && b);
    assert.equal(serializeDesign(a), serializeDesign(b));
    // ...and a design object built in a different key order serialises the same way.
    const shuffled = { blocks: a.blocks.map((block) => ({ ...block })).reverse().reverse(), styles: { ...a.styles }, version: a.version };
    assert.equal(serializeDesign(shuffled), serializeDesign(a));
  });
});

describe("createBlock", () => {
  it("creates a valid block of every addable type", () => {
    for (const type of ADDABLE_BLOCK_TYPES) {
      const block = createBlock(type, "x1");
      assert.equal(block.type, type);
      assert.equal(block.id, "x1");
      assert.ok(toDesign({ blocks: [block] }), type);
    }
  });

  it("gives the blocks inside new columns their own ids", () => {
    const block = createBlock("columns", "col");
    assert.deepEqual(
      block.columns.map((column) => column.blocks.map((child) => child.id)),
      [["col-a"], ["col-b"]],
    );
  });
});

describe("normalizeHexColor", () => {
  it("accepts 3 and 6 digit hex colours, with or without #", () => {
    assert.equal(normalizeHexColor("#ABC"), "#aabbcc");
    assert.equal(normalizeHexColor("abc"), "#aabbcc");
    assert.equal(normalizeHexColor(" 4F46E5 "), "#4f46e5");
    assert.equal(normalizeHexColor("#4f46e5"), "#4f46e5");
  });

  it("returns null for anything else", () => {
    for (const input of ["", "#", "#ab", "#abcd", "red", "rgb(0,0,0)", "#gggggg", "#4f46e5;"]) {
      assert.equal(normalizeHexColor(input), null, input);
    }
  });
});
