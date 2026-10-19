import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/layout";
import { getListOptions } from "@/lib/contacts/queries";
import { createContactAction } from "../actions";
import { ContactForm } from "../_components/contact-form";

export const metadata: Metadata = { title: "Add contact" };

export default async function NewContactPage({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
  const { list } = await searchParams;
  const lists = await getListOptions();
  const preselected = lists.some((l) => l.id === list) ? [list!] : [];

  return (
    <>
      <PageHeader
        title="Add contact"
        back={
          <Link href="/contacts" className="text-slate-500 hover:text-slate-700">
            &larr; Contacts
          </Link>
        }
      />
      <div className="max-w-2xl">
        <ContactForm
          action={createContactAction}
          lists={lists}
          initial={{ email: "", firstName: null, lastName: null, listIds: preselected }}
          submitLabel="Add contact"
          pendingLabel="Adding..."
        />
      </div>
    </>
  );
}
