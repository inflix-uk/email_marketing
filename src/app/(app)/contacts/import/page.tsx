import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/layout";
import { getListOptions } from "@/lib/contacts/queries";
import { ImportFlow } from "./import-form";

export const metadata: Metadata = { title: "Import contacts" };

export default async function ImportContactsPage({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
  const { list } = await searchParams;
  const lists = await getListOptions();
  const defaultListId = lists.some((l) => l.id === list) ? list : undefined;

  return (
    <>
      <PageHeader
        title="Import contacts"
        description="Only import people who agreed to get your emails."
        back={
          <Link href={defaultListId ? `/lists/${defaultListId}` : "/contacts"} className="text-slate-500 hover:text-slate-700">
            &larr; {defaultListId ? "Back to list" : "Contacts"}
          </Link>
        }
      />
      <ImportFlow lists={lists} defaultListId={defaultListId} />
    </>
  );
}
