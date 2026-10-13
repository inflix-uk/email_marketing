import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyTextEdit,
  indentSelection,
  insertText,
  newlineWithIndent,
  outdentSelection,
  type TextEdit,
} from "./text-edit";

/** Apply an edit and render the selection as [ ] markers for readable assertions. */
function run(value: string, edit: TextEdit | null): string {
  if (!edit) return "(no change)";
  const next = applyTextEdit(value, edit);
  return (
    next.slice(0, edit.selectionStart) +
    "[" +
    next.slice(edit.selectionStart, edit.selectionEnd) +
    "]" +
    next.slice(edit.selectionEnd)
  );
}

describe("indentSelection", () => {
  it("inserts two spaces at the cursor", () => {
    assert.equal(run("ab", indentSelection("ab", 1, 1)), "a  []b");
  });

  it("replaces a single-line selection", () => {
    assert.equal(run("abcd", indentSelection("abcd", 1, 3)), "a  []d");
  });

  it("indents every line of a multi-line selection, skipping blank lines", () => {
    const value = "<p>\n\n<b>\n</p>";
    // select from inside line 1 to inside line 3
    assert.equal(run(value, indentSelection(value, 1, 6)), "[  <p>\n\n  <b>]\n</p>");
  });

  it("does not indent the line after a trailing line break", () => {
    const value = "a\nb\nc";
    assert.equal(run(value, indentSelection(value, 0, 4)), "[  a\n  b]\nc");
  });
});

describe("outdentSelection", () => {
  it("removes up to two spaces and keeps the cursor in place", () => {
    const value = "x\n    <p>";
    assert.equal(run(value, outdentSelection(value, 8, 8)), "x\n  <p[]>");
  });

  it("removes a leading tab", () => {
    assert.equal(run("\tab", outdentSelection("\tab", 3, 3)), "ab[]");
  });

  it("clamps the cursor to the line start", () => {
    const value = "  ab";
    assert.equal(run(value, outdentSelection(value, 1, 1)), "[]ab");
  });

  it("outdents every selected line", () => {
    const value = "  a\n b\nc";
    assert.equal(run(value, outdentSelection(value, 0, 6)), "[a\nb]\nc");
  });

  it("returns null when nothing is indented", () => {
    assert.equal(run("ab", outdentSelection("ab", 1, 1)), "(no change)");
  });
});

describe("newlineWithIndent", () => {
  it("keeps the indentation of the current line", () => {
    const value = "<td>\n    <p>Hi</p>";
    assert.equal(run(value, newlineWithIndent(value, value.length, value.length)), "<td>\n    <p>Hi</p>\n    []");
  });

  it("only copies indentation before the cursor", () => {
    assert.equal(run("  ab", newlineWithIndent("  ab", 1, 1)), " \n [] ab");
  });

  it("replaces the selection", () => {
    assert.equal(run("abc", newlineWithIndent("abc", 1, 2)), "a\n[]c");
  });
});

describe("insertText", () => {
  it("replaces the selection and puts the cursor after the text", () => {
    assert.equal(run("Hi X!", insertText(3, 4, "{{first_name}}")), "Hi {{first_name}}[]!");
  });
});
