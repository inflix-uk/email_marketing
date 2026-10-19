import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, EmptyState, PageHeader, Table, TBody, Td, Th } from "@/components/ui/layout";
import { getListsWithCounts } from "@/lib/contacts/queries";
import { formatNumber } from "@/lib/utils";
import { ClickableRow } from "../contacts/_components/clickable-row";
import { createListAction } from "./actions";
import { ListForm } from "./list-form";

export const metadata: Metadata = { title: "Lists" };

export default async function ListsPage() {
  const lists = await getListsWithCounts();

  return (
    <>
      <PageHeader title="Lists" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div>
          {lists.length === 0 ? (
            <EmptyState title="No lists yet" description="Create a list, then add people to it." />
          ) : (
            <Card>
              <Table>
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Name</Th>
                    <Th className="text-right">Subscribed</Th>
                    <Th className="text-right">Total</Th>
                  </tr>
                </thead>
                <TBody>
                  {lists.map((list) => (
                    <ClickableRow key={list.id} href={`/lists/${list.id}`}>
                      <Td className="max-w-md">
                        <Link href={`/lists/${list.id}`} className="block truncate font-medium text-slate-900 hover:text-indigo-600">
                          {list.name}
                        </Link>
                      </Td>
                      <Td className="text-right tabular-nums">{formatNumber(list.subscribed)}</Td>
                      <Td className="text-right tabular-nums text-slate-500">{formatNumber(list.total)}</Td>
                    </ClickableRow>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </div>

        <Card className="order-first lg:order-none">
          <CardBody>
            <ListForm action={createListAction} label="New list" submitLabel="Create" pendingLabel="Creating..." idPrefix="new-list" />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
