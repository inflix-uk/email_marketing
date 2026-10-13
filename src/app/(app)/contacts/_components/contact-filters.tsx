"use client";

import { useRouter } from "next/navigation";
import { useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { CONTACT_STATUSES } from "@/db/schema";
import type { ContactFilters } from "@/lib/contacts/filters";
import type { ListRef } from "@/lib/contacts/queries";

const STATUS_LABELS: Record<(typeof CONTACT_STATUSES)[number], string> = {
  subscribed: "Subscribed",
  unsubscribed: "Unsubscribed",
  bounced: "Bounced",
  complained: "Complained",
};

/**
 * Search + status + list filters for the contacts table. Selects apply
 * immediately; the search applies on Enter. Works as a plain GET form without JS.
 * Render it with a `key` derived from the filters so it resets on navigation.
 */
export function ContactFiltersBar({ filters, lists }: { filters: ContactFilters; lists: ListRef[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function apply(form: HTMLFormElement) {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (typeof value === "string" && value.trim()) params.set(key, value.trim());
    }
    const query = params.toString();
    startTransition(() => router.push(query ? `/contacts?${query}` : "/contacts"));
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    apply(e.currentTarget);
  }

  const active = Boolean(filters.q || filters.status || filters.listId);

  return (
    <form
      action="/contacts"
      onSubmit={onSubmit}
      role="search"
      aria-busy={pending}
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <label htmlFor="contact-search" className="sr-only">
        Search contacts
      </label>
      <Input
        id="contact-search"
        name="q"
        type="search"
        defaultValue={filters.q}
        placeholder="Search by email or name..."
        className="sm:max-w-xs"
      />
      <label htmlFor="contact-status" className="sr-only">
        Status
      </label>
      <Select
        id="contact-status"
        name="status"
        defaultValue={filters.status ?? ""}
        onChange={(e) => apply(e.currentTarget.form!)}
        className="sm:w-44"
      >
        <option value="">All statuses</option>
        {CONTACT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </Select>
      <label htmlFor="contact-list" className="sr-only">
        List
      </label>
      <Select
        id="contact-list"
        name="list"
        defaultValue={filters.listId ?? ""}
        onChange={(e) => apply(e.currentTarget.form!)}
        className="sm:w-52"
      >
        <option value="">All lists</option>
        {lists.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </Select>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Searching..." : "Search"}
        </Button>
        {active ? (
          <Button type="button" variant="ghost" onClick={() => startTransition(() => router.push("/contacts"))}>
            Clear
          </Button>
        ) : null}
      </div>
    </form>
  );
}
