"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// Shares "has unsaved changes" between the editor form and the send panel, so
// nobody sends or schedules a version they haven't saved.

interface EditorState {
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
}

const EditorStateContext = createContext<EditorState>({ dirty: false, setDirty: () => {} });

export function EditorStateProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false);

  // Warn before closing the tab / reloading with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const value = useMemo(() => ({ dirty, setDirty }), [dirty]);
  return <EditorStateContext value={value}>{children}</EditorStateContext>;
}

export function useEditorState(): EditorState {
  return useContext(EditorStateContext);
}

/** Shown in the send panel while the form has unsaved edits. */
export function UnsavedChangesNotice() {
  const { dirty } = useEditorState();
  if (!dirty) return null;
  return (
    <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
      You have unsaved changes. The checks, tests and sending below use the last saved version.
    </p>
  );
}
