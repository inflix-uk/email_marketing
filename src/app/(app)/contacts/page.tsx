import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader, StatusBadge, Table, TBody, Td, Th } from "@/components/ui/layout";
import { filtersToSearchParams, hasFilters, parseContactFilters, parsePage } from "@/lib/contacts/filters";
import { findContacts, getListOptions } from "@/lib/contacts/queries";
import { formatDate, formatNumber } from "@/lib/utils";
import { ClickableRow } from "./_components/clickable-row";
import { ContactFiltersBar } from "./_components/contact-filters";
import { DownloadLink } from "./_components/download-link";
import { Pagination } from "./_components/pagination";

export const metadata: Metadata = { title: "Contacts" };

const MAX_LIST_BADGES = 2;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseContactFilters(params);
  const [result, listOptions] = await Promise.all([findContacts(filters, parsePage(params.page)), getListOptions()]);
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
          description="Add people one by one, or import a CSV exported from your CRM, shop or spreadsheet. You can map its columns to names and custom fields."
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
            <ContactFiltersBar key={query} filters={filters} lists={listOptions} />
            <p className="shrink-0 text-sm text-slate-500" aria-live="polite">
              {formatNumber(result.total)} {filtered ? "matching " : ""}
              {result.total === 1 ? "contact" : "contacts"}
            </p>
          </div>

          {result.rows.length === 0 ? (
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
          ) : (
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th>Email</Th>
                  <Th className="hidden sm:table-cell">Name</Th>
                  <Th>Status</Th>
                  <Th className="hidden lg:table-cell">Lists</Th>
                  <Th className="hidden md:table-cell">Added</Th>
                </tr>
              </thead>
              <TBody>
                {result.rows.map((c) => {
                  const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
                  const extraLists = c.lists.length - MAX_LIST_BADGES;
                  return (
                    <ClickableRow key={c.id} href={`/contacts/${c.id}`}>
                      <Td className="max-w-xs">
                        <Link
                          href={`/contacts/${c.id}`}
                          className="block truncate font-medium text-slate-900 hover:text-indigo-600"
                        >
                          {c.email}
                        </Link>
                        {name ? <span className="block truncate text-xs text-slate-500 sm:hidden">{name}</span> : null}
                      </Td>
                      <Td className="hidden sm:table-cell">{name || <span className="text-slate-400">—</span>}</Td>
                      <Td>
                        <StatusBadge status={c.status} />
                      </Td>
                      <Td className="hidden lg:table-cell">
                        {c.lists.length === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {c.lists.slice(0, MAX_LIST_BADGES).map((l) => (
                              <Badge key={l.id} tone="indigo">
                                {l.name}
                              </Badge>
                            ))}
                            {extraLists > 0 ? (
                              <span title={c.lists.slice(MAX_LIST_BADGES).map((l) => l.name).join(", ")}>
                                <Badge>+{extraLists}</Badge>
                              </span>
                            ) : null}
                          </div>
                        )}
                      </Td>
                      <Td className="hidden whitespace-nowrap text-slate-500 md:table-cell">{formatDate(c.createdAt)}</Td>
                    </ClickableRow>
                  );
                })}
              </TBody>
            </Table>
          )}

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
