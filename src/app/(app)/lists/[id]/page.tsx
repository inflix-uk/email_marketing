import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, ButtonLink, SubmitButton } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Card, CardBody, CardHeader, PageHeader, Stat, StatusBadge, Table, TBody, Td, Th } from "@/components/ui/layout";
import { parsePage } from "@/lib/contacts/filters";
import { findListMembers, getList, getListStats } from "@/lib/contacts/queries";
import { formatDate, formatNumber } from "@/lib/utils";
import { ClickableRow } from "../../contacts/_components/clickable-row";
import { ConfirmDelete } from "../../contacts/_components/confirm-delete";
import { DownloadLink } from "../../contacts/_components/download-link";
import { Pagination } from "../../contacts/_components/pagination";
import { addEmailsAction, deleteListAction, removeMemberAction, updateListAction } from "../actions";
import { ListForm } from "../list-form";
import { AddEmailsForm } from "./add-emails-form";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const list = await getList(id);
  return { title: list?.name ?? "List not found" };
}

export default async function ListPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const q = (Array.isArray(query.q) ? query.q[0] : query.q)?.trim().slice(0, 200) || undefined;

  const list = await getList(id);
  if (!list) notFound();
  const [stats, members] = await Promise.all([getListStats(id), findListMembers(id, q, parsePage(query.page))]);

  return (
    <>
      <PageHeader
        title={list.name}
        description={list.description ?? undefined}
        back={
          <Link href="/lists" className="text-slate-500 hover:text-slate-700">
            &larr; Lists
          </Link>
        }
        actions={
          <>
            {stats.total > 0 ? <DownloadLink href={`/api/contacts/export?list=${id}`}>Export CSV</DownloadLink> : null}
            <ButtonLink href={`/contacts/import?list=${id}`} variant="secondary">
              Import CSV into this list
            </ButtonLink>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Subscribed" value={formatNumber(stats.subscribed)} hint="Will receive campaigns" />
        <Stat label="Pending" value={formatNumber(stats.pending)} hint="Not confirmed yet" />
        <Stat label="Unsubscribed" value={formatNumber(stats.unsubscribed)} />
        <Stat label="Bounced / complained" value={formatNumber(stats.bounced)} />
        <Stat label="Total members" value={formatNumber(stats.total)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="self-start lg:col-span-2">
          <CardHeader
            title="Members"
            description={
              q
                ? `${formatNumber(members.total)} matching “${q}”`
                : `${formatNumber(members.total)} ${members.total === 1 ? "contact" : "contacts"}`
            }
          />
          {stats.total > 0 ? (
            <div className="border-b border-slate-200 px-4 py-3">
              <Form action={`/lists/${id}`} role="search" className="flex gap-2">
                <label htmlFor="member-search" className="sr-only">
                  Search members
                </label>
                <Input id="member-search" name="q" type="search" defaultValue={q} placeholder="Search by email or name..." />
                <Button type="submit" variant="secondary">
                  Search
                </Button>
                {q ? (
                  <ButtonLink href={`/lists/${id}`} variant="ghost">
                    Clear
                  </ButtonLink>
                ) : null}
              </Form>
            </div>
          ) : null}

          {members.rows.length === 0 ? (
            <div className="px-6 py-12 text-center">
              {q ? (
                <>
                  <p className="text-sm font-medium text-slate-900">No members match “{q}”</p>
                  <p className="mt-1 text-sm text-slate-500">
                    <Link href={`/lists/${id}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                      Show all members
                    </Link>
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-slate-900">This list is empty</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
                    Paste email addresses in the form on the right, or{" "}
                    <Link href={`/contacts/import?list=${id}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                      import a CSV
                    </Link>{" "}
                    straight into this list.
                  </p>
                </>
              )}
            </div>
          ) : (
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th>Email</Th>
                  <Th className="hidden sm:table-cell">Name</Th>
                  <Th>Status</Th>
                  <Th className="hidden md:table-cell">Added</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <TBody>
                {members.rows.map((m) => {
                  const name = [m.firstName, m.lastName].filter(Boolean).join(" ");
                  return (
                    <ClickableRow key={m.id} href={`/contacts/${m.id}`}>
                      <Td className="max-w-xs">
                        <Link href={`/contacts/${m.id}`} className="block truncate font-medium text-slate-900 hover:text-indigo-600">
                          {m.email}
                        </Link>
                      </Td>
                      <Td className="hidden sm:table-cell">{name || <span className="text-slate-400">—</span>}</Td>
                      <Td>
                        <StatusBadge status={m.status} />
                      </Td>
                      <Td className="hidden whitespace-nowrap text-slate-500 md:table-cell">{formatDate(m.createdAt)}</Td>
                      <Td className="text-right">
                        <form action={removeMemberAction.bind(null, id, m.id)}>
                          <SubmitButton variant="ghost" size="sm" pendingText="Removing..." aria-label={`Remove ${m.email} from this list`}>
                            Remove
                          </SubmitButton>
                        </form>
                      </Td>
                    </ClickableRow>
                  );
                })}
              </TBody>
            </Table>
          )}

          <Pagination
            page={members.page}
            pageCount={members.pageCount}
            pageSize={members.pageSize}
            total={members.total}
            hrefFor={(page) => {
              const qs = new URLSearchParams();
              if (q) qs.set("q", q);
              if (page > 1) qs.set("page", String(page));
              const s = qs.toString();
              return s ? `/lists/${id}?${s}` : `/lists/${id}`;
            }}
          />
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Add contacts" />
            <CardBody className="space-y-3">
              <AddEmailsForm action={addEmailsAction.bind(null, id)} />
              <p className="text-xs text-slate-500">
                Have a spreadsheet?{" "}
                <Link href={`/contacts/import?list=${id}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                  Import a CSV into this list
                </Link>
                .
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="List details" />
            <CardBody>
              <ListForm
                action={updateListAction.bind(null, id)}
                initial={{ name: list.name, description: list.description ?? "" }}
                submitLabel="Save"
                pendingLabel="Saving..."
                idPrefix="edit-list"
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Delete list" />
            <CardBody className="space-y-3">
              <p className="text-sm text-slate-600">
                Contacts are kept - only their membership of this list is removed.
              </p>
              <ConfirmDelete action={deleteListAction.bind(null, id)} label="Delete list" confirmLabel="Yes, delete list">
                Delete <strong>{list.name}</strong>? Its {formatNumber(stats.total)}{" "}
                {stats.total === 1 ? "contact stays" : "contacts stay"} in your contacts, and campaigns that targeted this
                list will no longer include it. This can&apos;t be undone.
              </ConfirmDelete>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
