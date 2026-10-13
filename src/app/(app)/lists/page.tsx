import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, Table, TBody, Td, Th } from "@/components/ui/layout";
import { getListsWithCounts } from "@/lib/contacts/queries";
import { formatDate, formatNumber } from "@/lib/utils";
import { ClickableRow } from "../contacts/_components/clickable-row";
import { createListAction } from "./actions";
import { ListForm } from "./list-form";

export const metadata: Metadata = { title: "Lists" };

export default async function ListsPage() {
  const lists = await getListsWithCounts();

  return (
    <>
      <PageHeader
        title="Lists"
        description="Group contacts into lists, then send campaigns to one or more lists. A contact can be on many lists."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {lists.length === 0 ? (
            <EmptyState
              title="No lists yet"
              description="Create your first list - for example “Newsletter” or “Customers” - then add contacts to it by pasting emails or importing a CSV."
            />
          ) : (
            <Card>
              <Table>
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Name</Th>
                    <Th className="text-right">Subscribed</Th>
                    <Th className="hidden text-right sm:table-cell">Members</Th>
                    <Th className="hidden md:table-cell">Created</Th>
                  </tr>
                </thead>
                <TBody>
                  {lists.map((list) => (
                    <ClickableRow key={list.id} href={`/lists/${list.id}`}>
                      <Td className="max-w-sm">
                        <Link href={`/lists/${list.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                          {list.name}
                        </Link>
                        {list.description ? <p className="truncate text-xs text-slate-500">{list.description}</p> : null}
                      </Td>
                      <Td className="text-right tabular-nums">{formatNumber(list.subscribed)}</Td>
                      <Td className="hidden text-right tabular-nums text-slate-500 sm:table-cell">{formatNumber(list.total)}</Td>
                      <Td className="hidden whitespace-nowrap text-slate-500 md:table-cell">{formatDate(list.createdAt)}</Td>
                    </ClickableRow>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </div>

        <Card className="self-start">
          <CardHeader title="New list" />
          <CardBody>
            <ListForm action={createListAction} submitLabel="Create list" pendingLabel="Creating..." idPrefix="new-list" />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
