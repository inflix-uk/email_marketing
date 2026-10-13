import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addBlock,
  addColumnChild,
  canDeleteBlock,
  canMoveBlock,
  collectIds,
  deleteBlock,
  deleteColumnChild,
  dropIndex,
  duplicateBlock,
  editorReducer,
  moveBlock,
  moveBlockTo,
  moveColumnChild,
  newBlockId,
  replaceBlock,
  replaceColumnChild,
  updateStyles,
  type EditorState,
} from "./edit";
import { createBlock, MAX_BLOCKS, MAX_COLUMN_BLOCKS, toDesign, type ColumnsBlock, type EmailDesign } from "./schema";

function sample(): EmailDesign {
  const design = toDesign({
    blocks: [
      { id: "a", type: "heading", text: "A" },
      { id: "b", type: "text", text: "B" },
      { id: "c", type: "button", label: "C" },
      { id: "footer", type: "footer" },
    ],
  });
  assert.ok(design);
  return design;
}

const order = (design: EmailDesign) => design.blocks.map((block) => block.id).join(" ");

describe("addBlock", () => {
  it("adds above the footer by default", () => {
    assert.equal(order(addBlock(sample(), createBlock("text", "n"))), "a b c n footer");
  });

  it("adds after the given block", () => {
    assert.equal(order(addBlock(sample(), createBlock("text", "n"), "a")), "a n b c footer");
    assert.equal(order(addBlock(sample(), createBlock("text", "n"), "c")), "a b c n footer");
  });

  it("never adds below the footer", () => {
    assert.equal(order(addBlock(sample(), createBlock("text", "n"), "footer")), "a b c n footer");
    assert.equal(order(addBlock(sample(), createBlock("text", "n"), "missing")), "a b c n footer");
  });

  it("refuses an id that is already used, and stops at the block limit", () => {
    const design = sample();
    assert.equal(addBlock(design, createBlock("text", "a")), design);
    let full = design;
    for (let i = 0; full.blocks.length < MAX_BLOCKS; i++) full = addBlock(full, createBlock("spacer", `s${i}`));
    assert.equal(addBlock(full, createBlock("text", "extra")), full);
  });

  it("does not mutate the original", () => {
    const design = sample();
    addBlock(design, createBlock("text", "n"));
    assert.equal(order(design), "a b c footer");
  });
});

describe("moveBlock / moveBlockTo", () => {
  it("moves up and down", () => {
    assert.equal(order(moveBlock(sample(), "b", -1)), "b a c footer");
    assert.equal(order(moveBlock(sample(), "b", 1)), "a c b footer");
  });

  it("stops at the top and above the footer", () => {
    const design = sample();
    assert.equal(moveBlock(design, "a", -1), design);
    assert.equal(moveBlock(design, "c", 1), design);
    assert.equal(canMoveBlock(design, "a", -1), false);
    assert.equal(canMoveBlock(design, "a", 1), true);
    assert.equal(canMoveBlock(design, "c", 1), false);
    assert.equal(canMoveBlock(design, "missing", 1), false);
  });

  it("never moves the footer", () => {
    const design = sample();
    assert.equal(moveBlock(design, "footer", -1), design);
    assert.equal(moveBlockTo(design, "footer", 0), design);
    assert.equal(canMoveBlock(design, "footer", -1), false);
  });

  it("moves to an index, clamped to the content", () => {
    assert.equal(order(moveBlockTo(sample(), "a", 2)), "b c a footer");
    assert.equal(order(moveBlockTo(sample(), "c", 0)), "c a b footer");
    assert.equal(order(moveBlockTo(sample(), "a", 99)), "b c a footer");
    assert.equal(order(moveBlockTo(sample(), "c", -5)), "c a b footer");
    const design = sample();
    assert.equal(moveBlockTo(design, "b", 1), design);
    assert.equal(moveBlockTo(design, "b", Number.NaN), design);
  });
});

describe("dropIndex", () => {
  const drop = (id: string, over: string, position: "before" | "after") => {
    const design = sample();
    const index = (blockId: string) => design.blocks.findIndex((block) => block.id === blockId);
    return order(moveBlockTo(design, id, dropIndex(index(id), index(over), position)));
  };

  it("drops before or after another block", () => {
    assert.equal(drop("a", "c", "before"), "b a c footer");
    assert.equal(drop("a", "c", "after"), "b c a footer");
    assert.equal(drop("c", "a", "before"), "c a b footer");
    assert.equal(drop("c", "a", "after"), "a c b footer");
  });

  it("is a no-op next to itself, and never passes the footer", () => {
    assert.equal(drop("b", "b", "before"), "a b c footer");
    assert.equal(drop("b", "b", "after"), "a b c footer");
    assert.equal(drop("b", "a", "after"), "a b c footer");
    assert.equal(drop("a", "footer", "before"), "b c a footer");
    assert.equal(drop("a", "footer", "after"), "b c a footer");
  });
});

describe("duplicateBlock", () => {
  it("inserts a copy with a new id right below the original", () => {
    const next = duplicateBlock(sample(), "b", "b2");
    assert.equal(order(next), "a b b2 c footer");
    assert.deepEqual({ ...next.blocks[2], id: "b" }, next.blocks[1]);
  });

  it("gives blocks inside copied columns new ids", () => {
    const design = addBlock(sample(), createBlock("columns", "col"));
    const next = duplicateBlock(design, "col", "dup");
    assert.equal(order(next), "a b c col dup footer");
    const ids = collectIds(next);
    assert.equal(ids.size, 4 + 2 * 3);
    assert.ok(ids.has("dup-1") && ids.has("dup-2"));
  });

  it("does not duplicate the footer or unknown blocks", () => {
    const design = sample();
    assert.equal(duplicateBlock(design, "footer", "f2"), design);
    assert.equal(duplicateBlock(design, "missing", "x"), design);
    assert.equal(duplicateBlock(design, "a", "b"), design, "new id already in use");
  });
});

describe("deleteBlock", () => {
  it("removes a block", () => {
    assert.equal(order(deleteBlock(sample(), "b")), "a c footer");
  });

  it("keeps the footer", () => {
    const design = sample();
    assert.equal(deleteBlock(design, "footer"), design);
    assert.equal(canDeleteBlock(design, "footer"), false);
    assert.equal(canDeleteBlock(design, "a"), true);
    assert.equal(deleteBlock(design, "missing"), design);
  });
});

describe("replaceBlock / updateStyles", () => {
  it("replaces a block by id without touching the others", () => {
    const design = sample();
    const next = replaceBlock(design, { ...design.blocks[1], text: "Changed" } as typeof design.blocks[1]);
    assert.equal(next.blocks[1].type === "text" && next.blocks[1].text, "Changed");
    assert.equal(next.blocks[0], design.blocks[0]);
    assert.equal(design.blocks[1].type === "text" && design.blocks[1].text, "B");
  });

  it("ignores unknown ids and type changes", () => {
    const design = sample();
    assert.equal(replaceBlock(design, createBlock("text", "missing")), design);
    assert.equal(replaceBlock(design, createBlock("button", "a")), design);
  });

  it("patches the global styles", () => {
    const design = sample();
    const next = updateStyles(design, { accentColor: "#ff0000" });
    assert.equal(next.styles.accentColor, "#ff0000");
    assert.equal(next.styles.textColor, design.styles.textColor);
    assert.equal(next.blocks, design.blocks);
  });
});

describe("column children", () => {
  const columns = (): ColumnsBlock => createBlock("columns", "col");
  const ids = (block: ColumnsBlock) => block.columns.map((column) => column.blocks.map((child) => child.id).join(","));

  it("adds, replaces, moves and deletes inside one column", () => {
    let block = addColumnChild(columns(), 0, createBlock("button", "btn"));
    block = addColumnChild(block, 1, createBlock("image", "img"));
    assert.deepEqual(ids(block), ["col-a,btn", "col-b,img"]);

    block = moveColumnChild(block, 0, "btn", -1);
    assert.deepEqual(ids(block), ["btn,col-a", "col-b,img"]);
    assert.equal(moveColumnChild(block, 0, "btn", -1), block);
    assert.equal(moveColumnChild(block, 0, "col-a", 1), block);
    assert.equal(moveColumnChild(block, 0, "img", 1), block, "child of the other column");

    const button = block.columns[0].blocks[0];
    assert.equal(button.type, "button");
    block = replaceColumnChild(block, 0, { ...button, label: "New" } as typeof button);
    assert.equal(block.columns[0].blocks[0].type === "button" && block.columns[0].blocks[0].label, "New");
    assert.equal(replaceColumnChild(block, 1, { ...button }), block);

    block = deleteColumnChild(block, 0, "btn");
    assert.deepEqual(ids(block), ["col-a", "col-b,img"]);
    assert.equal(deleteColumnChild(block, 0, "img"), block);
  });

  it("limits how much a column can hold", () => {
    let block = columns();
    for (let i = 0; i < MAX_COLUMN_BLOCKS + 3; i++) block = addColumnChild(block, 0, createBlock("text", `t${i}`));
    assert.equal(block.columns[0].blocks.length, MAX_COLUMN_BLOCKS);
  });
});

describe("newBlockId", () => {
  it("returns an id that is valid and unused", () => {
    const design = sample();
    const values = [0, 0, 0.5];
    // The first two candidates collide with an existing block.
    const taken = `b${"0".repeat(6)}`;
    const withTaken = addBlock(design, createBlock("text", taken));
    const id = newBlockId(withTaken, () => values.shift() ?? 0.9);
    assert.notEqual(id, taken);
    assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
    assert.match(newBlockId(design), /^b[0-9a-z]{6}$/);
  });
});

describe("editorReducer", () => {
  const start = (): EditorState => ({ design: sample(), selectedId: "b" });

  it("selects blocks that exist", () => {
    assert.equal(editorReducer(start(), { type: "select", id: "c" }).selectedId, "c");
    assert.equal(editorReducer(start(), { type: "select", id: null }).selectedId, null);
    assert.equal(editorReducer(start(), { type: "select", id: "missing" }).selectedId, "b");
  });

  it("selects a newly added block and places it after the given one", () => {
    const next = editorReducer(start(), { type: "add", block: createBlock("text", "n"), afterId: "b" });
    assert.equal(order(next.design), "a b n c footer");
    assert.equal(next.selectedId, "n");
  });

  it("selects the copy after duplicating", () => {
    const next = editorReducer(start(), { type: "duplicate", id: "b", newId: "b2" });
    assert.equal(order(next.design), "a b b2 c footer");
    assert.equal(next.selectedId, "b2");
  });

  it("keeps the selection while moving", () => {
    const next = editorReducer(start(), { type: "move", id: "b", direction: 1 });
    assert.equal(order(next.design), "a c b footer");
    assert.equal(next.selectedId, "b");
    assert.equal(order(editorReducer(start(), { type: "moveTo", id: "c", toIndex: 0 }).design), "c a b footer");
  });

  it("selects a neighbour after deleting the selected block", () => {
    assert.equal(editorReducer(start(), { type: "delete", id: "b" }).selectedId, "c");
    const last = editorReducer({ design: sample(), selectedId: "c" }, { type: "delete", id: "c" });
    assert.equal(order(last.design), "a b footer");
    assert.equal(last.selectedId, "b");
    const other = editorReducer(start(), { type: "delete", id: "a" });
    assert.equal(other.selectedId, "b");

    let state: EditorState = { design: sample(), selectedId: "a" };
    for (const id of ["a", "b", "c"]) state = editorReducer({ ...state, selectedId: id }, { type: "delete", id });
    assert.equal(order(state.design), "footer");
    assert.equal(state.selectedId, null);
  });

  it("returns the same state when nothing changes", () => {
    const state = start();
    assert.equal(editorReducer(state, { type: "delete", id: "footer" }), state);
    assert.equal(editorReducer(state, { type: "move", id: "a", direction: -1 }), state);
    assert.equal(editorReducer(state, { type: "duplicate", id: "footer", newId: "x" }), state);
    assert.equal(editorReducer(state, { type: "replace", block: createBlock("text", "missing") }), state);
  });

  it("replaces blocks and patches styles", () => {
    const state = start();
    const block = state.design.blocks[1];
    const replaced = editorReducer(state, { type: "replace", block: { ...block, text: "Edited" } as typeof block });
    assert.equal(replaced.design.blocks[1].type === "text" && replaced.design.blocks[1].text, "Edited");
    assert.equal(replaced.selectedId, "b");
    assert.equal(editorReducer(state, { type: "styles", patch: { contentWidth: 640 } }).design.styles.contentWidth, 640);
  });
});
