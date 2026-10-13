"use client";

import { useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/form";
import { MAX_TAG_LENGTH, splitTags, tagError, uniqueTags } from "@/lib/contacts/tags";

/**
 * Chip-style tag editor. Type a tag and press Enter (or a comma) to add it;
 * each chip is submitted as a `tags` form value, and anything still typed in
 * the box is submitted as `tagDraft` so it isn't lost on save.
 */
export function TagEditor({
  initial,
  suggestions = [],
  error,
}: {
  initial: string[];
  /** Tags already used on other contacts (offered while typing). */
  suggestions?: string[];
  error?: string;
}) {
  const [tags, setTags] = useState<string[]>(() => uniqueTags(initial));
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  /** Turn the typed text into chips. Returns false when it wasn't valid. */
  function commit(text: string): boolean {
    const typed = splitTags(text);
    const invalid = typed.map(tagError).find(Boolean);
    if (invalid) {
      setProblem(invalid);
      return false;
    }
    if (typed.length > 0) setTags((current) => uniqueTags([...current, ...typed]));
    setDraft("");
    setProblem(null);
    return true;
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if ((e.key === "Enter" && draft.trim()) || e.key === "," || e.key === ";") {
      e.preventDefault(); // Enter would otherwise save the whole form
      commit(draft);
    } else if (e.key === "Backspace" && !draft && tags.length > 0) {
      setTags((current) => current.slice(0, -1));
    }
  }

  const message = problem ?? error;
  const unused = suggestions.filter((s) => !tags.includes(s));

  return (
    <div className="space-y-2">
      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
          {tags.map((tag) => (
            <li
              key={tag}
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 py-0.5 pl-2 pr-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-500/20"
            >
              <span className="max-w-[16rem] truncate">{tag}</span>
              <button
                type="button"
                onClick={() => setTags((current) => current.filter((t) => t !== tag))}
                aria-label={`Remove tag ${tag}`}
                className="rounded px-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-indigo-600"
              >
                &times;
              </button>
              <input type="hidden" name="tags" value={tag} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No tags.</p>
      )}

      <label htmlFor="tag-draft" className="sr-only">
        Add a tag
      </label>
      <Input
        id="tag-draft"
        name="tagDraft"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setProblem(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
        list={unused.length > 0 ? "tag-suggestions" : undefined}
        placeholder="Type a tag and press Enter, e.g. vip"
        maxLength={MAX_TAG_LENGTH * 4}
        autoComplete="off"
        aria-invalid={message ? true : undefined}
        className="sm:max-w-sm"
      />
      {unused.length > 0 ? (
        <datalist id="tag-suggestions">
          {unused.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
      {message ? (
        <p className="text-xs text-red-600">{message}</p>
      ) : (
        <p className="text-xs text-slate-500">Tags are saved in lower case. Use them to filter contacts and start automations.</p>
      )}
    </div>
  );
}
