"use client";

import { useState } from "react";
import { HtmlEditor } from "./html-editor";
import { initialMode, type EditorMode } from "./mode";
import { VisualEditor } from "./visual-editor";

export interface EmailEditorProps {
  /** Name of the hidden <input> carrying the current HTML, so the editor works inside any <form>. */
  name: string;
  /** Initial HTML. Later changes are ignored - remount with a `key` to reset. */
  defaultValue: string;
  /** @deprecated No longer shown; accepted so older callers keep compiling. */
  previewText?: string;
  /** Minimum height of the editing / preview panes in px (used when `height` isn't set). */
  minHeight?: number;
  /**
   * CSS height of the editing / preview panes, e.g. "calc(100dvh - 16rem)".
   * Defaults to roughly the viewport height, at least `minHeight`.
   */
  height?: string;
  /** Called with the new HTML after every edit. */
  onChange?: (html: string) => void;
  /** id of the code textarea (HTML mode), for an external <label htmlFor>. */
  id?: string;
  /**
   * Turns on the visual editor. The design JSON is submitted in a hidden
   * <input> with this name; it is "" when the content is hand-written HTML.
   * Without it the editor is HTML-only.
   */
  designName?: string;
  /**
   * The saved design JSON. null/undefined with non-empty HTML opens in HTML
   * mode; null/undefined with empty HTML opens the visual editor with a blank
   * design. Later changes are ignored - remount with a `key` to reset.
   */
  defaultDesign?: string | null;
  /** Called with the design JSON after every edit ("" once the email is hand-written HTML). */
  onDesignChange?: (design: string) => void;
}

/**
 * Email editor with a live preview.
 *
 * - Visual mode: build the email from blocks; the HTML is generated.
 * - HTML mode: a code editor (the only mode when `designName` isn't set).
 *
 * Either way the current HTML is submitted through a hidden input.
 */
export function EmailEditor(props: EmailEditorProps) {
  if (props.designName === undefined) {
    const { name, defaultValue, minHeight, height, onChange, id } = props;
    return (
      <HtmlEditor
        name={name}
        defaultValue={defaultValue}
        minHeight={minHeight}
        height={height}
        onChange={onChange}
        id={id}
      />
    );
  }
  return <DualModeEditor {...props} designName={props.designName} />;
}

function DualModeEditor({
  name,
  defaultValue,
  minHeight,
  height,
  onChange,
  id,
  designName,
  defaultDesign,
  onDesignChange,
}: EmailEditorProps & { designName: string }) {
  const [mode, setMode] = useState<EditorMode>(() => initialMode(defaultValue, defaultDesign));

  if (mode.kind === "visual") {
    return (
      <VisualEditor
        name={name}
        designName={designName}
        initialDesign={mode.design}
        announceInitial={mode.fresh}
        minHeight={minHeight}
        height={height}
        onChange={onChange}
        onDesignChange={onDesignChange}
        onSwitchToHtml={(html) => {
          // The generated HTML becomes the content; the design is dropped.
          setMode({ kind: "html", html });
          onChange?.(html);
          onDesignChange?.("");
        }}
      />
    );
  }

  return (
    <>
      <HtmlEditor
        name={name}
        defaultValue={mode.html}
        minHeight={minHeight}
        height={height}
        onChange={onChange}
        id={id}
      />
      <input type="hidden" name={designName} value="" />
    </>
  );
}
