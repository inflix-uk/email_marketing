import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SubmitButton } from "@/components/ui/button";
import { collections } from "@/db";
import { fromDoc } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { duplicateTemplate } from "../actions";
import { DeleteTemplateButton } from "../delete-template-button";
import { TemplateForm } from "./template-form";

type Props = { params: Promise<{ id: string }> };

const getTemplate = cache(async (id: string) => {
  const { templates } = await collections();
  const doc = await templates.findOne({ _id: id });
  return doc ? fromDoc(doc) : undefined;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const template = await getTemplate(id);
  return { title: template?.name ?? "Template not found" };
}

export default async function TemplatePage({ params }: Props) {
  const { id } = await params;
  const [template, session] = await Promise.all([getTemplate(id), requireSession()]);
  if (!template) notFound();

  return (
    <>
      <h1 className="sr-only">Edit template</h1>
      <div className="mb-3 text-sm">
        <Link href="/templates" className="text-slate-500 hover:text-slate-700">
          ← Templates
        </Link>
      </div>

      {/* Keyed so switching templates (e.g. after Duplicate) starts with fresh editor state. */}
      <TemplateForm
        key={template.id}
        template={{
          id: template.id,
          name: template.name,
          subject: template.subject,
          previewText: template.previewText,
          html: template.html,
          design: template.design ?? null,
        }}
        testRecipient={session.email}
        secondaryActions={
          <>
            <form action={duplicateTemplate}>
              <input type="hidden" name="id" value={template.id} />
              <SubmitButton variant="ghost" pendingText="Duplicating..." title="Make a copy of the saved version">
                Duplicate
              </SubmitButton>
            </form>
            <DeleteTemplateButton id={template.id} name={template.name} variant="ghost" />
          </>
        }
      />
    </>
  );
}
