"use client";

import { createContext, useContext, useEffect, useMemo, useRef, type RefObject } from "react";
import { applyEditToElement } from "@/components/email-editor/apply-edit";
import { Select } from "@/components/ui/select";
import { personalisationExample, personalisationOptions, tagInsertion } from "@/lib/personalisation";
import { cn } from "@/lib/utils";

/** Custom contact field names (e.g. "country") offered by every PersonaliseSelect below it. */
export const PersonalisationFields = createContext<readonly string[]>([]);

/**
 * "Insert personalisation" dropdown for a one-line field (subject, preview
 * text): puts a merge tag such as {{first_name | there}} at the caret of
 * `inputRef` (at the end when the field was never clicked). Works for
 * controlled and uncontrolled inputs (it fires a normal input event).
 */
export function PersonaliseSelect({
  inputRef,
  fieldKeys,
  className,
  "aria-label": ariaLabel = "Insert personalisation",
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  /** Defaults to the surrounding PersonalisationFields. */
  fieldKeys?: readonly string[];
  className?: string;
  "aria-label"?: string;
}) {
  const contextKeys = useContext(PersonalisationFields);
  const keys = fieldKeys ?? contextKeys;
  const options = useMemo(() => personalisationOptions(keys), [keys]);
  const caret = useRef<{ start: number; end: number } | null>(null);

  // Remember where the caret was when the field lost focus (clicking the dropdown blurs it).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const remember = () => {
      caret.current = { start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length };
    };
    el.addEventListener("blur", remember);
    return () => el.removeEventListener("blur", remember);
  }, [inputRef]);

  function insert(tag: string) {
    const el = inputRef.current;
    if (!tag || !el || el.disabled || el.readOnly) return;
    const length = el.value.length;
    const { start, end } = caret.current ?? { start: length, end: length };
    const edit = tagInsertion(el.value, tag, start, end);
    // Don't insert half a tag into a field that is nearly full.
    if (el.maxLength > 0 && length - (edit.to - edit.from) + edit.text.length > el.maxLength) return;
    applyEditToElement(el, edit);
    caret.current = { start: edit.selectionStart, end: edit.selectionEnd };
  }

  const contact = options.filter((o) => o.group === "contact");
  const fields = options.filter((o) => o.group === "field");

  return (
    <Select value="" onChange={(e) => insert(e.target.value)} aria-label={ariaLabel} className={cn("w-52", className)}>
      <option value="" disabled>
        Insert personalisation
      </option>
      {fields.length ? (
        <>
          <optgroup label="Contact">
            {contact.map((o) => (
              <option key={o.tag} value={o.tag}>
                {o.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Custom fields">
            {fields.map((o) => (
              <option key={o.tag} value={o.tag}>
                {o.label}
              </option>
            ))}
          </optgroup>
        </>
      ) : (
        contact.map((o) => (
          <option key={o.tag} value={o.tag}>
            {o.label}
          </option>
        ))
      )}
    </Select>
  );
}

/** "Looks like: Hi Jane, your November treat" under a personalised subject or preview text. */
export function PersonalisationExample({ text, className }: { text: string; className?: string }) {
  const example = useMemo(() => personalisationExample(text), [text]);
  if (!example) return null;
  return (
    <p className={cn("text-xs text-slate-500", className)}>
      Looks like: <span className="text-slate-800">{example.filled || "(empty)"}</span>
      {example.empty !== null ? (
        <>
          {" "}
          · If details are missing: <span className="text-slate-800">{example.empty || "(empty)"}</span>
        </>
      ) : null}
    </p>
  );
}
