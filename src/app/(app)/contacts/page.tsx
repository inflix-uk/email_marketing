import type { Metadata } from "next";
import Link from "next/link";
import { Can } from "@/components/role-context";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/layout";
import { filtersToSearchParams, hasFilters, parseContactFilters, parsePage, type ContactFilters } from "@/lib/contacts/filters";
import { findContacts, getListOptions } from "@/lib/contacts/queries";
import { formatNumber } from "@/lib/utils";
import { ContactFiltersBar } from "./_components/contact-filters";
import { ContactSearch } from "./_components/contact-search";
import { ContactsTable } from "./_components/contacts-table";
import { DownloadLink } from "./_components/download-link";
import { Pagination } from "./_components/pagination";

export const metadata: Metadata = { title: "Contacts" };

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // Only search and list filters are offered; anything else in the URL is ignored.
  const parsed = parseContactFilters(params);
  const filters: ContactFilters = { q: parsed.q, listId: parsed.listId };
  const [result, listOptions] = await Promise.all([findContacts(filters, parsePage(params.page)), getListOptions()]);
  const filtered = hasFilters(filters);
  const query = filtersToSearchParams(filters).toString();
  const isEmpty = result.total === 0 && !filtered;

  return (
    <>
      <PageHeader
        title="Contacts"
        actions={
          <>
            <Can permission="export">
              {isEmpty ? null : <DownloadLink href={`/api/contacts/export${query ? `?${query}` : ""}`}>Export</DownloadLink>}
            </Can>
            <Can permission="edit">
              <ButtonLink href="/contacts/import" variant="secondary">
                Import
              </ButtonLink>
              <ButtonLink href="/contacts/new">Add contact</ButtonLink>
            </Can>
          </>
        }
      />

      {isEmpty ? (
        <EmptyState title="No contacts yet" description="Import a CSV file or add people one by one." />
      ) : (
        <>
          <div className="mb-4">
            <ContactSearch key={query} initialQuery={filters.q} listId={filters.listId} />
          </div>
          <Card>
            <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <ContactFiltersBar key={query} filters={filters} lists={listOptions} />
              <p className="shrink-0 text-sm text-slate-500" aria-live="polite">
                {formatNumber(result.total)} {result.total === 1 ? "contact" : "contacts"}
              </p>
            </div>

            <ContactsTable
              key={`${query}|${result.page}`}
              rows={result.rows}
              total={result.total}
              filters={filters}
              lists={listOptions}
              empty={
                <div className="px-6 py-12 text-center text-sm text-slate-500">
                  No contacts found.{" "}
                  <Link href="/contacts" className="font-medium text-indigo-600 hover:text-indigo-500">
                    Show all
                  </Link>
                </div>
              }
            />

            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              pageSize={result.pageSize}
              total={result.total}
              hrefFor={(page) => {
                const qs = filtersToSearchParams(filters, page).toString();
                return qs ? `/contacts?${qs}` : "/contacts";
              }}
            />
          </Card>
        </>
      )}
    </>
  );
}
