import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardBody, PageHeader } from "@/components/ui/layout";
import { getListOptions } from "@/lib/contacts/queries";
import { createFormAction } from "../actions";
import { FormEditor } from "../form-editor";

export const metadata: Metadata = { title: "New form" };

export default async function NewFormPage() {
  const lists = await getListOptions();

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="New form"
        back={
          <Link href="/forms" className="text-slate-500 hover:text-slate-700">
            &larr; Forms
          </Link>
        }
      />
      <Card>
        <CardBody>
          <FormEditor
            action={createFormAction}
            lists={lists}
            submitLabel="Create form"
            pendingLabel="Creating..."
            cancelHref="/forms"
          />
        </CardBody>
      </Card>
    </div>
  );
}
