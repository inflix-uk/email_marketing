import type { TextEdit } from "./text-edit";

/**
 * Apply a text edit to a (React-controlled) textarea or input through the
 * browser's editing commands, so the change fires a normal input event and
 * Ctrl+Z still works. Falls back to setRangeText where execCommand is gone.
 */
export function applyEditToElement(element: HTMLTextAreaElement | HTMLInputElement, edit: TextEdit): void {
  element.focus();
  element.setSelectionRange(edit.from, edit.to);
  const done = edit.text
    ? document.execCommand("insertText", false, edit.text)
    : edit.from === edit.to || document.execCommand("delete");
  if (!done) {
    element.setRangeText(edit.text, edit.from, edit.to, "end");
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
  element.setSelectionRange(edit.selectionStart, edit.selectionEnd);
}
