"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Badge, StatusBadge } from "@/components/ui/layout";
import type { QuickSearchResult } from "@/lib/contacts/queries";
import { cleanSearchTerm } from "@/lib/contacts/search";
import { cn } from "@/lib/utils";
import { searchContactsAction } from "../actions";

const DEBOUNCE_MS = 250;
const MAX_LIST_CHIPS = 3;
const EMPTY: QuickSearchResult = { exactId: null, matches: [] };

/**
 * The big search box at the top of /contacts. While typing it shows up to 8
 * matching contacts; Enter or a click opens one. Enter on a full email address
 * of a contact opens that contact; otherwise Enter filters the table (?q=).
 */
export function ContactSearch({ initialQuery, listId }: { initialQuery?: string; listId?: string }) {
  const router = useRouter();
  const [term, setTerm] = useState(initialQuery ?? "");
  const [result, setResult] = useState<{ term: string; data: QuickSearchResult }>({ term: "", data: EMPTY });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [navigating, startTransition] = useTransition();
  const seq = useRef(0);
  const listboxId = useId();

  const clean = cleanSearchTerm(term);
  const matches = result.term === clean ? result.data.matches : [];

  async function search(value: string): Promise<QuickSearchResult> {
    const id = ++seq.current;
    setLoading(true);
    try {
      const data = await searchContactsAction(value);
      if (id === seq.current) setResult({ term: value, data });
      return data;
    } catch {
      return EMPTY;
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }

  // Debounced lookup while typing.
  useEffect(() => {
    if (!clean) {
      seq.current++;
      return;
    }
    const timer = setTimeout(() => void search(clean), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [clean]);

  function go(href: string) {
    setOpen(false);
    startTransition(() => router.push(href));
  }

  function openContact(id: string) {
    go(`/contacts/${id}`);
  }

  function filterTable(value: string) {
    const params = new URLSearchParams();
    if (value) params.set("q", value);
    if (listId) params.set("list", listId);
    const qs = params.toString();
    go(qs ? `/contacts?${qs}` : "/contacts");
  }

  async function submit() {
    if (active >= 0 && matches[active]) return openContact(matches[active].id);
    if (!clean) return filterTable("");
    const data = result.term === clean ? result.data : await search(clean);
    if (data.exactId) return openContact(data.exactId);
    filterTable(clean);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (matches.length ? (i + 1) % matches.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (matches.length ? (i <= 0 ? matches.length - 1 : i - 1) : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  const showList = open && clean.length > 0 && result.term === clean;

  return (
    <form
      action="/contacts"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="relative"
    >
      <label htmlFor="contact-quick-search" className="sr-only">
        Search contacts
      </label>
      <div className="relative">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
        >
          <path
            fillRule="evenodd"
            d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.45 4.39l3.08 3.08a.75.75 0 1 1-1.06 1.06l-3.08-3.08A7 7 0 0 1 2 9Z"
            clipRule="evenodd"
          />
        </svg>
        <input
          id="contact-quick-search"
          name="q"
          type="search"
          // The page's main job is finding someone, so put the cursor here.
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder="Search by email, name or phone"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listboxId}-${active}` : undefined}
          className="block h-12 w-full rounded-lg border-0 bg-white pl-11 pr-24 text-base text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" aria-live="polite">
          {navigating ? "Opening..." : loading ? "Searching..." : ""}
        </span>
      </div>

      {showList ? (
        <div
          id={listboxId}
          role="listbox"
          // Keep focus in the input while clicking a result.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg bg-white shadow-lg ring-1 ring-slate-200"
        >
          {matches.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">No contact found.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {matches.map((m, i) => (
                <li key={m.id} id={`${listboxId}-${i}`} role="option" aria-selected={i === active}>
                  <Link
                    href={`/contacts/${m.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      openContact(m.id);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={cn("flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3", i === active && "bg-indigo-50")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{m.email}</span>
                      {m.name ? <span className="block truncate text-xs text-slate-500">{m.name}</span> : null}
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center gap-1">
                      {m.lists.slice(0, MAX_LIST_CHIPS).map((name) => (
                        <Badge key={name} tone="indigo">
                          {name}
                        </Badge>
                      ))}
                      {m.lists.length > MAX_LIST_CHIPS ? <Badge>+{m.lists.length - MAX_LIST_CHIPS}</Badge> : null}
                      <StatusBadge status={m.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => filterTable(clean)}
            className="block w-full border-t border-slate-200 bg-slate-50 px-4 py-2 text-left text-sm font-medium text-indigo-600 hover:bg-slate-100"
          >
            Show all results for &ldquo;{clean}&rdquo;
          </button>
        </div>
      ) : null}
    </form>
  );
}
