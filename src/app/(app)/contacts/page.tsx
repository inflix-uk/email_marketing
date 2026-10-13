import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/layout";
import { filtersToSearchParams, hasFilters, parseContactFilters, parsePage } from "@/lib/contacts/filters";
import { findContacts, getListOptions, getTagOptions } from "@/lib/contacts/queries";
import { formatNumber } from "@/lib/utils";
import { ContactFiltersBar } from "./_components/contact-filters";
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
  const filters = parseContactFilters(params);
  const [result, listOptions, tagOptions] = await Promise.all([
    findContacts(filters, parsePage(params.page)),
    getListOptions(),
    getTagOptions(),
  ]);
  const filtered = hasFilters(filters);
  const query = filtersToSearchParams(filters).toString();
  const isEmpty = result.total === 0 && !filtered;

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Everyone you can email. Search, filter and manage subscriptions."
        actions={
          <>
            {isEmpty ? null : (
              <DownloadLink href={`/api/contacts/export${query ? `?${query}` : ""}`}>
                {filtered ? "Export filtered" : "Export CSV"}
              </DownloadLink>
            )}
            <ButtonLink href="/contacts/suppress" variant="secondary">
              Suppress addresses
            </ButtonLink>
            <ButtonLink href="/contacts/import" variant="secondary">
              Import CSV
            </ButtonLink>
            <ButtonLink href="/contacts/new">Add contact</ButtonLink>
          </>
        }
      />

      {isEmpty ? (
        <EmptyState
          title="No contacts yet"
          description="Add people one by one, or import a CSV exported from your CRM, shop or spreadsheet. You can map its columns to names, tags and custom fields."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href="/contacts/import">Import CSV</ButtonLink>
              <ButtonLink href="/contacts/new" variant="secondary">
                Add a contact
              </ButtonLink>
            </div>
          }
        />
      ) : (
        <Card>
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <ContactFiltersBar key={query} filters={filters} lists={listOptions} tags={tagOptions} />
            <p className="shrink-0 text-sm text-slate-500" aria-live="polite">
              {formatNumber(result.total)} {filtered ? "matching " : ""}
              {result.total === 1 ? "contact" : "contacts"}
            </p>
          </div>

          <ContactsTable
            key={`${query}|${result.page}`}
            rows={result.rows}
            total={result.total}
            filters={filters}
            filtered={filtered}
            lists={listOptions}
            tags={tagOptions.map((t) => t.tag)}
            empty={
              <div className="px-6 py-12 text-center">
                <p className="text-sm font-medium text-slate-900">No contacts match these filters</p>
                <p className="mt-1 text-sm text-slate-500">
                  Try a different search, or{" "}
                  <Link href="/contacts" className="font-medium text-indigo-600 hover:text-indigo-500">
                    clear the filters
                  </Link>
                  .
                </p>
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
      )}
    </>
  );
}
