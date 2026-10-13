"use client";

import { useState } from "react";
import { Segmented, SegmentButton } from "./controls";
import { HtmlEditor } from "./html-editor";
import { initialMode, type EditorMode } from "./mode";
import { VisualEditor } from "./visual-editor";

export interface EmailEditorProps {
  /** Name of the hidden <input> carrying the current HTML, so the editor works inside any <form>. */
  name: string;
  /** Initial HTML. Later changes are ignored - remount with a `key` to reset. */
  defaultValue: string;
  /** Shown above the preview, for context. */
  previewText?: string;
  /** Minimum height of the editing / preview panes in px. */
  minHeight?: number;
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
 * Email editor with a live preview, merge-tag insertion and lint checks.
 *
 * - HTML mode: a code editor (the only mode when `designName` isn't set).
 * - Visual mode: build the email from blocks; the HTML is generated.
 *
 * Either way the current HTML is submitted through a hidden input.
 */
export function EmailEditor(props: EmailEditorProps) {
  if (props.designName === undefined) {
    const { name, defaultValue, previewText, minHeight, onChange, id } = props;
    return (
      <HtmlEditor
        name={name}
        defaultValue={defaultValue}
        previewText={previewText}
        minHeight={minHeight}
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
  previewText,
  minHeight,
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
        previewText={previewText}
        minHeight={minHeight}
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
        previewText={previewText}
        minHeight={minHeight}
        onChange={onChange}
        id={id}
        toolbarStart={
          <Segmented label="Editor mode">
            <SegmentButton
              pressed={false}
              disabled
              title="Hand-written HTML can't be converted into a visual design"
            >
              Visual
            </SegmentButton>
            <SegmentButton pressed onClick={() => undefined}>
              HTML
            </SegmentButton>
          </Segmented>
        }
        notice="This email is hand-written HTML. HTML can't be converted into visual blocks, so it is edited as code."
      />
      <input type="hidden" name={designName} value="" />
    </>
  );
}
