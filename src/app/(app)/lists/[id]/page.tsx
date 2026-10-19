import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, ButtonLink, SubmitButton } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Card, CardBody, CardHeader, StatusBadge, Table, TBody, Td, Th, PageHeader } from "@/components/ui/layout";
import { parsePage } from "@/lib/contacts/filters";
import { findListMembers, getList, getListStats } from "@/lib/contacts/queries";
import { formatNumber } from "@/lib/utils";
import { ClickableRow } from "../../contacts/_components/clickable-row";
import { ConfirmDelete } from "../../contacts/_components/confirm-delete";
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
        description={`${formatNumber(stats.subscribed)} subscribed · ${formatNumber(stats.total)} total`}
        back={
          <Link href="/lists" className="text-slate-500 hover:text-slate-700">
            &larr; Lists
          </Link>
        }
      />

      {/* Wide screens: members on the left, the small forms on the right. Phones: "Add people" first. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr]">
        <Card className="lg:col-start-2 lg:row-start-1">
          <CardHeader title="Add people" />
          <CardBody className="space-y-3">
            <AddEmailsForm action={addEmailsAction.bind(null, id)} />
            <p className="text-sm text-slate-500">
              Or{" "}
              <Link href={`/contacts/import?list=${id}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                import a CSV file
              </Link>
            </p>
          </CardBody>
        </Card>

        <Card className="self-start lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {stats.total > 0 ? (
            <div className="border-b border-slate-200 px-4 py-3">
              <Form action={`/lists/${id}`} role="search" className="flex gap-2">
                <label htmlFor="member-search" className="sr-only">
                  Search this list
                </label>
                <Input id="member-search" name="q" type="search" defaultValue={q} placeholder="Search by email or name..." className="sm:w-72" />
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
            <p className="px-6 py-12 text-center text-sm text-slate-500">
              {q ? (
                <>
                  No one matches “{q}”.{" "}
                  <Link href={`/lists/${id}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                    Show all
                  </Link>
                </>
              ) : (
                "No one on this list yet."
              )}
            </p>
          ) : (
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th>Email</Th>
                  <Th className="hidden sm:table-cell">Name</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Remove</span>
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

        <Card className="self-start lg:col-start-2 lg:row-start-2">
          <CardBody className="space-y-4">
            <ListForm
              action={updateListAction.bind(null, id)}
              initialName={list.name}
              label="Name"
              submitLabel="Save"
              pendingLabel="Saving..."
              idPrefix="edit-list"
            />
            <div className="border-t border-slate-200 pt-4">
              <ConfirmDelete action={deleteListAction.bind(null, id)} label="Delete list" confirmLabel="Yes, delete" className="w-full">
                Delete this list? The people on it stay in your contacts.
              </ConfirmDelete>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
