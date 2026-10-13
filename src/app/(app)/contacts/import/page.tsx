import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/layout";
import { getListOptions } from "@/lib/contacts/queries";
import { ImportFlow } from "./import-wizard";

export const metadata: Metadata = { title: "Import contacts" };

export default async function ImportContactsPage({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
  const { list } = await searchParams;
  const lists = await getListOptions();
  const defaultListId = lists.some((l) => l.id === list) ? list : undefined;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Import contacts"
        description="Upload a CSV file, match its columns, and add everyone to a list in one go. Only import people who agreed to hear from you."
        back={
          <Link href={defaultListId ? `/lists/${defaultListId}` : "/contacts"} className="text-slate-500 hover:text-slate-700">
            &larr; {defaultListId ? "Back to list" : "Contacts"}
          </Link>
        }
      />
      <ImportFlow lists={lists} defaultListId={defaultListId} />
    </div>
  );
}
