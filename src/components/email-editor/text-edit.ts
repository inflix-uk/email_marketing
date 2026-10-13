// Pure text transforms for the code editor's keyboard handling. Each returns
// the range to replace, the replacement, and where the selection should end
// up, so the component can apply it in a way that keeps native undo working.

export const INDENT = "  ";

export interface TextEdit {
  from: number;
  to: number;
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

function lineStartOf(value: string, pos: number): number {
  return value.lastIndexOf("\n", pos - 1) + 1;
}

/** The whole lines touched by a selection (a trailing line break doesn't count the next line). */
function lineBlock(value: string, start: number, end: number): { from: number; to: number } {
  const from = lineStartOf(value, start);
  const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const next = value.indexOf("\n", effectiveEnd);
  return { from, to: next === -1 ? value.length : next };
}

/** Tab: insert an indent, or indent every selected line when the selection spans lines. */
export function indentSelection(value: string, start: number, end: number): TextEdit {
  if (!value.slice(start, end).includes("\n")) {
    const cursor = start + INDENT.length;
    return { from: start, to: end, text: INDENT, selectionStart: cursor, selectionEnd: cursor };
  }
  const { from, to } = lineBlock(value, start, end);
  const text = value
    .slice(from, to)
    .split("\n")
    .map((line) => (line.trim() ? INDENT + line : line))
    .join("\n");
  return { from, to, text, selectionStart: from, selectionEnd: from + text.length };
}

function outdentLine(line: string): string {
  if (line.startsWith("\t")) return line.slice(1);
  return line.replace(new RegExp(`^ {1,${INDENT.length}}`), "");
}

/** Shift+Tab: remove one level of indentation from every touched line. Null when there is nothing to remove. */
export function outdentSelection(value: string, start: number, end: number): TextEdit | null {
  const { from, to } = lineBlock(value, start, end);
  const lines = value.slice(from, to).split("\n");
  const outdented = lines.map(outdentLine);
  const text = outdented.join("\n");
  if (text === value.slice(from, to)) return null;

  if (start === end && lines.length === 1) {
    const removed = lines[0].length - outdented[0].length;
    const cursor = Math.max(from, start - removed);
    return { from, to, text, selectionStart: cursor, selectionEnd: cursor };
  }
  return { from, to, text, selectionStart: from, selectionEnd: from + text.length };
}

/** Enter: new line that keeps the current line's indentation. */
export function newlineWithIndent(value: string, start: number, end: number): TextEdit {
  const lineStart = lineStartOf(value, start);
  const indent = /^[ \t]*/.exec(value.slice(lineStart, start))![0];
  const text = `\n${indent}`;
  const cursor = start + text.length;
  return { from: start, to: end, text, selectionStart: cursor, selectionEnd: cursor };
}

/** Replace the selection with `text`, leaving the cursor after it. */
export function insertText(start: number, end: number, text: string): TextEdit {
  const cursor = start + text.length;
  return { from: start, to: end, text, selectionStart: cursor, selectionEnd: cursor };
}

/** Apply an edit to a string (used by tests and as a reference implementation). */
export function applyTextEdit(value: string, edit: TextEdit): string {
  return value.slice(0, edit.from) + edit.text + value.slice(edit.to);
}

// --- Simple rich text (visual editor): **bold**, *italic*, [text](url) -------

/** True when the "*" at `index` is a lone star, not half of a "**" pair. */
function isLoneStar(value: string, index: number): boolean {
  return value[index] === "*" && value[index - 1] !== "*" && value[index + 1] !== "*";
}

/**
 * Wrap the selection in a marker ("**" for bold, "*" for italic), or remove
 * the marker when the selection is already wrapped in it. With nothing
 * selected, inserts `placeholder` and selects it so typing replaces it.
 */
export function toggleWrap(value: string, start: number, end: number, marker: "**" | "*", placeholder = "text"): TextEdit {
  const size = marker.length;
  const before = start - size;
  const wrapped =
    before >= 0 &&
    value.slice(before, start) === marker &&
    value.slice(end, end + size) === marker &&
    (marker === "**" || (isLoneStar(value, before) && isLoneStar(value, end)));
  if (wrapped) {
    const text = value.slice(start, end);
    return { from: before, to: end + size, text, selectionStart: before, selectionEnd: before + text.length };
  }
  const inner = value.slice(start, end) || placeholder;
  return {
    from: start,
    to: end,
    text: marker + inner + marker,
    selectionStart: start + size,
    selectionEnd: start + size + inner.length,
  };
}

export const LINK_URL_PLACEHOLDER = "https://";

/** Turn the selection into "[selection](https://)" with the address selected, ready to type or paste over. */
export function insertLink(value: string, start: number, end: number, placeholder = "link text"): TextEdit {
  const label = value.slice(start, end).replace(/\n+/g, " ") || placeholder;
  const urlStart = start + label.length + 3; // "[" + label + "]("
  return {
    from: start,
    to: end,
    text: `[${label}](${LINK_URL_PLACEHOLDER})`,
    selectionStart: urlStart,
    selectionEnd: urlStart + LINK_URL_PLACEHOLDER.length,
  };
}
